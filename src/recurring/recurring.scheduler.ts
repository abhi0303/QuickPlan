import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RecurringService } from './recurring.service';

@Injectable()
export class RecurringScheduler {
  private readonly logger = new Logger(RecurringScheduler.name);

  constructor(private readonly recurring: RecurringService) {}

  /** Hourly is ample: minute precision is meaningless for a monthly bill. */
  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    const created = await this.recurring.runDue();

    if (created > 0) {
      this.logger.log(`Created ${created} recurring expense(s)`);
    }
  }
}
