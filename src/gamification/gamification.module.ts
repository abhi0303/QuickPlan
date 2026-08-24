import { Module } from '@nestjs/common';
import { GamificationService } from './gamification.service';
import { GamificationController } from './gamification.controller';
import { GamificationListener } from './gamification.listener';
import { GamificationScheduler } from './gamification.scheduler';
import { MissionProgressService } from './mission-progress.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [GamificationController],
  providers: [
    GamificationService,
    GamificationListener,
    GamificationScheduler,
    MissionProgressService,
  ],
  exports: [GamificationService],
})
export class GamificationModule {}
