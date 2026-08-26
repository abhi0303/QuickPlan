import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExpenseScope, GroupRole, Prisma, SplitType } from '@prisma/client';
import { ExpensesService } from './expenses.service';
import { PrismaService } from '../prisma/prisma.service';
import { GroupAccessService } from '../groups/group-access.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationEmitter } from '../notifications/notification-emitter.service';

describe('ExpensesService', () => {
  let service: ExpensesService;

  const MEMBERS = ['u1', 'u2', 'u3'];

  const created = jest.fn(({ data, include }) =>
    Promise.resolve({
      id: 'e1',
      groupId: 'g1',
      ...data,
      paidBy: { id: data.paidById, name: 'Payer' },
      createdBy: { id: data.createdById, name: 'Author' },
      shares: (data.shares?.create ?? []).map((s: any, i: number) => ({
        id: `s${i}`,
        ...s,
        user: { id: s.userId, name: s.userId },
      })),
    }),
  );

  const prisma = {
    expense: { create: created, findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), update: jest.fn(), delete: jest.fn().mockResolvedValue({}) },
    expenseShare: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    groupMember: { findMany: jest.fn().mockResolvedValue(MEMBERS.map((userId) => ({ userId }))) },
    group: { update: jest.fn(), findUnique: jest.fn().mockResolvedValue({ name: 'G', currency: 'INR' }) },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Actor' }) },
    $transaction: jest.fn((fn) => fn(prisma)),
  };

  const access = {
    requireMembership: jest.fn().mockResolvedValue({ role: GroupRole.MEMBER }),
  };
  const emitter = { emit: jest.fn(), emitOne: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.groupMember.findMany.mockResolvedValue(MEMBERS.map((userId) => ({ userId })));
    access.requireMembership.mockResolvedValue({ role: GroupRole.MEMBER });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesService,
        { provide: PrismaService, useValue: prisma },
        { provide: GroupAccessService, useValue: access },
        { provide: NotificationEmitter, useValue: emitter },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    service = module.get(ExpensesService);
  });

  const sharesOf = () =>
    created.mock.calls[0][0].data.shares.create as Array<{ userId: string; amount: Prisma.Decimal }>;

  describe('splitting', () => {
    it('splits equally across every member by default', async () => {
      await service.create('u1', 'g1', { title: 'Dinner', totalAmount: 1200 });

      expect(sharesOf().map((s) => s.amount.toString())).toEqual(['400', '400', '400']);
    });

    it('splits equally across only the named members', async () => {
      await service.create('u1', 'g1', {
        title: 'Cab',
        totalAmount: 100,
        shares: [{ userId: 'u1', value: 0 }, { userId: 'u2', value: 0 }],
      });

      expect(sharesOf().map((s) => s.userId)).toEqual(['u1', 'u2']);
      expect(sharesOf().map((s) => s.amount.toString())).toEqual(['50', '50']);
    });

    it('rejects exact shares that do not add up to the total', async () => {
      await expect(
        service.create('u1', 'g1', {
          title: 'Dinner',
          totalAmount: 1000,
          splitType: SplitType.EXACT,
          shares: [{ userId: 'u1', value: 400 }, { userId: 'u2', value: 400 }],
        }),
      ).rejects.toThrow(/add up to 800.*total is 1000/);
    });

    it('accepts exact shares that balance', async () => {
      await service.create('u1', 'g1', {
        title: 'Dinner',
        totalAmount: 1000,
        splitType: SplitType.EXACT,
        shares: [{ userId: 'u1', value: 600 }, { userId: 'u2', value: 400 }],
      });

      expect(sharesOf().map((s) => s.amount.toString())).toEqual(['600', '400']);
    });

    it('rejects percentages that do not total 100', async () => {
      await expect(
        service.create('u1', 'g1', {
          title: 'Rent',
          totalAmount: 900,
          splitType: SplitType.PERCENTAGE,
          shares: [{ userId: 'u1', value: 50 }, { userId: 'u2', value: 30 }],
        }),
      ).rejects.toThrow(/add up to 80, not 100/);
    });

    it('keeps percentage shares summing to the exact total', async () => {
      await service.create('u1', 'g1', {
        title: 'Rent',
        totalAmount: 100,
        splitType: SplitType.PERCENTAGE,
        shares: [
          { userId: 'u1', value: 33.33 },
          { userId: 'u2', value: 33.33 },
          { userId: 'u3', value: 33.34 },
        ],
      });

      const total = sharesOf().reduce((a, s) => a.add(s.amount), new Prisma.Decimal(0));
      expect(total.toString()).toBe('100');
    });

    it('refuses a share for someone outside the group', async () => {
      await expect(
        service.create('u1', 'g1', {
          title: 'Dinner',
          totalAmount: 100,
          splitType: SplitType.EXACT,
          shares: [{ userId: 'outsider', value: 100 }],
        }),
      ).rejects.toThrow(/member of this group/);
    });

    it('refuses a payer outside the group', async () => {
      await expect(
        service.create('u1', 'g1', { title: 'Dinner', totalAmount: 100, paidById: 'outsider' }),
      ).rejects.toThrow(/payer must be a member/);
    });

    it('refuses the same member twice in one split', async () => {
      await expect(
        service.create('u1', 'g1', {
          title: 'Dinner',
          totalAmount: 100,
          splitType: SplitType.EXACT,
          shares: [{ userId: 'u1', value: 50 }, { userId: 'u1', value: 50 }],
        }),
      ).rejects.toThrow(/more than once/);
    });
  });

  describe('permissions', () => {
    it('hides an expense in a group the caller does not belong to', async () => {
      prisma.expense.findUnique.mockResolvedValue({ id: 'e1', groupId: 'other' });
      access.requireMembership.mockRejectedValue(new NotFoundException());

      await expect(service.findOne('outsider', 'e1')).rejects.toThrow(NotFoundException);
    });

    it('stops a member editing an expense somebody else recorded', async () => {
      prisma.expense.findUnique.mockResolvedValue({ id: 'e1', groupId: 'g1', createdById: 'u2' });
      access.requireMembership.mockResolvedValue({ role: GroupRole.MEMBER });

      await expect(service.update('u1', 'e1', { title: 'x' })).rejects.toThrow(ForbiddenException);
    });

    it('lets a group owner edit anyone\'s expense', async () => {
      prisma.expense.findUnique.mockResolvedValue({
        id: 'e1', groupId: 'g1', createdById: 'u2', paidById: 'u2',
        totalAmount: new Prisma.Decimal(100), splitType: SplitType.EQUAL,
      });
      access.requireMembership.mockResolvedValue({ role: GroupRole.OWNER });
      prisma.expense.update.mockResolvedValue({
        id: 'e1', totalAmount: new Prisma.Decimal(100), paidById: 'u2',
        shares: [], paidBy: {}, createdBy: {},
      });

      await expect(service.update('u1', 'e1', { title: 'Renamed' })).resolves.toBeDefined();
    });

    it('lets the author edit their own expense', async () => {
      prisma.expense.findUnique.mockResolvedValue({
        id: 'e1', groupId: 'g1', createdById: 'u1', paidById: 'u1',
        totalAmount: new Prisma.Decimal(100), splitType: SplitType.EQUAL,
      });
      prisma.expense.update.mockResolvedValue({
        id: 'e1', totalAmount: new Prisma.Decimal(100), paidById: 'u1',
        shares: [], paidBy: {}, createdBy: {},
      });

      await expect(service.update('u1', 'e1', { title: 'Renamed' })).resolves.toBeDefined();
    });
  });

  describe('personal expenses', () => {
    it('records no group, no payer and no split', async () => {
      await service.createPersonal('u1', { title: 'Petrol', totalAmount: 400 });

      const data = created.mock.calls[0][0].data;
      expect(data.scope).toBe(ExpenseScope.PERSONAL);
      expect(data.ownerId).toBe('u1');
      expect(data.groupId).toBeNull();
      expect(data.paidById).toBeNull();
      expect(data.splitType).toBeNull();
    });

    it('reports myShare as the whole amount, since it is all yours', async () => {
      const result = await service.createPersonal('u1', { title: 'Coffee', totalAmount: 150 });

      expect(result.myShare).toBe(150);
      expect(result.shares).toEqual([]);
      expect(result.iPaid).toBe(true);
    });

    it('maps notes onto the stored description', async () => {
      await service.createPersonal('u1', { title: 'Petrol', totalAmount: 400, notes: 'Sector 18' });

      expect(created.mock.calls[0][0].data.description).toBe('Sector 18');
    });

    /** The check constraint should never be reachable from the API. */
    it.each(['groupId', 'paidById', 'splitType', 'shares'])(
      'rejects the group-only field %s',
      async (field) => {
        await expect(
          service.createPersonal('u1', { title: 'x', totalAmount: 1 } as never, {
            title: 'x',
            totalAmount: 1,
            [field]: 'value',
          }),
        ).rejects.toThrow(/group expense/);
      },
    );

    it('scopes the list to the caller and orders by date', async () => {
      await service.findAllPersonal('u1', {});

      const call = prisma.expense.findMany.mock.calls[0][0];
      expect(call.where).toMatchObject({ scope: ExpenseScope.PERSONAL, ownerId: 'u1' });
      expect(call.orderBy).toEqual([{ date: 'desc' }, { id: 'desc' }]);
    });

    it('hides another owner\'s personal expense behind a 404', async () => {
      prisma.expense.findUnique.mockResolvedValue({
        id: 'e1', scope: ExpenseScope.PERSONAL, ownerId: 'someone-else',
      });

      await expect(service.findOne('u1', 'e1')).rejects.toThrow(NotFoundException);
      await expect(service.update('u1', 'e1', { title: 'x' })).rejects.toThrow(NotFoundException);
      await expect(service.remove('u1', 'e1')).rejects.toThrow(NotFoundException);
    });

    it('lets the owner delete their own', async () => {
      prisma.expense.findUnique.mockResolvedValue({
        id: 'e1', scope: ExpenseScope.PERSONAL, ownerId: 'u1',
      });

      await expect(service.remove('u1', 'e1')).resolves.toEqual({ deleted: true, expenseId: 'e1' });
    });
  });

  describe('group expenses keep their shape', () => {
    it('sets scope GROUP and owns the expense to the payer', async () => {
      await service.create('u1', 'g1', { title: 'Dinner', totalAmount: 1200, paidById: 'u2' });

      const data = created.mock.calls[0][0].data;
      expect(data.scope).toBe(ExpenseScope.GROUP);
      expect(data.ownerId).toBe('u2');
      expect(data.groupId).toBe('g1');
    });
  });
});