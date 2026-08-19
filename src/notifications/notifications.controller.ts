import { Controller, Post, Body, Headers } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { SubscribePushDto } from './dto/subscribe-push.dto';

@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  private getUserId(headers: Record<string, string>): string {
    return headers['x-user-id'] || 'default-user-id';
  }

  @Post('subscribe')
  subscribe(@Headers() headers: Record<string, string>, @Body() dto: SubscribePushDto) {
    return this.notificationsService.saveSubscription(this.getUserId(headers), dto);
  }
}
