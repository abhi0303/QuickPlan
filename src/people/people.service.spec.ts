import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PeopleService } from './people.service';
import { PrismaService } from '../prisma/prisma.service';

const d = (value: string | number) => new Prisma.Decimal(value);

describe('PeopleService balances', () => {
  let service: PeopleService;

  const mockPrismaService = {
    person: { findMany: jest.fn(), upsert: jest.fn(), create: jest.fn(), findFirst: jest.fn() },
    expenseParticipant: { findMany: jest.fn() },
    expense: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [PeopleService, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();
    service = module.get<PeopleService>(PeopleService);
  });

  /**
   * The regression this guards: a payable used to leave youOwePerson at 0
   * because the balance was read off the contact's row status instead of
   * who actually paid.
   */
  it('reports money I owe when the contact fronted the bill', async () => {
    mockPrismaService.person.findMany.mockResolvedValue([
      {
        id: 'p1',
        name: 'Rahul',
        nickname: null,
        phone: null,
        email: null,
        participants: [],
        paidExpenses: [{ participants: [{ shareAmount: d(500) }] }],
      },
    ]);

    const [rahul] = await service.findAllWithBalances('user-1');

    expect(rahul.youOwePerson).toBe(500);
    expect(rahul.personOwesYou).toBe(0);
    expect(rahul.netBalance).toBe(-500);
  });

  it('nets both directions against each other', async () => {
    mockPrismaService.person.findMany.mockResolvedValue([
      {
        id: 'p1',
        name: 'Rahul',
        nickname: null,
        phone: null,
        email: null,
        participants: [{ shareAmount: d(200), expense: { paidByMe: true } }],
        paidExpenses: [{ participants: [{ shareAmount: d(500) }] }],
      },
    ]);

    const [rahul] = await service.findAllWithBalances('user-1');

    expect(rahul.personOwesYou).toBe(200);
    expect(rahul.youOwePerson).toBe(500);
    expect(rahul.netBalance).toBe(-300);
  });

  it('sums decimal shares without floating point drift', async () => {
    mockPrismaService.person.findMany.mockResolvedValue([
      {
        id: 'p1',
        name: 'Priya',
        nickname: null,
        phone: null,
        email: null,
        participants: [
          { shareAmount: d('33.33'), expense: { paidByMe: true } },
          { shareAmount: d('33.33'), expense: { paidByMe: true } },
          { shareAmount: d('33.34'), expense: { paidByMe: true } },
        ],
        paidExpenses: [],
      },
    ]);

    const [priya] = await service.findAllWithBalances('user-1');
    expect(priya.personOwesYou).toBe(100);
  });

  it('folds case variants onto one contact key', async () => {
    mockPrismaService.person.upsert.mockResolvedValue({ id: 'p1', name: 'Rahul' });

    await service.findOrCreateByName('user-1', '  RaHuL  ');

    expect(mockPrismaService.person.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_nameKey: { userId: 'user-1', nameKey: 'rahul' } },
        create: { userId: 'user-1', name: 'RaHuL', nameKey: 'rahul' },
      }),
    );
  });
});
