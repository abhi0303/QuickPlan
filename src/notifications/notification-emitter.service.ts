import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from './push.service';
import { NotificationInput } from './notification-events';

/**
 * The single path every notification takes: one feed row per recipient, then a
 * push to that recipient's devices. Sending a push without a row would leave a
 * user who missed the banner with no way to find out what happened; writing a
 * row without a push would leave the phone silent.
 */
@Injectable()
export class NotificationEmitter {
  private readonly logger = new Logger(NotificationEmitter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
  ) {}

  async emit(inputs: NotificationInput[]): Promise<void> {
    // Belt and braces: the callers already exclude the actor, but notifying
    // the person who pressed the button is the classic bug in this feature.
    const recipients = inputs.filter((input) => input.userId && input.userId !== input.actorId);

    if (recipients.length === 0) {
      return;
    }

    try {
      const rows = await this.prisma.notification.createManyAndReturn({
        data: recipients.map((input) => ({
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          url: input.url,
          actorId: input.actorId ?? null,
          groupId: input.groupId ?? null,
          entityId: input.entityId ?? null,
          data: (input.data ?? {}) as Prisma.InputJsonValue,
        })),
      });

      await Promise.all(
        rows.map(async (row, index) => {
          const input = recipients[index];

          const result = await this.pushService.sendToUser(row.userId, {
            title: row.title,
            body: row.body,
            url: row.url,
            tag: input.tag,
            requireInteraction: input.requireInteraction ?? false,
            timestamp: row.createdAt.getTime(),
            data: {
              ...(input.data ?? {}),
              type: row.type,
              // Lets the app mark this row read when the banner is tapped.
              notificationId: row.id,
              ...(row.groupId ? { groupId: row.groupId } : {}),
              ...(row.entityId ? { entityId: row.entityId } : {}),
            },
          });

          if (result.sent > 0) {
            await this.prisma.notification.update({
              where: { id: row.id },
              data: { pushedAt: new Date() },
            });
          }
        }),
      );
    } catch (error) {
      // A notification failure must never fail the action that caused it -
      // the expense was still added, the member was still invited.
      this.logger.error(
        `Failed to emit ${recipients.length} notification(s): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Convenience for the common single-recipient case. */
  async emitOne(input: NotificationInput): Promise<void> {
    return this.emit([input]);
  }
}
