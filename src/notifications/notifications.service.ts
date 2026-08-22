import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RemindersService } from '../reminders/reminders.service';
import { PushService } from './push.service';
import { NotificationEmitter } from './notification-emitter.service';
import { reminderDue, reminderLead } from './notification-events';
import { SubscribePushDto } from './dto/subscribe-push.dto';
import { leadTime } from '../reminders/recurrence';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private remindersService: RemindersService,
    private pushService: PushService,
    private emitter: NotificationEmitter,
  ) {}

  /**
   * Upsert on endpoint: the frontend re-subscribes on every load, so inserting
   * blindly would fill the table with duplicates and alert the user several
   * times for one reminder.
   */
  async saveSubscription(userId: string, dto: SubscribePushDto) {
    return this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      update: {
        userId,
        p256dh: dto.p256dh,
        auth: dto.auth,
        userAgent: dto.userAgent ?? null,
        failureCount: 0,
      },
      create: {
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.p256dh,
        auth: dto.auth,
        userAgent: dto.userAgent ?? null,
      },
    });
  }

  /** Lets the browser drop its row immediately instead of waiting for a send to fail. */
  async removeSubscription(userId: string, endpoint: string) {
    const { count } = await this.prisma.pushSubscription.deleteMany({
      where: { endpoint, userId },
    });

    return { removed: count };
  }

  async sendTestNotification(userId: string) {
    const result = await this.pushService.sendToUser(userId, {
      title: 'QuickPlan test notification',
      body: 'Push notifications are working.',
      url: './reminders',
      tag: 'quickplan-test',
      timestamp: Date.now(),
      data: { test: true },
    });

    return { ...result, pushEnabled: this.pushService.isEnabled() };
  }

  /**
   * Fires two alerts per reminder - the lead-in and the reminder itself -
   * matching what the frontend does while a tab is open. Each moment is marked
   * as it is sent, so a restart does not resend and a passed reminder does not
   * fire on every tick.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleCronReminders() {
    const now = new Date();
    const candidates = await this.remindersService.findDueReminders(now);

    if (candidates.length === 0) {
      return;
    }

    for (const reminder of candidates) {
      const leadAt = leadTime(reminder.dueAt, reminder.offsetMinutes);
      const dueNow = reminder.sentDueAt === null && reminder.dueAt <= now;

      // When both moments have passed, only the due alert is worth sending -
      // a lead-in for something already due is noise.
      if (dueNow) {
        // Goes through the emitter so the reminder also lands in the bell menu,
        // not just as a banner the user may miss.
        await this.emitter.emitOne(
          reminderDue(reminder.userId, reminder.id, reminder.title),
        );

        await this.remindersService.markDueSent(reminder.id, now);
        continue;
      }

      const leadDue =
        reminder.offsetMinutes > 0 && reminder.sentLeadAt === null && leadAt <= now;

      if (leadDue) {
        await this.emitter.emitOne(
          reminderLead(reminder.userId, reminder.id, reminder.title, reminder.offsetMinutes),
        );

        await this.remindersService.markLeadSent(reminder.id, now);
      }
    }
  }

  /** Retained for callers outside the scheduler. */
  async sendPushToUser(userId: string, title: string, body: string) {
    return this.pushService.sendToUser(userId, { title, body, timestamp: Date.now() });
  }
}
