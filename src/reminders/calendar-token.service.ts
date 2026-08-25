import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

export const CALENDAR_TOKEN_TTL_SECONDS = 5 * 60;

interface TokenPayload {
  /** reminder id */
  r: string;
  /** user id */
  u: string;
  /** expiry, epoch seconds */
  e: number;
}

/**
 * Flat rather than a discriminated union: this project compiles with
 * strictNullChecks off, where narrowing on a boolean discriminant does not
 * hold.
 */
export interface TokenVerdict {
  ok: boolean;
  reason?: 'INVALID' | 'EXPIRED';
  reminderId?: string;
  userId?: string;
}

/**
 * A calendar link is a browser navigation, so it cannot carry an Authorization
 * header and the token in the query string is the authorisation.
 *
 * It is deliberately NOT a JWT signed with JWT_SECRET. JwtAuthGuard accepts any
 * token signed with that secret carrying a `sub`, so such a token would work as
 * a full session bearer - and this one ends up in browser history, referrers and
 * access logs. Signing with a key derived for this single purpose means a leaked
 * link grants exactly one reminder for five minutes and nothing else.
 */
@Injectable()
export class CalendarTokenService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_SECRET', 'quickplan-development-secret-change-me');

    this.key = createHmac('sha256', secret).update('quickplan:calendar-link:v1').digest();
  }

  mint(reminderId: string, userId: string, now = new Date()): { token: string; expiresAt: Date } {
    const expiresAt = new Date(now.getTime() + CALENDAR_TOKEN_TTL_SECONDS * 1000);
    const payload: TokenPayload = {
      r: reminderId,
      u: userId,
      e: Math.floor(expiresAt.getTime() / 1000),
    };

    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

    return { token: `${body}.${this.sign(body)}`, expiresAt };
  }

  verify(token: string, now = new Date()): TokenVerdict {
    const [body, signature] = (token ?? '').split('.');

    if (!body || !signature) {
      return { ok: false, reason: 'INVALID' };
    }

    const expected = this.sign(body);
    const given = Buffer.from(signature);
    const want = Buffer.from(expected);

    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      return { ok: false, reason: 'INVALID' };
    }

    let payload: TokenPayload;

    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return { ok: false, reason: 'INVALID' };
    }

    if (!payload?.r || !payload?.u || typeof payload.e !== 'number') {
      return { ok: false, reason: 'INVALID' };
    }

    if (payload.e * 1000 <= now.getTime()) {
      return { ok: false, reason: 'EXPIRED' };
    }

    return { ok: true, reminderId: payload.r, userId: payload.u };
  }

  private sign(body: string): string {
    return createHmac('sha256', this.key).update(body).digest('base64url');
  }
}
