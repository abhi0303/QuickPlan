import { Module } from '@nestjs/common';
import { GroupsService } from './groups.service';
import { GroupsController } from './groups.controller';
import { GroupAccessService } from './group-access.service';
import { FriendsModule } from '../friends/friends.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [FriendsModule, NotificationsModule],
  controllers: [GroupsController],
  providers: [GroupsService, GroupAccessService],
  exports: [GroupsService, GroupAccessService],
})
export class GroupsModule {}
