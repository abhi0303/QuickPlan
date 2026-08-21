import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PeopleService } from '../people/people.service';
import { CreateIOUDto, IOUDirection } from './dto/create-iou.dto';
import { SplitExpenseDto } from './dto/split-expense.dto';
import { AddNamesDto } from './dto/add-names.dto';
import { ExpenseDirection, QueryExpensesDto } from './dto/query-expenses.dto';
import { splitEvenly, toDecimal, toNumber } from '../common/money';

const EXPENSE_INCLUDE = {
  participants: { include: { person: true } },
  paidBy: true,
} satisfies Prisma.ExpenseInclude;

type ExpenseWithRelations = Prisma.ExpenseGetPayload<{ include: typeof EXPENSE_INCLUDE }>;

@Injectable()
export class ExpensesService {
  constructor(
    private prisma: PrismaService,
    private peopleService: PeopleService,
  ) {}

  /**
   * Decimal values would serialise as strings, and `direction` is what callers
   * actually filter on, so both are resolved here rather than in every client.
   */
  private present(expense: ExpenseWithRelations) {
    return {
      ...expense,
      totalAmount: toNumber(expense.totalAmount),
      direction: expense.paidByMe
        ? ExpenseDirection.OWED_TO_ME
        : ExpenseDirection.I_OWE,
      participants: expense.participants.map((participant) => ({
        ...participant,
        shareAmount: toNumber(participant.shareAmount),
      })),
    };
  }

  /**
   * An IOU is one debt between two parties, so it gets one participant row:
   * whoever owes the money. Who fronted it lives on the expense itself.
   * Previously both sides were written with the full amount, which made any
   * sum over participants double-count.
   */
  async createIOU(userId: string, dto: CreateIOUDto) {
    const person = await this.peopleService.findOrCreateByName(userId, dto.personName);
    const amount = toDecimal(dto.amount);
    const iOwe = dto.direction === IOUDirection.PAYABLE;

    const expense = await this.prisma.expense.create({
      data: {
        userId,
        title: dto.reason ? `${dto.reason} (${dto.personName})` : `IOU - ${dto.personName}`,
        totalAmount: amount,
        type: iOwe ? 'IOU_PAYABLE' : 'IOU_RECEIVABLE',
        status: 'PENDING',
        paidByMe: !iOwe,
        paidById: iOwe ? person.id : null,
        participantsCount: 2,
        unnamedParticipantsCount: 0,
        participants: {
          create: [
            iOwe
              ? { isMe: true, shareAmount: amount, status: 'PENDING' }
              : { personId: person.id, isMe: false, shareAmount: amount, status: 'PENDING' },
          ],
        },
      },
      include: EXPENSE_INCLUDE,
    });

    return this.present(expense);
  }

  async splitExpense(userId: string, dto: SplitExpenseDto) {
    const count = dto.participantsCount;
    const total = toDecimal(dto.totalAmount);
    const shares = splitEvenly(total, count);
    const names = dto.names ?? [];
    const paidByMe = dto.paidByMe ?? true;

    if (names.length > count - 1) {
      throw new BadRequestException(
        `${names.length} names given for ${count - 1} other participants.`,
      );
    }

    if (!paidByMe && names.length === 0) {
      throw new BadRequestException(
        'Name the person who paid so the amount you owe can be tracked.',
      );
    }

    const people = await Promise.all(
      names.map((name) => this.peopleService.findOrCreateByName(userId, name)),
    );

    // When someone else paid, the first named person is treated as the payer.
    const payer = paidByMe ? null : people[0];
    const unnamedCount = Math.max(0, count - 1 - names.length);

    // My share is settled the moment I front the bill; otherwise I owe it.
    const participantData: Prisma.ExpenseParticipantCreateWithoutExpenseInput[] = [
      { isMe: true, shareAmount: shares[0], status: paidByMe ? 'PAID' : 'PENDING' },
    ];

    people.forEach((person, index) => {
      const isPayer = !paidByMe && person.id === payer?.id;
      participantData.push({
        person: { connect: { id: person.id } },
        isMe: false,
        shareAmount: shares[index + 1],
        // The payer does not owe themselves.
        status: isPayer ? 'PAID' : 'PENDING',
      });
    });

    for (let i = 0; i < unnamedCount; i++) {
      participantData.push({
        isMe: false,
        shareAmount: shares[names.length + 1 + i],
        status: 'PENDING',
      });
    }

    const expense = await this.prisma.expense.create({
      data: {
        userId,
        title: dto.title,
        totalAmount: total,
        type: 'SPLIT_EXPENSE',
        status: 'PENDING',
        paidByMe,
        paidById: payer?.id ?? null,
        participantsCount: count,
        unnamedParticipantsCount: unnamedCount,
        participants: { create: participantData },
      },
      include: EXPENSE_INCLUDE,
    });

    const myShare = shares[0];

    return {
      ...this.present(expense),
      myShare: toNumber(myShare),
      othersOweTotal: toNumber(paidByMe ? total.sub(myShare) : new Prisma.Decimal(0)),
      youOweTotal: toNumber(paidByMe ? new Prisma.Decimal(0) : myShare),
    };
  }

  async addNamesToExpense(userId: string, expenseId: string, dto: AddNamesDto) {
    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, userId },
      include: { participants: true },
    });

    if (!expense) {
      throw new NotFoundException(`Expense with ID ${expenseId} not found`);
    }

    const unnamed = expense.participants.filter((p) => !p.isMe && !p.personId);

    if (unnamed.length === 0) {
      throw new BadRequestException('No unnamed participants exist for this expense.');
    }

    const namesToAdd = dto.names.slice(0, unnamed.length);
    const people = await Promise.all(
      namesToAdd.map((name) => this.peopleService.findOrCreateByName(userId, name)),
    );

    // One transaction, so a failure halfway cannot leave the count disagreeing
    // with the rows it is supposed to describe.
    await this.prisma.$transaction([
      ...people.map((person, index) =>
        this.prisma.expenseParticipant.update({
          where: { id: unnamed[index].id },
          data: { personId: person.id },
        }),
      ),
      this.prisma.expense.update({
        where: { id: expenseId },
        data: { unnamedParticipantsCount: unnamed.length - namesToAdd.length },
      }),
    ]);

    return this.findOne(userId, expenseId);
  }

  async settleParticipant(userId: string, participantId: string) {
    const participant = await this.prisma.expenseParticipant.findUnique({
      where: { id: participantId },
      include: { expense: true },
    });

    if (!participant || participant.expense.userId !== userId) {
      throw new NotFoundException(`Participant record ${participantId} not found`);
    }

    await this.prisma.expenseParticipant.update({
      where: { id: participantId },
      data: { status: 'PAID', paidAt: new Date() },
    });

    const remainingPending = await this.prisma.expenseParticipant.count({
      where: { expenseId: participant.expenseId, status: 'PENDING' },
    });

    if (remainingPending === 0) {
      await this.prisma.expense.update({
        where: { id: participant.expenseId },
        data: { status: 'SETTLED' },
      });
    }

    return this.findOne(userId, participant.expenseId);
  }

  /**
   * Filtering happens in the database. Every supported combination is covered
   * by an index, so this stays cheap as the ledger grows.
   */
  async findAll(userId: string, query: QueryExpensesDto = {}) {
    const where: Prisma.ExpenseWhereInput = { userId };

    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;

    if (query.direction === ExpenseDirection.I_OWE) where.paidByMe = false;
    if (query.direction === ExpenseDirection.OWED_TO_ME) where.paidByMe = true;

    if (query.personId) {
      where.OR = [
        { paidById: query.personId },
        { participants: { some: { personId: query.personId } } },
      ];
    }

    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const expenses = await this.prisma.expense.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 50,
      skip: query.offset ?? 0,
      include: EXPENSE_INCLUDE,
    });

    return expenses.map((expense) => this.present(expense));
  }

  /** Totals for the two questions the ledger exists to answer. */
  async getSummary(userId: string) {
    const [owedToMe, iOwe] = await Promise.all([
      this.prisma.expenseParticipant.aggregate({
        _sum: { shareAmount: true },
        where: { status: 'PENDING', isMe: false, expense: { userId, paidByMe: true } },
      }),
      this.prisma.expenseParticipant.aggregate({
        _sum: { shareAmount: true },
        where: { status: 'PENDING', isMe: true, expense: { userId, paidByMe: false } },
      }),
    ]);

    const totalOwedToMe = owedToMe._sum.shareAmount ?? new Prisma.Decimal(0);
    const totalIOwe = iOwe._sum.shareAmount ?? new Prisma.Decimal(0);

    return {
      totalOwedToMe: toNumber(totalOwedToMe),
      totalIOwe: toNumber(totalIOwe),
      netBalance: toNumber(totalOwedToMe.sub(totalIOwe)),
    };
  }

  /**
   * Settles the oldest outstanding amount with a contact, in whichever
   * direction it runs - their unpaid share of something I paid for, or my
   * unpaid share of something they paid for.
   */
  async settleWithPerson(userId: string, personId: string) {
    const participant = await this.prisma.expenseParticipant.findFirst({
      where: {
        status: 'PENDING',
        expense: { userId },
        OR: [
          { personId, expense: { userId, paidByMe: true } },
          { isMe: true, expense: { userId, paidById: personId } },
        ],
      },
      orderBy: { expense: { createdAt: 'asc' } },
    });

    if (!participant) {
      throw new NotFoundException('No outstanding amount with this contact.');
    }

    return this.settleParticipant(userId, participant.id);
  }

  async findOne(userId: string, id: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, userId },
      include: EXPENSE_INCLUDE,
    });

    if (!expense) {
      throw new NotFoundException(`Expense with ID ${id} not found`);
    }

    return this.present(expense);
  }
}
