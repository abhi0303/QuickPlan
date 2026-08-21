import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ExpensesService } from './expenses.service';
import { PrismaService } from '../prisma/prisma.service';
import { PeopleService } from '../people/people.service';
import { IOUDirection } from './dto/create-iou.dto';
import { ExpenseDirection } from './dto/query-expenses.dto';

describe('ExpensesService', () => {
  let service: ExpensesService;

  // Mirrors what Prisma returns for the service's include: participants come
  // back as an array, not as the nested `create` payload that was written.
  const expenseCreate = jest.fn(({ data }) =>
    Promise.resolve({
      id: 'expense-1',
      ...data,
      paidBy: null,
      participants: (data.participants?.create ?? []).map((p: any, i: number) => ({
        id: `part-${i}`,
        personId: p.person?.connect?.id ?? null,
        person: null,
        ...p,
      })),
    }),
  );

  const mockPrismaService = {
    expense: {
      create: expenseCreate,
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    expenseParticipant: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
  };

  const mockPeopleService = {
    findOrCreateByName: jest.fn((userId: string, name: string) =>
      Promise.resolve({ id: `person-${name}`, userId, name }),
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: PeopleService, useValue: mockPeopleService },
      ],
    }).compile();

    service = module.get<ExpensesService>(ExpensesService);
  });

  describe('splitExpense', () => {
    it('splits evenly when the amount divides cleanly', async () => {
      const result = await service.splitExpense('user-1', {
        title: 'Pizza Night',
        totalAmount: 500,
        participantsCount: 5,
        paidByMe: true,
      });

      expect(result.myShare).toBe(100);
      expect(result.othersOweTotal).toBe(400);
      expect(result.direction).toBe(ExpenseDirection.OWED_TO_ME);
    });

    it('assigns the rounding remainder so shares sum to the exact total', async () => {
      await service.splitExpense('user-1', {
        title: 'Dinner',
        totalAmount: 100,
        participantsCount: 3,
        paidByMe: true,
      });

      const shares: Prisma.Decimal[] = expenseCreate.mock.calls[0][0].data.participants.create.map(
        (p: any) => p.shareAmount,
      );
      const sum = shares.reduce((a, b) => a.add(b), new Prisma.Decimal(0));

      expect(sum.toString()).toBe('100');
      expect(shares.map((s) => s.toString())).toEqual(['33.34', '33.33', '33.33']);
    });

    it('records that I owe my share when somebody else paid', async () => {
      const result = await service.splitExpense('user-1', {
        title: 'Cab',
        totalAmount: 300,
        participantsCount: 3,
        paidByMe: false,
        names: ['Priya', 'Rahul'],
      });

      const data = expenseCreate.mock.calls[0][0].data;
      expect(data.paidByMe).toBe(false);
      expect(data.paidById).toBe('person-Priya');
      expect(result.youOweTotal).toBe(100);
      expect(result.othersOweTotal).toBe(0);
      expect(result.direction).toBe(ExpenseDirection.I_OWE);

      // The payer does not owe themselves.
      const payerRow = data.participants.create.find(
        (p: any) => p.person?.connect?.id === 'person-Priya',
      );
      expect(payerRow.status).toBe('PAID');
    });

    it('rejects a split someone else paid without naming the payer', async () => {
      await expect(
        service.splitExpense('user-1', {
          title: 'Cab',
          totalAmount: 300,
          participantsCount: 3,
          paidByMe: false,
        }),
      ).rejects.toThrow(/who paid/i);
    });

    it('rejects more names than there are other participants', async () => {
      await expect(
        service.splitExpense('user-1', {
          title: 'Cab',
          totalAmount: 300,
          participantsCount: 2,
          names: ['Priya', 'Rahul'],
        }),
      ).rejects.toThrow(/names given/i);
    });
  });

  describe('createIOU', () => {
    it('marks the contact as payer for money I owe', async () => {
      const result = await service.createIOU('user-1', {
        personName: 'Rahul',
        amount: 100,
        direction: IOUDirection.PAYABLE,
        reason: 'Pizza',
      });

      const data = expenseCreate.mock.calls[0][0].data;
      expect(data.type).toBe('IOU_PAYABLE');
      expect(data.paidByMe).toBe(false);
      expect(data.paidById).toBe('person-Rahul');
      expect(result.direction).toBe(ExpenseDirection.I_OWE);

      // One debt, one row - writing both sides double-counted every total.
      expect(data.participants.create).toHaveLength(1);
      expect(data.participants.create[0].isMe).toBe(true);
    });

    it('keeps the amount on the contact for money owed to me', async () => {
      const result = await service.createIOU('user-1', {
        personName: 'Rahul',
        amount: 250,
        direction: IOUDirection.RECEIVABLE,
      });

      const data = expenseCreate.mock.calls[0][0].data;
      expect(data.type).toBe('IOU_RECEIVABLE');
      expect(data.paidByMe).toBe(true);
      expect(data.paidById).toBeNull();
      expect(result.direction).toBe(ExpenseDirection.OWED_TO_ME);
      expect(data.participants.create[0].isMe).toBe(false);
    });
  });

  describe('findAll filtering', () => {
    it('translates direction into a paidByMe predicate', async () => {
      await service.findAll('user-1', { direction: ExpenseDirection.I_OWE });
      expect(mockPrismaService.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-1', paidByMe: false }),
        }),
      );

      await service.findAll('user-1', { direction: ExpenseDirection.OWED_TO_ME });
      expect(mockPrismaService.expense.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ paidByMe: true }),
        }),
      );
    });

    it('matches a contact as either payer or participant', async () => {
      await service.findAll('user-1', { personId: 'person-Rahul' });
      const where = mockPrismaService.expense.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { paidById: 'person-Rahul' },
        { participants: { some: { personId: 'person-Rahul' } } },
      ]);
    });

    it('bounds the page size by default', async () => {
      await service.findAll('user-1');
      expect(mockPrismaService.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50, skip: 0 }),
      );
    });
  });
});
