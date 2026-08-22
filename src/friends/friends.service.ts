import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationEmitter } from '../notifications/notification-emitter.service';
import { friendAdded } from '../notifications/notification-events';

const USER_CARD = { id: true, name: true, email: true } as const;

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: NotificationEmitter,
  ) {}

  /**
   * Search is how you find someone to add, so it exposes only a name, an email
   * and an id - never balances or group membership. Requires a real query so
   * the endpoint cannot be used to enumerate every account.
   */
  async searchUsers(userId: string, query: string, limit = 20) {
    const term = query?.trim() ?? '';

    if (term.length < 2) {
      throw new BadRequestException('Search needs at least 2 characters.');
    }

    const [users, friendships] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          id: { not: userId },
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { email: { contains: term, mode: 'insensitive' } },
          ],
        },
        select: USER_CARD,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.friendship.findMany({ where: { userId }, select: { friendId: true } }),
    ]);

    const friendIds = new Set(friendships.map((f) => f.friendId));

    return users.map((user) => ({ ...user, isFriend: friendIds.has(user.id) }));
  }

  /**
   * Writes both directions in one transaction. A one-way friendship would let
   * A add B to a group while B cannot see A in their own list.
   */
  async addFriend(userId: string, friendId: string) {
    if (userId === friendId) {
      throw new BadRequestException('You cannot add yourself as a friend.');
    }

    const friend = await this.prisma.user.findUnique({
      where: { id: friendId },
      select: USER_CARD,
    });

    if (!friend) {
      throw new NotFoundException(`User ${friendId} not found`);
    }

    const alreadyFriends = await this.areFriends(userId, friendId);

    await this.prisma.$transaction([
      this.prisma.friendship.upsert({
        where: { userId_friendId: { userId, friendId } },
        update: {},
        create: { userId, friendId },
      }),
      this.prisma.friendship.upsert({
        where: { userId_friendId: { userId: friendId, friendId: userId } },
        update: {},
        create: { userId: friendId, friendId: userId },
      }),
    ]);

    // Only on a genuinely new friendship - re-adding should not ping them again.
    if (!alreadyFriends) {
      const actor = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });

      await this.emitter.emitOne(friendAdded(friendId, userId, actor?.name ?? 'Someone'));
    }

    return friend;
  }

  async listFriends(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: { userId },
      include: { friend: { select: USER_CARD } },
      orderBy: { friend: { name: 'asc' } },
    });

    return friendships.map((f) => f.friend);
  }

  /**
   * Removing a friend does not touch shared groups or expenses - money already
   * recorded stays recorded, and both still see the group they share.
   */
  async removeFriend(userId: string, friendId: string) {
    const { count } = await this.prisma.friendship.deleteMany({
      where: {
        OR: [
          { userId, friendId },
          { userId: friendId, friendId: userId },
        ],
      },
    });

    return { removed: count };
  }

  async areFriends(userId: string, otherId: string): Promise<boolean> {
    const link = await this.prisma.friendship.findUnique({
      where: { userId_friendId: { userId, friendId: otherId } },
    });

    return link !== null;
  }
}
