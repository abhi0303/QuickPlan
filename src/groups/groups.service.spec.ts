import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { GroupRole, Prisma } from '@prisma/client';
import { GroupsService } from './groups.service';
import { PrismaService } from '../prisma/prisma.service';
import { FriendsService } from '../friends/friends.service';
import { GroupAccessService } from './group-access.service';

const d = (v: string | number) => new Prisma.Decimal(v);

describe('GroupsService', () => {
  let service: GroupsService;

  const prisma = {
    group: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
    groupMember: { findMany: jest.fn(), findUnique: jest.fn(), createMany: jest.fn(), delete: jest.fn(), update: jest.fn(), count: jest.fn() },
    expense: { groupBy: jest.fn().mockResolvedValue([]) },
    expenseShare: { groupBy: jest.fn().mockResolvedValue([]) },
    settlement: { findMany: jest.fn().mockResolvedValue([]) },
  };

  const friends = { areFriends: jest.fn().mockResolvedValue(true) };
  const access = { requireMembership: jest.fn(), requireOwner: jest.fn(), memberGroupIds: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    friends.areFriends.mockResolvedValue(true);
    prisma.expense.groupBy.mockResolvedValue([]);
    prisma.expenseShare.groupBy.mockResolvedValue([]);
    prisma.settlement.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupsService,
        { provide: PrismaService, useValue: prisma },
        { provide: FriendsService, useValue: friends },
        { provide: GroupAccessService, useValue: access },
      ],
    }).compile();
    service = module.get(GroupsService);
  });

  describe('create', () => {
    it('makes the creator an owner and the rest members', async () => {
      prisma.group.create.mockResolvedValue({ id: 'g1' });

      await service.create('u1', { name: 'Goa', memberIds: ['u2', 'u3'] });

      const members = prisma.group.create.mock.calls[0][0].data.members.create;
      expect(members).toEqual([
        { userId: 'u1', role: GroupRole.OWNER },
        { userId: 'u2', role: GroupRole.MEMBER },
        { userId: 'u3', role: GroupRole.MEMBER },
      ]);
    });

    it('refuses to seed a group with someone who is not a friend', async () => {
      friends.areFriends.mockResolvedValue(false);

      await expect(service.create('u1', { name: 'Goa', memberIds: ['stranger'] })).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.group.create).not.toHaveBeenCalled();
    });

    it('ignores the creator appearing in the member list twice', async () => {
      prisma.group.create.mockResolvedValue({ id: 'g1' });

      await service.create('u1', { name: 'Goa', memberIds: ['u1', 'u2', 'u2'] });

      const members = prisma.group.create.mock.calls[0][0].data.members.create;
      expect(members.map((m: any) => m.userId)).toEqual(['u1', 'u2']);
    });
  });

  describe('balances', () => {
    const members = [
      { userId: 'u1', role: GroupRole.OWNER, user: { id: 'u1', name: 'A', email: null } },
      { userId: 'u2', role: GroupRole.MEMBER, user: { id: 'u2', name: 'B', email: null } },
    ];

    it('nets what you paid against what you owe', async () => {
      prisma.groupMember.findMany.mockResolvedValue(members);
      prisma.expense.groupBy.mockResolvedValue([{ paidById: 'u1', _sum: { totalAmount: d(1000) } }]);
      prisma.expenseShare.groupBy.mockResolvedValue([
        { userId: 'u1', _sum: { amount: d(500) } },
        { userId: 'u2', _sum: { amount: d(500) } },
      ]);

      const balances = await service.balancesFor('g1');

      expect(balances.find((b) => b.userId === 'u1')?.net).toBe(500);
      expect(balances.find((b) => b.userId === 'u2')?.net).toBe(-500);
    });

    it('a recorded payment clears the debt', async () => {
      prisma.groupMember.findMany.mockResolvedValue(members);
      prisma.expense.groupBy.mockResolvedValue([{ paidById: 'u1', _sum: { totalAmount: d(1000) } }]);
      prisma.expenseShare.groupBy.mockResolvedValue([
        { userId: 'u1', _sum: { amount: d(500) } },
        { userId: 'u2', _sum: { amount: d(500) } },
      ]);
      prisma.settlement.findMany.mockResolvedValue([
        { fromUserId: 'u2', toUserId: 'u1', amount: d(500) },
      ]);

      const balances = await service.balancesFor('g1');

      expect(balances.every((b) => b.net === 0)).toBe(true);
    });

    it('a partial payment leaves the remainder outstanding', async () => {
      prisma.groupMember.findMany.mockResolvedValue(members);
      prisma.expense.groupBy.mockResolvedValue([{ paidById: 'u1', _sum: { totalAmount: d(1000) } }]);
      prisma.expenseShare.groupBy.mockResolvedValue([
        { userId: 'u1', _sum: { amount: d(500) } },
        { userId: 'u2', _sum: { amount: d(500) } },
      ]);
      prisma.settlement.findMany.mockResolvedValue([
        { fromUserId: 'u2', toUserId: 'u1', amount: d(200) },
      ]);

      const balances = await service.balancesFor('g1');

      expect(balances.find((b) => b.userId === 'u2')?.net).toBe(-300);
      expect(balances.find((b) => b.userId === 'u1')?.net).toBe(300);
    });
  });

  describe('membership rules', () => {
    it('will not remove a member who still owes money', async () => {
      access.requireOwner.mockResolvedValue({ role: GroupRole.OWNER });
      prisma.groupMember.findUnique.mockResolvedValue({ id: 'm2', role: GroupRole.MEMBER });
      prisma.groupMember.findMany.mockResolvedValue([
        { userId: 'u2', role: GroupRole.MEMBER, user: { id: 'u2', name: 'B', email: null } },
      ]);
      prisma.expenseShare.groupBy.mockResolvedValue([{ userId: 'u2', _sum: { amount: d(500) } }]);

      await expect(service.removeMember('u1', 'g1', 'u2')).rejects.toThrow(/Settle/);
      expect(prisma.groupMember.delete).not.toHaveBeenCalled();
    });

    it('will not remove the last owner', async () => {
      access.requireOwner.mockResolvedValue({ role: GroupRole.OWNER });
      prisma.groupMember.findUnique.mockResolvedValue({ id: 'm1', role: GroupRole.OWNER });
      prisma.groupMember.findMany.mockResolvedValue([]);
      prisma.groupMember.count.mockResolvedValue(1);

      await expect(service.removeMember('u1', 'g1', 'u1')).rejects.toThrow(/at least one owner/);
    });

    it('requires ownership to delete a group', async () => {
      access.requireOwner.mockRejectedValue(new ForbiddenException());

      await expect(service.remove('u2', 'g1')).rejects.toThrow(ForbiddenException);
      expect(prisma.group.delete).not.toHaveBeenCalled();
    });

    it('lets a promoted owner delete the group', async () => {
      access.requireOwner.mockResolvedValue({ role: GroupRole.OWNER });
      prisma.group.delete.mockResolvedValue({});

      await expect(service.remove('u2', 'g1')).resolves.toEqual({ deleted: true, groupId: 'g1' });
    });

    it('will not demote the only owner', async () => {
      access.requireOwner.mockResolvedValue({ role: GroupRole.OWNER });
      prisma.groupMember.findUnique.mockResolvedValue({ id: 'm1', role: GroupRole.OWNER });
      prisma.groupMember.count.mockResolvedValue(1);

      await expect(service.setRole('u1', 'g1', 'u1', GroupRole.MEMBER)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
