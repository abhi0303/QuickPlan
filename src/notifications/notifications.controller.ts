import { Controller, Post, Body, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { SubscribePushDto } from './dto/subscribe-push.dto';

@ApiTags('Notifications')
@ApiHeader({ name: 'x-user-id', required: false, description: 'User ID header' })
@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  private getUserId(headers: Record<string, string>): string {
    return headers['x-user-id'] || 'default-user-id';
  }

  @Post('subscribe')
  @ApiOperation({ summary: 'Save PWA Web Push subscription endpoint & keys' })
  subscribe(@Headers() headers: Record<string, string>, @Body() dto: SubscribePushDto) {
    return this.notificationsService.saveSubscription(this.getUserId(headers), dto);
  }
}
