import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_PAYLOAD_BYTES, PushPayload } from './push-payload';

/** Endpoints the push service has permanently rejected. */
const GONE_STATUS_CODES = new Set([404, 410]);

export interface PushResult {
  sent: number;
  removed: number;
  failed: number;
}

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private enabled = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    const subject = this.config.get<string>('VAPID_SUBJECT', 'mailto:admin@quickplan.app');

    // Keys must come from the environment and stay stable. Generating a pair at
    // boot - as this did before - silently invalidates every stored
    // subscription on each restart, so every user would have to re-subscribe.
    if (!publicKey || !privateKey) {
      this.logger.warn(
        'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set. Push sending is disabled; ' +
          'run "npx web-push generate-vapid-keys" and set them to enable it.',
      );
      return;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.enabled = true;
    this.logger.log('Web Push configured from environment VAPID keys');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getPublicKey(): string | undefined {
    return this.config.get<string>('VAPID_PUBLIC_KEY');
  }

  /**
   * Delivers to every subscription the user has, so a phone and a laptop both
   * ring. Dead endpoints are deleted as they are discovered - without that the
   * table grows forever and every send wastes requests on addresses that can
   * never work again.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<PushResult> {
    const result: PushResult = { sent: 0, removed: 0, failed: 0 };

    if (!this.enabled) {
      this.logger.warn(`Push requested for user ${userId} but VAPID keys are not configured`);
      return result;
    }

    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId } });

    if (subscriptions.length === 0) {
      return result;
    }

    const body = this.serialise(payload);

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            body,
          );

          result.sent++;
          await this.prisma.pushSubscription.update({
            where: { id: subscription.id },
            data: { lastUsedAt: new Date(), failureCount: 0 },
          });
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;

          if (statusCode && GONE_STATUS_CODES.has(statusCode)) {
            result.removed++;
            await this.prisma.pushSubscription
              .delete({ where: { id: subscription.id } })
              .catch(() => undefined);
            this.logger.log(`Removed dead subscription ${subscription.id} (${statusCode})`);
            return;
          }

          result.failed++;
          await this.prisma.pushSubscription
            .update({
              where: { id: subscription.id },
              data: { failureCount: { increment: 1 } },
            })
            .catch(() => undefined);

          this.logger.error(
            `Push to ${subscription.id} failed (${statusCode ?? 'no status'}): ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }),
    );

    return result;
  }

  /**
   * Trims the optional `data` bag if the payload would exceed the size limit,
   * so an oversized extra field cannot stop the notification itself going out.
   */
  private serialise(payload: PushPayload): string {
    const full = JSON.stringify(payload);

    if (Buffer.byteLength(full, 'utf8') <= MAX_PAYLOAD_BYTES) {
      return full;
    }

    this.logger.warn(`Push payload for "${payload.title}" exceeded ${MAX_PAYLOAD_BYTES}B; dropping data`);
    const { data, ...rest } = payload;
    const trimmed = JSON.stringify(rest);

    if (Buffer.byteLength(trimmed, 'utf8') <= MAX_PAYLOAD_BYTES) {
      return trimmed;
    }

    return JSON.stringify({ title: payload.title, tag: payload.tag });
  }
}
