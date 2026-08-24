import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GamificationService } from './gamification.service';
import { ACTIVITY_EVENT, ActivityEvent } from './gamification.events';

/**
 * The only seam between the feature modules and gamification. Expenses, tasks
 * and reminders emit an activity and know nothing about missions or XP.
 */
@Injectable()
export class GamificationListener {
  constructor(private readonly gamification: GamificationService) {}

  @OnEvent(ACTIVITY_EVENT, { async: true })
  async onActivity(event: ActivityEvent): Promise<void> {
    await this.gamification.handleActivity(event.kind, event.userId);
  }
}
