import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RemindersService } from '../reminders/reminders.service';
import { SubscribePushDto } from './dto/subscribe-push.dto';
import * as webpush from 'web-push';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private remindersService: RemindersService,
  ) {
    // Generate VAPID details or use default test keys
    const vapidKeys = webpush.generateVAPIDKeys();
    webpush.setVapidDetails('mailto:admin@quickplan.app', vapidKeys.publicKey, vapidKeys.privateKey);
  }

  async saveSubscription(userId: string, dto: SubscribePushDto) {
    return this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      update: {
        p256dh: dto.p256dh,
        auth: dto.auth,
        userId,
      },
      create: {
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.p256dh,
        auth: dto.auth,
      },
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCronReminders() {
    this.logger.log('Checking for due reminders...');
    const dueReminders = await this.remindersService.findDueReminders();

    for (const reminder of dueReminders) {
      this.logger.log(`Triggering notification for reminder: ${reminder.title}`);
      await this.sendPushToUser(reminder.userId, 'QuickPlan Reminder 🔔', reminder.title);
      await this.remindersService.markAsSent(reminder.id);
    }
  }

  async sendPushToUser(userId: string, title: string, body: string) {
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });

    const payload = JSON.stringify({
      title,
      body,
      icon: '/icon-192.png',
      badge: '/badge-72.png',
    });

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          payload,
        );
      } catch (error) {
        this.logger.error(`Failed to send push notification: ${error.message}`);
      }
    }
  }
}
