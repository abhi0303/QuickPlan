import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreatedVia, ExpenseScope, GroupRole, Prisma, SplitType } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVITY_EVENT, ActivityEvent } from '../gamification/gamification.events';
import { GroupAccessService } from '../groups/group-access.service';
import { CreateExpenseDto, ExpenseShareInputDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { QueryExpensesDto } from './dto/query-expenses.dto';
import { CreatePersonalExpenseDto } from './dto/create-personal-expense.dto';
import { UpdatePersonalExpenseDto } from './dto/update-personal-expense.dto';
import { QueryPersonalExpensesDto } from './dto/query-personal-expenses.dto';
import { formatMoney, splitEvenly, toDecimal, toNumber } from '../common/money';
import { NotificationEmitter } from '../notifications/notification-emitter.service';
import {
  expenseAdded,
  expenseDeleted,
  expenseUpdated,
} from '../notifications/notification-events';

const EXPENSE_INCLUDE = {
  paidBy: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  shares: { include: { user: { select: { id: true, name: true, email: true } } } },
} satisfies Prisma.ExpenseInclude;

type ExpenseWithRelations = Prisma.ExpenseGetPayload<{ include: typeof EXPENSE_INCLUDE }>;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GroupAccessService,
    private readonly emitter: NotificationEmitter,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * One envelope for both kinds, so the expense row component needs no
   * branching. A personal expense reports `myShare` equal to the total - your
   * share of your own expense is all of it - and an empty shares array.
   */
  private present(expense: ExpenseWithRelations, viewerId: string) {
    const isPersonal = expense.scope === ExpenseScope.PERSONAL;
    const myShare = expense.shares.find((s) => s.userId === viewerId);

    return {
      ...expense,
      totalAmount: toNumber(expense.totalAmount),
      // Exposed as `notes`; `description` stays for existing clients.
      notes: expense.description,
      shares: expense.shares.map((share) => ({
        id: share.id,
        userId: share.userId,
        name: share.user.name,
        amount: toNumber(share.amount),
      })),
      myShare: isPersonal ? toNumber(expense.totalAmount) : toNumber(myShare?.amount),
      iPaid: isPersonal ? true : expense.paidById === viewerId,
    };
  }

  // ------------------------------------------------------------------
  // Personal ledger
  // ------------------------------------------------------------------

  /** No group, no payer, no split - the check constraint enforces all three. */
  async createPersonal(userId: string, dto: CreatePersonalExpenseDto, rawBody?: object) {
    this.assertNoGroupFields(rawBody ?? dto);

    const expense = await this.prisma.expense.create({
      data: {
        scope: ExpenseScope.PERSONAL,
        ownerId: userId,
        groupId: null,
        paidById: null,
        splitType: null,
        title: dto.title,
        description: dto.notes,
        totalAmount: toDecimal(dto.totalAmount),
        category: dto.category ?? 'General',
        date: dto.date ? new Date(dto.date) : new Date(),
        createdById: userId,
        createdVia: dto.createdVia ?? CreatedVia.MANUAL,
      },
      include: EXPENSE_INCLUDE,
    });

    this.events.emit(ACTIVITY_EVENT, new ActivityEvent('EXPENSE_CREATED', userId));

    return this.present(expense, userId);
  }

  /**
   * Only the caller's own ledger. Ordered by `date` then `id`: a backdated
   * expense belongs where it happened, and the tiebreak keeps paging stable.
   */
  async findAllPersonal(userId: string, query: QueryPersonalExpensesDto = {}) {
    const where: Prisma.ExpenseWhereInput = {
      scope: ExpenseScope.PERSONAL,
      ownerId: userId,
    };

    if (query.category) where.category = query.category;

    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [expenses, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        take: query.limit ?? 50,
        skip: query.offset ?? 0,
        include: EXPENSE_INCLUDE,
      }),
      this.prisma.expense.count({ where }),
    ]);

    return {
      total,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
      items: expenses.map((expense) => this.present(expense, userId)),
    };
  }

  private async updatePersonal(
    userId: string,
    expense: { id: string },
    dto: UpdatePersonalExpenseDto,
  ) {
    const updated = await this.prisma.expense.update({
      where: { id: expense.id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.notes !== undefined ? { description: dto.notes } : {}),
        ...(dto.totalAmount !== undefined ? { totalAmount: toDecimal(dto.totalAmount) } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.date !== undefined ? { date: new Date(dto.date) } : {}),
      },
      include: EXPENSE_INCLUDE,
    });

    return this.present(updated, userId);
  }

  async create(userId: string, groupId: string, dto: CreateExpenseDto) {
    await this.access.requireMembership(userId, groupId);

    const memberIds = await this.memberIds(groupId);
    const paidById = dto.paidById ?? userId;

    if (!memberIds.includes(paidById)) {
      throw new BadRequestException('The payer must be a member of this group.');
    }

    const total = toDecimal(dto.totalAmount);
    const shares = this.buildShares(total, dto.splitType ?? SplitType.EQUAL, dto.shares, memberIds);

    const expense = await this.prisma.expense.create({
      data: {
        scope: ExpenseScope.GROUP,
        // For a group expense the owner is whoever paid, so one index covers
        // both ledgers.
        ownerId: paidById,
        groupId,
        title: dto.title,
        description: dto.description,
        totalAmount: total,
        paidById,
        createdById: userId,
        splitType: dto.splitType ?? SplitType.EQUAL,
        category: dto.category ?? 'General',
        date: dto.date ? new Date(dto.date) : new Date(),
        shares: { create: shares },
      },
      include: EXPENSE_INCLUDE,
    });

    await this.touchGroup(groupId);

    // Fire and forget: gamification listens, the expense flow does not wait on
    // it and never fails because of it.
    this.events.emit(ACTIVITY_EVENT, new ActivityEvent('EXPENSE_CREATED', userId));

    // Everyone with a share hears about it except the payer and the person who
    // recorded it - both already know.
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { name: true, currency: true },
    });
    const actorName = await this.nameOf(userId);

    await this.emitter.emit(
      expense.shares
        .filter((share) => share.userId !== userId && share.userId !== paidById)
        .map((share) =>
          expenseAdded(
            share.userId,
            userId,
            actorName,
            groupId,
            group?.name ?? 'a group',
            expense.id,
            expense.title,
            // The recipient's own share, not the total.
            formatMoney(share.amount, group?.currency ?? 'INR'),
          ),
        ),
    );

    return this.present(expense, userId);
  }

  async findAll(userId: string, groupId: string, query: QueryExpensesDto = {}) {
    await this.access.requireMembership(userId, groupId);

    const where: Prisma.ExpenseWhereInput = { groupId };

    if (query.category) where.category = query.category;
    if (query.paidById) where.paidById = query.paidById;

    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [expenses, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        orderBy: { date: 'desc' },
        take: query.limit ?? 50,
        skip: query.offset ?? 0,
        include: EXPENSE_INCLUDE,
      }),
      this.prisma.expense.count({ where }),
    ]);

    return {
      total,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
      items: expenses.map((expense) => this.present(expense, userId)),
    };
  }

  /** Personal expenses are authorised by owner, group ones by membership. */
  async findOne(userId: string, expenseId: string) {
    const expense = await this.prisma.expense.findUnique({
      where: { id: expenseId },
      include: EXPENSE_INCLUDE,
    });

    if (!expense) {
      throw new NotFoundException(`Expense ${expenseId} not found`);
    }

    if (expense.scope === ExpenseScope.PERSONAL) {
      if (expense.ownerId !== userId) {
        // 404, not 403 - someone else's ledger should not be discoverable.
        throw new NotFoundException(`Expense ${expenseId} not found`);
      }

      return this.present(expense, userId);
    }

    await this.access.requireMembership(userId, expense.groupId);

    return this.present(expense, userId);
  }

  /**
   * Editable by whoever recorded it, or by a group owner. Any change to the
   * amount, split type or share list rebuilds every share, so the stored
   * shares can never disagree with the total.
   */
  async update(userId: string, expenseId: string, dto: UpdateExpenseDto) {
    const existing = await this.prisma.expense.findUnique({ where: { id: expenseId } });

    if (existing?.scope === ExpenseScope.PERSONAL) {
      if (existing.ownerId !== userId) {
        throw new NotFoundException(`Expense ${expenseId} not found`);
      }

      this.assertNoGroupFields(dto);

      return this.updatePersonal(userId, existing, dto as UpdatePersonalExpenseDto);
    }

    const expense = await this.requireEditable(userId, expenseId);
    const memberIds = await this.memberIds(expense.groupId);

    // Snapshot so we can tell whose share genuinely changed.
    const previousShares = await this.prisma.expenseShare.findMany({
      where: { expenseId },
      select: { userId: true, amount: true },
    });
    const sharesBefore = new Map(previousShares.map((s) => [s.userId, s.amount]));

    const paidById = dto.paidById ?? expense.paidById;

    if (!memberIds.includes(paidById)) {
      throw new BadRequestException('The payer must be a member of this group.');
    }

    const total = dto.totalAmount !== undefined ? toDecimal(dto.totalAmount) : expense.totalAmount;
    const splitType = dto.splitType ?? expense.splitType;
    const resharing =
      dto.totalAmount !== undefined || dto.splitType !== undefined || dto.shares !== undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (resharing) {
        const shares = this.buildShares(total, splitType, dto.shares, memberIds);
        await tx.expenseShare.deleteMany({ where: { expenseId } });
        await tx.expenseShare.createMany({
          data: shares.map((s) => ({ ...s, expenseId })),
        });
      }

      return tx.expense.update({
        where: { id: expenseId },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.totalAmount !== undefined ? { totalAmount: total } : {}),
          ...(dto.paidById !== undefined ? { paidById, ownerId: paidById } : {}),
          ...(dto.splitType !== undefined ? { splitType } : {}),
          ...(dto.category !== undefined ? { category: dto.category } : {}),
          ...(dto.date !== undefined ? { date: new Date(dto.date) } : {}),
        },
        include: EXPENSE_INCLUDE,
      });
    });

    await this.touchGroup(expense.groupId);

    // Only tell people whose own share actually moved. A rename should not
    // ping the whole group.
    const group = await this.prisma.group.findUnique({
      where: { id: expense.groupId },
      select: { name: true, currency: true },
    });
    const actorName = await this.nameOf(userId);

    await this.emitter.emit(
      updated.shares
        .filter((share) => {
          if (share.userId === userId) {
            return false;
          }

          const before = sharesBefore.get(share.userId);

          return before === undefined || !before.equals(share.amount);
        })
        .map((share) =>
          expenseUpdated(
            share.userId,
            userId,
            actorName,
            expense.groupId,
            expense.id,
            updated.title,
            formatMoney(share.amount, group?.currency ?? 'INR'),
          ),
        ),
    );

    return this.present(updated, userId);
  }

  async remove(userId: string, expenseId: string) {
    const existing = await this.prisma.expense.findUnique({ where: { id: expenseId } });

    if (existing?.scope === ExpenseScope.PERSONAL) {
      if (existing.ownerId !== userId) {
        throw new NotFoundException(`Expense ${expenseId} not found`);
      }

      await this.prisma.expense.delete({ where: { id: expenseId } });

      return { deleted: true, expenseId };
    }

    const expense = await this.requireEditable(userId, expenseId);

    // Read the shares before the cascade takes them, so we know who to tell.
    const [shares, group] = await Promise.all([
      this.prisma.expenseShare.findMany({
        where: { expenseId },
        select: { userId: true },
      }),
      this.prisma.group.findUnique({
        where: { id: expense.groupId },
        select: { name: true },
      }),
    ]);

    await this.prisma.expense.delete({ where: { id: expenseId } });
    await this.touchGroup(expense.groupId);

    const actorName = await this.nameOf(userId);

    await this.emitter.emit(
      shares
        .filter((share) => share.userId !== userId)
        .map((share) =>
          expenseDeleted(
            share.userId,
            userId,
            actorName,
            expense.groupId,
            group?.name ?? 'a group',
            expenseId,
            expense.title,
          ),
        ),
    );

    return { deleted: true, expenseId };
  }

  /**
   * The check constraint should never be reachable from the API - a request
   * carrying group fields on a personal expense is rejected here first, with a
   * message that says where those belong.
   */
  assertNoGroupFields(body: object): void {
    const candidate = (body ?? {}) as Record<string, unknown>;
    const offenders = ['groupId', 'paidById', 'splitType', 'shares'].filter(
      (field) => candidate[field] !== undefined,
    );

    if (offenders.length > 0) {
      throw new BadRequestException(
        `${offenders.join(', ')} ${offenders.length === 1 ? 'belongs' : 'belong'} to a group expense. ` +
          'Use POST /api/groups/:groupId/expenses instead.',
      );
    }
  }

  private async nameOf(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    return user?.name ?? 'Someone';
  }

  private async requireEditable(userId: string, expenseId: string) {
    const expense = await this.prisma.expense.findUnique({ where: { id: expenseId } });

    if (!expense) {
      throw new NotFoundException(`Expense ${expenseId} not found`);
    }

    const membership = await this.access.requireMembership(userId, expense.groupId);

    if (expense.createdById !== userId && membership.role !== GroupRole.OWNER) {
      throw new ForbiddenException(
        'Only the member who added this expense, or a group owner, can change it.',
      );
    }

    return expense;
  }

  /**
   * Shares must always sum to the total, so EQUAL distributes the rounding
   * remainder and EXACT/PERCENTAGE are checked rather than trusted.
   */
  private buildShares(
    total: Prisma.Decimal,
    splitType: SplitType,
    input: ExpenseShareInputDto[] | undefined,
    memberIds: string[],
  ): Array<{ userId: string; amount: Prisma.Decimal }> {
    if (splitType === SplitType.EQUAL) {
      const participants = input?.length ? input.map((s) => s.userId) : memberIds;
      this.assertMembers(participants, memberIds);

      const amounts = splitEvenly(total, participants.length);

      return participants.map((userId, index) => ({ userId, amount: amounts[index] }));
    }

    if (!input?.length) {
      throw new BadRequestException(`${splitType} split needs an explicit shares list.`);
    }

    this.assertMembers(
      input.map((s) => s.userId),
      memberIds,
    );

    if (splitType === SplitType.EXACT) {
      const shares = input.map((s) => ({ userId: s.userId, amount: toDecimal(s.value) }));
      const sum = shares.reduce((acc, s) => acc.add(s.amount), new Prisma.Decimal(0));

      if (!sum.equals(total)) {
        throw new BadRequestException(
          `Shares add up to ${sum.toString()}, but the total is ${total.toString()}.`,
        );
      }

      return shares;
    }

    // PERCENTAGE
    const percentSum = input.reduce((acc, s) => acc.add(toDecimal(s.value)), new Prisma.Decimal(0));

    if (!percentSum.equals(100)) {
      throw new BadRequestException(`Percentages add up to ${percentSum.toString()}, not 100.`);
    }

    const shares = input.map((s) => ({
      userId: s.userId,
      amount: total.mul(toDecimal(s.value)).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN),
    }));

    // Percentages rarely divide cleanly, so give any leftover to the first share.
    const assigned = shares.reduce((acc, s) => acc.add(s.amount), new Prisma.Decimal(0));
    const remainder = total.sub(assigned);

    if (!remainder.isZero()) {
      shares[0].amount = shares[0].amount.add(remainder);
    }

    return shares;
  }

  private assertMembers(candidateIds: string[], memberIds: string[]) {
    const unique = new Set(candidateIds);

    if (unique.size !== candidateIds.length) {
      throw new BadRequestException('A member appears more than once in the split.');
    }

    for (const id of candidateIds) {
      if (!memberIds.includes(id)) {
        throw new BadRequestException('Every share must belong to a member of this group.');
      }
    }
  }

  private async memberIds(groupId: string): Promise<string[]> {
    const members = await this.prisma.groupMember.findMany({
      where: { groupId },
      select: { userId: true },
    });

    return members.map((m) => m.userId);
  }

  /** Keeps the group list sorted by real activity. */
  private async touchGroup(groupId: string) {
    await this.prisma.group.update({ where: { id: groupId }, data: { updatedAt: new Date() } });
  }
}
