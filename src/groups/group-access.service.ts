import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { GroupRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Every group read and write funnels through here. Membership is the only
 * thing that grants access, so a non-member gets 404 rather than 403 - telling
 * a stranger that a group exists is itself a leak.
 */
@Injectable()
export class GroupAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async requireMembership(userId: string, groupId: string) {
    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });

    if (!membership) {
      throw new NotFoundException(`Group ${groupId} not found`);
    }

    return membership;
  }

  async requireOwner(userId: string, groupId: string) {
    const membership = await this.requireMembership(userId, groupId);

    if (membership.role !== GroupRole.OWNER) {
      throw new ForbiddenException('Only a group owner can perform this action.');
    }

    return membership;
  }

  /** Ids of every group the user belongs to, for cross-group analytics. */
  async memberGroupIds(userId: string): Promise<string[]> {
    const memberships = await this.prisma.groupMember.findMany({
      where: { userId },
      select: { groupId: true },
    });

    return memberships.map((m) => m.groupId);
  }
}
