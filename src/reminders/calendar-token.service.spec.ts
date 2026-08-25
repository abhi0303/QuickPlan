import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CalendarTokenService } from './calendar-token.service';

const SECRET = 'test-secret-value';

describe('CalendarTokenService', () => {
  let service: CalendarTokenService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarTokenService,
        { provide: ConfigService, useValue: { get: (_k: string, d?: string) => SECRET ?? d } },
      ],
    }).compile();
    service = module.get(CalendarTokenService);
  });

  it('round-trips a reminder and user', () => {
    const { token } = service.mint('rem-1', 'user-1');

    expect(service.verify(token)).toEqual({ ok: true, reminderId: 'rem-1', userId: 'user-1' });
  });

  it('expires five minutes out', () => {
    const now = new Date('2026-08-25T08:15:00Z');
    const { expiresAt } = service.mint('rem-1', 'user-1', now);

    expect(expiresAt.toISOString()).toBe('2026-08-25T08:20:00.000Z');
  });

  it('rejects a token past its expiry', () => {
    const now = new Date('2026-08-25T08:15:00Z');
    const { token } = service.mint('rem-1', 'user-1', now);

    const later = new Date(now.getTime() + 6 * 60 * 1000);
    expect(service.verify(token, later)).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('rejects a tampered payload', () => {
    const { token } = service.mint('rem-1', 'user-1');
    const [, signature] = token.split('.');
    const forged =
      Buffer.from(JSON.stringify({ r: 'rem-2', u: 'user-1', e: 99999999999 })).toString('base64url');

    expect(service.verify(`${forged}.${signature}`)).toEqual({ ok: false, reason: 'INVALID' });
  });

  it.each([['', 'empty'], ['nonsense', 'no signature'], ['a.b', 'bad signature']])(
    'rejects a malformed token (%s)',
    (token) => {
      expect(service.verify(token).ok).toBe(false);
    },
  );

  /**
   * The guard accepts any JWT signed with JWT_SECRET carrying a `sub`. A
   * calendar token travels in URLs, history and logs, so it must never be
   * usable as a session bearer.
   */
  it('is not accepted by the JWT verifier that guards the API', () => {
    const { token } = service.mint('rem-1', 'user-1');
    const jwt = new JwtService({});

    expect(() => jwt.verify(token, { secret: SECRET })).toThrow();
  });

  it('does not carry a `sub` claim at all', () => {
    const { token } = service.mint('rem-1', 'user-1');
    const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));

    expect(payload.sub).toBeUndefined();
    expect(Object.keys(payload).sort()).toEqual(['e', 'r', 'u']);
  });
});
