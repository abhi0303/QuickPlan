import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BudgetsService } from './budgets.service';
import { ACTIVITY_EVENT, ActivityEvent } from '../gamification/gamification.events';

/**
 * Budgets listen to the same activity event gamification does, so the expense
 * modules stay unaware of either.
 */
@Injectable()
export class BudgetsListener {
  constructor(private readonly budgets: BudgetsService) {}

  @OnEvent(ACTIVITY_EVENT, { async: true })
  async onActivity(event: ActivityEvent): Promise<void> {
    if (event.kind !== 'EXPENSE_CREATED') {
      return;
    }

    await this.budgets.evaluateAlerts(event.userId);
  }
}
