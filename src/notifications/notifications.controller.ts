import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { NotificationFeedService } from './notification-feed.service';
import { PushService } from './push.service';
import { SubscribePushDto } from './dto/subscribe-push.dto';
import { UnsubscribePushDto } from './dto/unsubscribe-push.dto';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import {
  DeleteNotificationDto,
  NotificationListDto,
  UnreadCountDto,
} from './dto/notification-response.dto';
import { CurrentUser } from '../common/current-user.decorator';
import { Public } from '../auth/public.decorator';

@ApiTags('Notifications')
@Controller('api/notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly feed: NotificationFeedService,
    private readonly pushService: PushService,
  ) {}

  // ---------- feed ----------

  @Get()
  @ApiOperation({ summary: 'Notification feed, newest first' })
  @ApiOkResponse({ type: NotificationListDto })
  list(@CurrentUser() userId: string, @Query() query: QueryNotificationsDto) {
    return this.feed.list(userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread total, cheap enough to poll' })
  @ApiOkResponse({ type: UnreadCountDto })
  unreadCount(@CurrentUser() userId: string) {
    return this.feed.unreadCount(userId).then((unreadCount) => ({ unreadCount }));
  }

  @Patch('read')
  @ApiOperation({ summary: 'Mark notifications read. Idempotent.' })
  @ApiOkResponse({ type: UnreadCountDto })
  markRead(@CurrentUser() userId: string, @Body() dto: MarkReadDto) {
    return this.feed.markRead(userId, dto);
  }

  // ---------- push transport ----------

  // Public: the browser needs this before it can subscribe, and the VAPID
  // public key is designed to be handed out.
  @Public()
  @Get('vapid-public-key')
  @ApiOperation({ summary: 'VAPID public key the browser subscribes with' })
  getVapidPublicKey() {
    return {
      publicKey: this.pushService.getPublicKey() ?? null,
      enabled: this.pushService.isEnabled(),
    };
  }

  @Post('subscribe')
  @ApiOperation({ summary: 'Save PWA Web Push subscription endpoint & keys' })
  subscribe(@CurrentUser() userId: string, @Body() dto: SubscribePushDto) {
    return this.notificationsService.saveSubscription(userId, dto);
  }

  @Delete('subscribe')
  @ApiOperation({ summary: 'Forget a push subscription for this device' })
  unsubscribe(@CurrentUser() userId: string, @Body() dto: UnsubscribePushDto) {
    return this.notificationsService.removeSubscription(userId, dto.endpoint);
  }

  @Post('test')
  @ApiOperation({ summary: "Send a test push to the caller's own devices" })
  sendTest(@CurrentUser() userId: string) {
    return this.notificationsService.sendTestNotification(userId);
  }

  // Declared last so the literal paths above are not captured as an id.
  @Delete(':id')
  @ApiOperation({ summary: 'Dismiss a single notification' })
  @ApiOkResponse({ type: DeleteNotificationDto })
  remove(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.remove(userId, id);
  }
}
