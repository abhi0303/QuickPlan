import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreatedVia, ExpenseScope, Prisma, RecurringCadence } from '@prisma/client';
import { RecurringService } from './recurring.service';
import { PrismaService } from '../prisma/prisma.service';
import { GroupAccessService } from '../groups/group-access.service';
import { NotificationEmitter } from '../notifications/notification-emitter.service';

describe('RecurringService.runDue', () => {
  let service: RecurringService;

  const NOW = new Date('2026-09-01T10:00:00Z');

  /** Mirrors the real guard: the update only matches while lastRunKey is unchanged. */
  const makeStore = (row: Record<string, unknown>) => {
    const state = { ...row };

    const prisma: any = {
      recurringExpense: {
        findMany: jest.fn(() => Promise.resolve([{ ...state }])),
        updateMany: jest.fn(({ where, data }: any) => {
          if (where.lastRunKey !== state.lastRunKey) {
            return Promise.resolve({ count: 0 });
          }

          Object.assign(state, data);

          return Promise.resolve({ count: 1 });
        }),
      },
      expense: {
        // Mirror Prisma: a nested `shares.create` comes back as an array.
        create: jest.fn(({ data }: any) =>
          Promise.resolve({
            id: 'e1',
            ...data,
            shares: (data.shares?.create ?? []).map((sh: any, i: number) => ({ id: `s${i}`, ...sh })),
          }),
        ),
      },
      groupMember: { findMany: jest.fn().mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]) },
      group: { findUnique: jest.fn().mockResolvedValue({ name: 'Flat', currency: 'INR' }) },
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'Abhinav' }) },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    return { state, prisma };
  };

  const base = {
    id: 'r1',
    userId: 'u1',
    scope: ExpenseScope.PERSONAL,
    groupId: null,
    title: 'Rent',
    amount: new Prisma.Decimal(18000),
    category: 'Rent',
    cadence: RecurringCadence.MONTHLY,
    dayOfMonth: 1,
    weekday: null,
    nextRunAt: new Date('2026-09-01T09:00:00Z'),
    lastRunKey: null as string | null,
    endsOn: null as Date | null,
    pausedAt: null as Date | null,
  };

  const build = async (prisma: unknown) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringService,
        { provide: PrismaService, useValue: prisma },
        { provide: GroupAccessService, useValue: { requireMembership: jest.fn() } },
        { provide: NotificationEmitter, useValue: { emit: jest.fn(), emitOne: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    return module.get(RecurringService);
  };

  it('creates the expense for a due row', async () => {
    const { prisma, state } = makeStore(base);
    service = await build(prisma);

    expect(await service.runDue(NOW)).toBe(1);
    expect(prisma.expense.create).toHaveBeenCalledTimes(1);
    expect(prisma.expense.create.mock.calls[0][0].data.createdVia).toBe(CreatedVia.SYSTEM);
    expect(state.lastRunKey).toBe('2026-09');
    // The schedule moves on, so the next sweep does not see it again.
    expect((state.nextRunAt as Date).toISOString().slice(0, 10)).toBe('2026-10-01');
  });

  /** The acceptance case: two sweeps of the same period must not create rent twice. */
  it('is a no-op on a second sweep of the same period', async () => {
    const { prisma, state } = makeStore(base);
    service = await build(prisma);

    await service.runDue(NOW);
    // Simulate a crashed sweep that advanced nothing: the key is written, so a
    // replay of the same period is refused.
    state.nextRunAt = new Date('2026-09-01T09:00:00Z');

    expect(await service.runDue(NOW)).toBe(0);
    expect(prisma.expense.create).toHaveBeenCalledTimes(1);
  });

  it('creates the next period once the schedule has moved on', async () => {
    const { prisma } = makeStore({ ...base, lastRunKey: '2026-08' });
    service = await build(prisma);

    expect(await service.runDue(NOW)).toBe(1);
  });

  it('leaves a paused schedule alone', async () => {
    const { prisma } = makeStore(base);
    prisma.recurringExpense.findMany.mockResolvedValue([]);
    service = await build(prisma);

    expect(await service.runDue(NOW)).toBe(0);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  it('asks only for rows that are due, unpaused and not past endsOn', async () => {
    const { prisma } = makeStore(base);
    service = await build(prisma);

    await service.runDue(NOW);

    const where = prisma.recurringExpense.findMany.mock.calls[0][0].where;
    expect(where.pausedAt).toBeNull();
    expect(where.nextRunAt).toEqual({ lte: NOW });
    expect(where.OR).toEqual([{ endsOn: null }, { endsOn: { gte: NOW } }]);
  });

  it('splits a group expense across the members present at run time', async () => {
    const { prisma } = makeStore({
      ...base,
      scope: ExpenseScope.GROUP,
      groupId: 'g1',
      amount: new Prisma.Decimal(900),
    });
    service = await build(prisma);

    expect(await service.runDue(NOW)).toBe(1);

    const shares = prisma.expense.create.mock.calls[0][0].data.shares.create;
    expect(shares).toHaveLength(2);
    expect(shares.map((s: any) => s.amount.toString())).toEqual(['450', '450']);
  });

  it('keeps going when one schedule fails', async () => {
    const { prisma } = makeStore(base);
    prisma.expense.create.mockRejectedValueOnce(new Error('db down'));
    service = await build(prisma);

    await expect(service.runDue(NOW)).resolves.toBe(0);
  });
});
