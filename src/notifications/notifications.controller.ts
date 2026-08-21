import { Body, Controller, Delete, Get, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { SubscribePushDto } from './dto/subscribe-push.dto';
import { UnsubscribePushDto } from './dto/unsubscribe-push.dto';
import { Public } from '../auth/public.decorator';

@ApiTags('Notifications')
@ApiHeader({ name: 'x-user-id', required: false, description: 'User ID header' })
@Controller('api/notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly pushService: PushService,
  ) {}

  private getUserId(headers: Record<string, string>): string {
    const userId = headers['x-user-id'];

    if (!userId) {
      throw new UnauthorizedException('Authenticated user could not be resolved.');
    }

    return userId;
  }

  // Public: the browser needs this before it can subscribe, and the VAPID
  // public key is designed to be handed out.
  @Public()
  @Get('vapid-public-key')
  @ApiOperation({ summary: 'VAPID public key the browser subscribes with' })
  getVapidPublicKey() {
    return { publicKey: this.pushService.getPublicKey() ?? null, enabled: this.pushService.isEnabled() };
  }

  @Post('subscribe')
  @ApiOperation({ summary: 'Save PWA Web Push subscription endpoint & keys' })
  subscribe(@Headers() headers: Record<string, string>, @Body() dto: SubscribePushDto) {
    return this.notificationsService.saveSubscription(this.getUserId(headers), dto);
  }

  @Delete('subscribe')
  @ApiOperation({ summary: 'Forget a push subscription for this device' })
  unsubscribe(@Headers() headers: Record<string, string>, @Body() dto: UnsubscribePushDto) {
    return this.notificationsService.removeSubscription(this.getUserId(headers), dto.endpoint);
  }

  @Post('test')
  @ApiOperation({ summary: "Send a test push to the caller's own devices" })
  sendTest(@Headers() headers: Record<string, string>) {
    return this.notificationsService.sendTestNotification(this.getUserId(headers));
  }
}
