import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { FriendsService } from './friends.service';
import { FriendsController } from './friends.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
