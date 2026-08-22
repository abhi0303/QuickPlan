import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryNotificationsDto, NotificationStatus } from './dto/query-notifications.dto';
import { MarkReadDto } from './dto/mark-read.dto';

const ACTOR = { select: { id: true, name: true } } as const;

interface Cursor {
  createdAt: string;
  id: string;
}

@Injectable()
export class NotificationFeedService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Keyset pagination on (createdAt, id). An offset would skip or repeat rows
   * as new notifications arrive at the top of the list while the user pages.
   */
  async list(userId: string, query: QueryNotificationsDto) {
    const limit = query.limit ?? 20;
    const cursor = this.decodeCursor(query.cursor);

    const where: Prisma.NotificationWhereInput = { userId };

    if (query.status === NotificationStatus.UNREAD) {
      where.readAt = null;
    }

    if (cursor) {
      where.OR = [
        { createdAt: { lt: new Date(cursor.createdAt) } },
        { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
      ];
    }

    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        // One extra row tells us whether another page exists without a count.
        take: limit + 1,
        include: { actor: ACTOR },
      }),
      this.unreadCount(userId),
    ]);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];

    return {
      unreadCount,
      items: items.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        url: row.url,
        actor: row.actor,
        groupId: row.groupId,
        entityId: row.entityId,
        data: row.data ?? {},
        readAt: row.readAt,
        createdAt: row.createdAt,
      })),
      nextCursor:
        hasMore && last
          ? this.encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  /**
   * Idempotent: only rows still unread are touched, so re-marking cannot
   * rewrite a timestamp and is never an error.
   */
  async markRead(userId: string, dto: MarkReadDto) {
    const where: Prisma.NotificationWhereInput = { userId, readAt: null };

    if (!dto.all) {
      where.id = { in: dto.ids ?? [] };
    }

    await this.prisma.notification.updateMany({ where, data: { readAt: new Date() } });

    return { unreadCount: await this.unreadCount(userId) };
  }

  async remove(userId: string, id: string) {
    const { count } = await this.prisma.notification.deleteMany({ where: { id, userId } });

    return { deleted: count > 0, unreadCount: await this.unreadCount(userId) };
  }

  /** Older than 90 days, as agreed with the frontend. */
  async purgeOlderThan(days = 90): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    return count;
  }

  private encodeCursor(cursor: Cursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  private decodeCursor(raw?: string): Cursor | null {
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));

      if (typeof parsed?.createdAt === 'string' && typeof parsed?.id === 'string') {
        return parsed;
      }
    } catch {
      // A malformed cursor just starts from the top rather than erroring.
    }

    return null;
  }
}
