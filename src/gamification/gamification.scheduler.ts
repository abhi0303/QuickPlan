import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GamificationService } from './gamification.service';
import { NotificationFeedService } from '../notifications/notification-feed.service';

@Injectable()
export class GamificationScheduler {
  private readonly logger = new Logger(GamificationScheduler.name);

  constructor(
    private readonly gamification: GamificationService,
    private readonly feed: NotificationFeedService,
  ) {}

  /**
   * Catches users who have not opened the app: without this their expired
   * missions would sit in the table until the next visit. The read path does
   * the same work lazily, so this is a backstop rather than the mechanism.
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async retireExpiredCycles(): Promise<void> {
    const swept = await this.gamification.sweepExpiredCycles();

    if (swept > 0) {
      this.logger.log(`Refreshed mission cycles for ${swept} user(s)`);
    }
  }

  /** Notification retention, as agreed with the frontend. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeOldNotifications(): Promise<void> {
    const removed = await this.feed.purgeOlderThan(90);

    if (removed > 0) {
      this.logger.log(`Purged ${removed} notification(s) older than 90 days`);
    }
  }
}
