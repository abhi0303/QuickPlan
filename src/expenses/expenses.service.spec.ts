import { Test, TestingModule } from '@nestjs/testing';
import { ExpensesService } from './expenses.service';
import { PrismaService } from '../prisma/prisma.service';
import { PeopleService } from '../people/people.service';

describe('ExpensesService (Deterministic Math & Splits)', () => {
  let service: ExpensesService;
  let prisma: PrismaService;

  const mockPrismaService = {
    expense: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    expenseParticipant: {
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockPeopleService = {
    findOrCreateByName: jest.fn((userId, name) =>
      Promise.resolve({ id: `person-${name}`, userId, name }),
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: PeopleService, useValue: mockPeopleService },
      ],
    }).compile();

    service = module.get<ExpensesService>(ExpensesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should split ₹500 equally among 5 participants (1 Me + 4 Anonymous)', async () => {
    mockPrismaService.expense.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'expense-1',
        ...data,
      }),
    );

    const result = await service.splitExpense('user-1', {
      title: 'Pizza Night',
      totalAmount: 500,
      participantsCount: 5,
      paidByMe: true,
    });

    expect(result.myShare).toBe(100);
    expect(result.othersOweTotal).toBe(400);
    expect(mockPrismaService.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: 500,
          participantsCount: 5,
          unnamedParticipantsCount: 4,
        }),
      }),
    );
  });

  it('should create IOU payable ₹100 for Pizza to Rahul', async () => {
    mockPrismaService.expense.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'iou-1', ...data }),
    );

    const result = await service.createIOU('user-1', {
      personName: 'Rahul',
      amount: 100,
      direction: 'PAYABLE' as any,
      reason: 'Pizza',
    });

    expect(result).toBeDefined();
    expect(mockPeopleService.findOrCreateByName).toHaveBeenCalledWith('user-1', 'Rahul');
  });
});
