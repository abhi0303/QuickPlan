import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IdempotencyService, RETENTION_HOURS } from './idempotency.service';

@Injectable()
export class IdempotencyScheduler {
  private readonly logger = new Logger(IdempotencyScheduler.name);

  constructor(private readonly idempotency: IdempotencyService) {}

  /** Keys live for 24 hours; without a sweep this table only grows. */
  @Cron(CronExpression.EVERY_HOUR)
  async purge(): Promise<void> {
    const removed = await this.idempotency.purgeExpired();

    if (removed > 0) {
      this.logger.log(`Purged ${removed} idempotency key(s) older than ${RETENTION_HOURS}h`);
    }
  }
}
