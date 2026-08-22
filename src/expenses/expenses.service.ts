import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { GroupRole, Prisma, SplitType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GroupAccessService } from '../groups/group-access.service';
import { CreateExpenseDto, ExpenseShareInputDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { QueryExpensesDto } from './dto/query-expenses.dto';
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
  ) {}

  /** Decimal would serialise as a string, so amounts are converted here. */
  private present(expense: ExpenseWithRelations, viewerId: string) {
    const myShare = expense.shares.find((s) => s.userId === viewerId);

    return {
      ...expense,
      totalAmount: toNumber(expense.totalAmount),
      shares: expense.shares.map((share) => ({
        id: share.id,
        userId: share.userId,
        name: share.user.name,
        amount: toNumber(share.amount),
      })),
      myShare: toNumber(myShare?.amount),
      iPaid: expense.paidById === viewerId,
    };
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

  async findOne(userId: string, expenseId: string) {
    const expense = await this.prisma.expense.findUnique({
      where: { id: expenseId },
      include: EXPENSE_INCLUDE,
    });

    if (!expense) {
      throw new NotFoundException(`Expense ${expenseId} not found`);
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
          ...(dto.paidById !== undefined ? { paidById } : {}),
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
