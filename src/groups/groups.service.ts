import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { GroupRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FriendsService } from '../friends/friends.service';
import { GroupAccessService } from './group-access.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { suggestSettlements, toNumber, ZERO } from '../common/money';

const MEMBER_INCLUDE = {
  members: {
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { joinedAt: 'asc' as const },
  },
};

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly friendsService: FriendsService,
    private readonly access: GroupAccessService,
  ) {}

  /**
   * The creator becomes OWNER. Members can only be added from the creator's
   * own friend list, so a group cannot be seeded with strangers.
   */
  async create(userId: string, dto: CreateGroupDto) {
    const memberIds = [...new Set(dto.memberIds ?? [])].filter((id) => id !== userId);

    await this.assertAllAreFriends(userId, memberIds);

    return this.prisma.group.create({
      data: {
        name: dto.name,
        description: dto.description,
        currency: dto.currency ?? 'INR',
        createdById: userId,
        members: {
          create: [
            { userId, role: GroupRole.OWNER },
            ...memberIds.map((id) => ({ userId: id, role: GroupRole.MEMBER })),
          ],
        },
      },
      include: MEMBER_INCLUDE,
    });
  }

  /** Only groups the caller belongs to, each with the caller's own net position. */
  async listMine(userId: string) {
    const groups = await this.prisma.group.findMany({
      where: { members: { some: { userId } } },
      include: {
        ...MEMBER_INCLUDE,
        _count: { select: { expenses: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return Promise.all(
      groups.map(async (group) => {
        const balances = await this.balancesFor(group.id);
        const mine = balances.find((b) => b.userId === userId);

        return {
          id: group.id,
          name: group.name,
          description: group.description,
          currency: group.currency,
          createdById: group.createdById,
          myRole: group.members.find((m) => m.userId === userId)?.role,
          memberCount: group.members.length,
          expenseCount: group._count.expenses,
          members: group.members.map((m) => ({ ...m.user, role: m.role })),
          myNetBalance: mine?.net ?? 0,
          updatedAt: group.updatedAt,
        };
      }),
    );
  }

  async findOne(userId: string, groupId: string) {
    await this.access.requireMembership(userId, groupId);

    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: MEMBER_INCLUDE,
    });

    if (!group) {
      throw new NotFoundException(`Group ${groupId} not found`);
    }

    return {
      ...group,
      myRole: group.members.find((m) => m.userId === userId)?.role,
      members: group.members.map((m) => ({ ...m.user, role: m.role, joinedAt: m.joinedAt })),
    };
  }

  async update(userId: string, groupId: string, dto: UpdateGroupDto) {
    await this.access.requireOwner(userId, groupId);

    return this.prisma.group.update({
      where: { id: groupId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
      },
      include: MEMBER_INCLUDE,
    });
  }

  /**
   * Owners only. Promoting a member to OWNER gives them exactly the same
   * powers, including this one, which is what "both can delete" means.
   */
  async remove(userId: string, groupId: string) {
    await this.access.requireOwner(userId, groupId);
    await this.prisma.group.delete({ where: { id: groupId } });

    return { deleted: true, groupId };
  }

  async addMembers(userId: string, groupId: string, memberIds: string[]) {
    await this.access.requireOwner(userId, groupId);

    const unique = [...new Set(memberIds)];
    await this.assertAllAreFriends(userId, unique);

    await this.prisma.groupMember.createMany({
      data: unique.map((id) => ({ groupId, userId: id, role: GroupRole.MEMBER })),
      skipDuplicates: true,
    });

    return this.findOne(userId, groupId);
  }

  /**
   * A member with money outstanding cannot be removed: dropping them would
   * silently erase a debt that the rest of the group is still owed.
   */
  async removeMember(userId: string, groupId: string, memberId: string) {
    const isSelf = userId === memberId;

    if (!isSelf) {
      await this.access.requireOwner(userId, groupId);
    } else {
      await this.access.requireMembership(userId, groupId);
    }

    const target = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: memberId } },
    });

    if (!target) {
      throw new NotFoundException('That user is not a member of this group.');
    }

    const balances = await this.balancesFor(groupId);
    const theirs = balances.find((b) => b.userId === memberId);

    if (theirs && Math.abs(theirs.net) > 0.009) {
      throw new BadRequestException(
        'Settle this member\'s balance before removing them from the group.',
      );
    }

    if (target.role === GroupRole.OWNER) {
      const owners = await this.prisma.groupMember.count({
        where: { groupId, role: GroupRole.OWNER },
      });

      if (owners <= 1) {
        throw new BadRequestException(
          'A group must keep at least one owner. Promote someone else first.',
        );
      }
    }

    await this.prisma.groupMember.delete({ where: { id: target.id } });

    return { removed: true, userId: memberId };
  }

  async setRole(userId: string, groupId: string, memberId: string, role: GroupRole) {
    await this.access.requireOwner(userId, groupId);

    const target = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: memberId } },
    });

    if (!target) {
      throw new NotFoundException('That user is not a member of this group.');
    }

    if (target.role === GroupRole.OWNER && role === GroupRole.MEMBER) {
      const owners = await this.prisma.groupMember.count({
        where: { groupId, role: GroupRole.OWNER },
      });

      if (owners <= 1) {
        throw new BadRequestException('A group must keep at least one owner.');
      }
    }

    return this.prisma.groupMember.update({ where: { id: target.id }, data: { role } });
  }

  /**
   * Net position per member: what they paid, minus what they owe, adjusted by
   * settlements already made. Positive means the group owes them.
   */
  async balancesFor(groupId: string) {
    const [members, expenses, shares, settlements] = await Promise.all([
      this.prisma.groupMember.findMany({
        where: { groupId },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.expense.groupBy({
        by: ['paidById'],
        where: { groupId },
        _sum: { totalAmount: true },
      }),
      this.prisma.expenseShare.groupBy({
        by: ['userId'],
        where: { expense: { groupId } },
        _sum: { amount: true },
      }),
      this.prisma.settlement.findMany({ where: { groupId } }),
    ]);

    const paid = new Map(expenses.map((e) => [e.paidById, e._sum.totalAmount ?? ZERO]));
    const owed = new Map(shares.map((s) => [s.userId, s._sum.amount ?? ZERO]));

    return members.map((member) => {
      const paidTotal = paid.get(member.userId) ?? ZERO;
      const owedTotal = owed.get(member.userId) ?? ZERO;

      // Paying someone reduces what you owe; receiving increases it back.
      const sentTotal = settlements
        .filter((s) => s.fromUserId === member.userId)
        .reduce((sum, s) => sum.add(s.amount), ZERO);
      const receivedTotal = settlements
        .filter((s) => s.toUserId === member.userId)
        .reduce((sum, s) => sum.add(s.amount), ZERO);

      const net = paidTotal.sub(owedTotal).add(sentTotal).sub(receivedTotal);

      return {
        userId: member.userId,
        name: member.user.name,
        email: member.user.email,
        role: member.role,
        paid: toNumber(paidTotal),
        owed: toNumber(owedTotal),
        settlementsSent: toNumber(sentTotal),
        settlementsReceived: toNumber(receivedTotal),
        net: toNumber(net),
        netDecimal: net,
      };
    });
  }

  /** Balance sheet plus the shortest set of payments that clears it. */
  async getBalances(userId: string, groupId: string) {
    await this.access.requireMembership(userId, groupId);

    const balances = await this.balancesFor(groupId);
    const transfers = suggestSettlements(
      balances.map((b) => ({ userId: b.userId, net: b.netDecimal as Prisma.Decimal })),
    );

    const byId = new Map(balances.map((b) => [b.userId, b]));

    return {
      members: balances.map(({ netDecimal, ...rest }) => rest),
      suggestedSettlements: transfers.map((t) => ({
        fromUserId: t.fromUserId,
        fromName: byId.get(t.fromUserId)?.name ?? null,
        toUserId: t.toUserId,
        toName: byId.get(t.toUserId)?.name ?? null,
        amount: toNumber(t.amount),
      })),
      myNetBalance: byId.get(userId)?.net ?? 0,
    };
  }

  private async assertAllAreFriends(userId: string, memberIds: string[]) {
    for (const id of memberIds) {
      if (!(await this.friendsService.areFriends(userId, id))) {
        throw new ForbiddenException(
          'You can only add your own friends to a group. Add them as a friend first.',
        );
      }
    }
  }
}
