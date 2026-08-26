import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CreatedVia,
  ExpenseScope,
  Prisma,
  RecurringCadence,
  RecurringExpense,
  SplitType,
} from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { GroupAccessService } from '../groups/group-access.service';
import { NotificationEmitter } from '../notifications/notification-emitter.service';
import { expenseAdded } from '../notifications/notification-events';
import { ACTIVITY_EVENT, ActivityEvent } from '../gamification/gamification.events';
import { formatMoney, splitEvenly, toDecimal, toNumber } from '../common/money';
import { CreateRecurringDto, UpdateRecurringDto } from './dto/recurring.dto';
import { firstRun, nextRun, runKey } from './cadence';

@Injectable()
export class RecurringService {
  private readonly logger = new Logger(RecurringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GroupAccessService,
    private readonly emitter: NotificationEmitter,
    private readonly events: EventEmitter2,
  ) {}

  async list(userId: string) {
    const rows = await this.prisma.recurringExpense.findMany({
      where: { userId },
      orderBy: { nextRunAt: 'asc' },
    });

    return rows.map((row) => this.present(row));
  }

  async create(userId: string, dto: CreateRecurringDto) {
    const scope = dto.scope ?? ExpenseScope.PERSONAL;

    if (scope === ExpenseScope.GROUP) {
      if (!dto.groupId) {
        throw new BadRequestException('A group recurring expense needs a groupId.');
      }

      await this.access.requireMembership(userId, dto.groupId);
    } else if (dto.groupId) {
      throw new BadRequestException('groupId only applies to a GROUP recurring expense.');
    }

    if (dto.cadence === RecurringCadence.MONTHLY && dto.weekday !== undefined) {
      throw new BadRequestException('weekday applies to a WEEKLY cadence.');
    }

    if (dto.cadence === RecurringCadence.WEEKLY && dto.dayOfMonth !== undefined) {
      throw new BadRequestException('dayOfMonth applies to a MONTHLY cadence.');
    }

    const start = dto.startsOn ? new Date(dto.startsOn) : new Date();

    const row = await this.prisma.recurringExpense.create({
      data: {
        userId,
        scope,
        groupId: dto.groupId ?? null,
        title: dto.title,
        amount: toDecimal(dto.amount),
        category: dto.category ?? null,
        cadence: dto.cadence,
        dayOfMonth: dto.dayOfMonth ?? null,
        weekday: dto.weekday ?? null,
        nextRunAt: firstRun(start, dto.cadence, {
          dayOfMonth: dto.dayOfMonth,
          weekday: dto.weekday,
        }),
        endsOn: dto.endsOn ? new Date(dto.endsOn) : null,
      },
    });

    return this.present(row);
  }

  async update(userId: string, id: string, dto: UpdateRecurringDto) {
    await this.requireOwn(userId, id);

    const row = await this.prisma.recurringExpense.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.amount !== undefined ? { amount: toDecimal(dto.amount) } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.endsOn !== undefined ? { endsOn: new Date(dto.endsOn) } : {}),
        ...(dto.paused !== undefined ? { pausedAt: dto.paused ? new Date() : null } : {}),
      },
    });

    return this.present(row);
  }

  /** Stops the schedule. Expenses it already created stay - they really happened. */
  async remove(userId: string, id: string) {
    await this.requireOwn(userId, id);
    await this.prisma.recurringExpense.delete({ where: { id } });

    return { deleted: true, id };
  }

  /** Moves the schedule on without creating anything. */
  async skipNext(userId: string, id: string) {
    const row = await this.requireOwn(userId, id);

    const updated = await this.prisma.recurringExpense.update({
      where: { id },
      data: {
        nextRunAt: nextRun(row.nextRunAt, row.cadence, {
          dayOfMonth: row.dayOfMonth,
          weekday: row.weekday,
        }),
      },
    });

    return this.present(updated);
  }

  /**
   * Pulls this period's expense forward. Guarded on the *current* period rather
   * than the pending run: after one run nextRunAt has already advanced, so
   * comparing against it would let a second call generate the following period
   * straight away — and a third the one after that.
   */
  async runNow(userId: string, id: string) {
    const row = await this.requireOwn(userId, id);
    const now = new Date();
    const currentKey = runKey(now, row.cadence);

    if (row.lastRunKey === currentKey) {
      throw new BadRequestException('This period has already been generated.');
    }

    const created = await this.runOne(row, now);

    if (!created) {
      throw new BadRequestException('This period has already been generated.');
    }

    return created;
  }

  // ------------------------------------------------------------------
  // Scheduler
  // ------------------------------------------------------------------

  async runDue(now = new Date()): Promise<number> {
    const due = await this.prisma.recurringExpense.findMany({
      where: {
        pausedAt: null,
        nextRunAt: { lte: now },
        OR: [{ endsOn: null }, { endsOn: { gte: now } }],
      },
    });

    let created = 0;

    for (const row of due) {
      try {
        if (await this.runOne(row, now)) {
          created++;
        }
      } catch (error) {
        this.logger.error(
          `Recurring ${row.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return created;
  }

  /**
   * Creates the expense and advances the schedule in one transaction, keyed by
   * the period. A scheduler that crashes mid-run, or two instances running at
   * once, cannot produce rent twice.
   */
  private async runOne(row: RecurringExpense, now: Date) {
    const key = runKey(row.nextRunAt, row.cadence);

    if (row.lastRunKey === key) {
      return null;
    }

    const advanced = nextRun(row.nextRunAt, row.cadence, {
      dayOfMonth: row.dayOfMonth,
      weekday: row.weekday,
    });

    const amount = row.amount;
    const category = row.category ?? 'General';

    if (row.scope === ExpenseScope.PERSONAL) {
      const [expense] = await this.prisma.$transaction([
        this.prisma.expense.create({
          data: {
            scope: ExpenseScope.PERSONAL,
            ownerId: row.userId,
            groupId: null,
            paidById: null,
            splitType: null,
            title: row.title,
            totalAmount: amount,
            category,
            date: row.nextRunAt,
            createdById: row.userId,
            createdVia: CreatedVia.SYSTEM,
          },
        }),
        this.prisma.recurringExpense.updateMany({
          // Guarded on the key we read, so a concurrent runner writing first
          // makes this update match nothing.
          where: { id: row.id, lastRunKey: row.lastRunKey },
          data: { lastRunKey: key, nextRunAt: advanced },
        }),
      ]);

      // A notification for a bill the user set up themselves is noise.
      this.events.emit(ACTIVITY_EVENT, new ActivityEvent('EXPENSE_CREATED', row.userId));

      return { ...expense, totalAmount: toNumber(expense.totalAmount) };
    }

    // Membership may have changed since the schedule was set up, so the split
    // is computed against the members who are there now.
    const members = await this.prisma.groupMember.findMany({
      where: { groupId: row.groupId as string },
      select: { userId: true },
    });

    if (members.length === 0) {
      throw new Error('group has no members');
    }

    const shares = splitEvenly(amount, members.length);

    const [expense] = await this.prisma.$transaction([
      this.prisma.expense.create({
        data: {
          scope: ExpenseScope.GROUP,
          ownerId: row.userId,
          groupId: row.groupId,
          paidById: row.userId,
          splitType: SplitType.EQUAL,
          title: row.title,
          totalAmount: amount,
          category,
          date: row.nextRunAt,
          createdById: row.userId,
          createdVia: CreatedVia.SYSTEM,
          shares: {
            create: members.map((member, index) => ({
              userId: member.userId,
              amount: shares[index],
            })),
          },
        },
        include: { shares: true },
      }),
      this.prisma.recurringExpense.updateMany({
        where: { id: row.id, lastRunKey: row.lastRunKey },
        data: { lastRunKey: key, nextRunAt: advanced },
      }),
    ]);

    const [group, actor] = await Promise.all([
      this.prisma.group.findUnique({
        where: { id: row.groupId as string },
        select: { name: true, currency: true },
      }),
      this.prisma.user.findUnique({ where: { id: row.userId }, select: { name: true } }),
    ]);

    await this.emitter.emit(
      expense.shares
        .filter((share) => share.userId !== row.userId)
        .map((share) =>
          expenseAdded(
            share.userId,
            row.userId,
            actor?.name ?? 'Someone',
            row.groupId as string,
            group?.name ?? 'a group',
            expense.id,
            expense.title,
            formatMoney(share.amount, group?.currency ?? 'INR'),
          ),
        ),
    );

    this.events.emit(ACTIVITY_EVENT, new ActivityEvent('EXPENSE_CREATED', row.userId));

    return { ...expense, totalAmount: toNumber(expense.totalAmount) };
  }

  private async requireOwn(userId: string, id: string): Promise<RecurringExpense> {
    const row = await this.prisma.recurringExpense.findFirst({ where: { id, userId } });

    if (!row) {
      throw new NotFoundException(`Recurring expense ${id} not found`);
    }

    return row;
  }

  private present(row: RecurringExpense) {
    return {
      ...row,
      amount: toNumber(row.amount),
      paused: row.pausedAt !== null,
    };
  }
}
