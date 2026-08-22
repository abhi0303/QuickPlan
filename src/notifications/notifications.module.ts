import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { PushService } from './push.service';
import { NotificationEmitter } from './notification-emitter.service';
import { NotificationFeedService } from './notification-feed.service';
import { RemindersModule } from '../reminders/reminders.module';

@Module({
  imports: [RemindersModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushService, NotificationEmitter, NotificationFeedService],
  exports: [NotificationsService, PushService, NotificationEmitter, NotificationFeedService],
})
export class NotificationsModule {}
