import { Module } from '@nestjs/common';
import { RecurringService } from './recurring.service';
import { RecurringController } from './recurring.controller';
import { RecurringScheduler } from './recurring.scheduler';
import { GroupsModule } from '../groups/groups.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [GroupsModule, NotificationsModule],
  controllers: [RecurringController],
  providers: [RecurringService, RecurringScheduler],
  exports: [RecurringService],
})
export class RecurringModule {}
