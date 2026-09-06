import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PasswordResetService } from './password-reset.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from '../user/user.service';
import { MailService } from '../mail/mail.service';

/**
 * The mail flows deliberately finish after the response has been returned, so
 * that a registered address and an unknown one take the same time to answer.
 * Tests have to let those settle before asserting on them.
 */
const flush = () => new Promise((resolve) => setImmediate(resolve));

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

describe('PasswordResetService', () => {
  let service: PasswordResetService;

  const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    passwordResetToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      // No recent send, so the per-address cooldown never blocks these.
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };

  const users = {
    hashPassword: jest.fn().mockResolvedValue('hashed'),
    verifyPassword: jest.fn(),
  };
  const mail = { send: jest.fn().mockResolvedValue(true), dispatch: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserService, useValue: users },
        { provide: MailService, useValue: mail },
        { provide: ConfigService, useValue: { get: (_k: string, d?: string) => d } },
      ],
    }).compile();
    service = module.get(PasswordResetService);
  });

  describe('forgot', () => {
    /** Anything else turns this into a way to discover who has an account. */
    it('answers identically whether or not the account exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', passwordHash: 'x' });
      const found = await service.forgot({ email: 'a@b.com' });
      await flush();

      prisma.user.findUnique.mockResolvedValue(null);
      const missing = await service.forgot({ email: 'nobody@b.com' });
      await flush();

      expect(found).toEqual(missing);
    });

    it('sends nothing for an unknown address', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await service.forgot({ email: 'nobody@b.com' });

      await flush();

      expect(mail.dispatch).not.toHaveBeenCalled();
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('sends nothing for an account with no password set', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', passwordHash: null });

      await service.forgot({ email: 'a@b.com' });

      await flush();

      expect(mail.dispatch).not.toHaveBeenCalled();
    });

    /** Only a hash is kept: a leaked database must not hand over a working link. */
    it('stores a hash, never the token, and emails the token itself', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', name: 'A', passwordHash: 'x' });

      await service.forgot({ email: 'a@b.com' });

      await flush();

      const stored = prisma.passwordResetToken.create.mock.calls[0][0].data.tokenHash;
      const emailed = mail.dispatch.mock.calls[0][2].match(/token=([A-Za-z0-9_-]+)/)[1];

      expect(stored).not.toBe(emailed);
      expect(stored).toBe(sha(emailed));
      expect(stored).toMatch(/^[a-f0-9]{64}$/);
    });

    /** An IP limit cannot protect one mailbox from somebody rotating IPs. */
    it('sends nothing when a link went out moments ago', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', passwordHash: 'x' });
      prisma.passwordResetToken.findFirst.mockResolvedValue({ createdAt: new Date() });

      const result = await service.forgot({ email: 'a@b.com' });

      await flush();

      expect(mail.dispatch).not.toHaveBeenCalled();
      // Still the same answer, so the cooldown is not observable either.
      expect(result.message).toMatch(/If an account exists/);
    });

    it('sends again once the cooldown has passed', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', passwordHash: 'x' });
      prisma.passwordResetToken.findFirst.mockResolvedValue({
        createdAt: new Date(Date.now() - 120_000),
      });

      await service.forgot({ email: 'a@b.com' });

      await flush();

      expect(mail.dispatch).toHaveBeenCalled();
    });

    it('invalidates any earlier unused link', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.com', passwordHash: 'x' });

      await service.forgot({ email: 'a@b.com' });

      await flush();

      expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', usedAt: null },
      });
    });
  });

  describe('reset', () => {
    const valid = {
      id: 't1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      user: { id: 'u1', email: 'a@b.com', name: 'A' },
    };

    it('sets the new password and stamps passwordChangedAt', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(valid);

      await service.reset({ token: 'raw', password: 'newpassword123' });

      expect(prisma.user.update.mock.calls[0][0].data).toEqual({
        passwordHash: 'hashed',
        passwordChangedAt: expect.any(Date),
      });
    });

    it('looks the token up by its hash', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(valid);

      await service.reset({ token: 'raw', password: 'newpassword123' });

      expect(prisma.passwordResetToken.findUnique.mock.calls[0][0].where.tokenHash).toBe(sha('raw'));
    });

    it.each([
      ['unknown', null],
      ['already used', { ...valid, usedAt: new Date() }],
      ['expired', { ...valid, expiresAt: new Date(Date.now() - 1000) }],
    ])('rejects an %s token with the same message', async (_label, record) => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(record);

      await expect(service.reset({ token: 'raw', password: 'newpassword123' })).rejects.toThrow(
        'This reset link is invalid or has expired. Request a new one.',
      );
    });

    it('marks the token used so it cannot work twice', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(valid);

      await service.reset({ token: 'raw', password: 'newpassword123' });

      expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { usedAt: expect.any(Date) },
      });
    });

    it('tells the account holder their password changed', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(valid);

      await service.reset({ token: 'raw', password: 'newpassword123' });

      expect(mail.dispatch.mock.calls[0][1]).toMatch(/password was changed/i);
    });
  });

  describe('change', () => {
    it('refuses a wrong current password', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', passwordHash: 'stored' });
      users.verifyPassword.mockResolvedValue(false);

      await expect(
        service.change('u1', { currentPassword: 'nope', password: 'newpassword123' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses reusing the current password', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', passwordHash: 'stored' });
      users.verifyPassword.mockResolvedValue(true);

      await expect(
        service.change('u1', { currentPassword: 'same12345', password: 'same12345' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('changes it and ends open sessions', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', passwordHash: 'stored' });
      users.verifyPassword.mockResolvedValue(true);

      await service.change('u1', { currentPassword: 'old12345', password: 'newpassword123' });

      expect(prisma.user.update.mock.calls[0][0].data).toEqual({
        passwordHash: 'hashed',
        passwordChangedAt: expect.any(Date),
      });
    });

    // Somebody who has taken over a live session can change the password from
    // Settings. This email is the only way the real owner finds out, so it has
    // to go out here and not only on the reset path.
    it('warns the account owner, exactly as a reset does', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        name: 'Abhi',
        passwordHash: 'stored',
      });
      users.verifyPassword.mockResolvedValue(true);

      await service.change('u1', { currentPassword: 'old12345', password: 'newpassword123' });

      expect(mail.dispatch).toHaveBeenCalled();
      const [to, subject, body] = mail.dispatch.mock.calls[0];
      expect(to).toBe('a@b.com');
      expect(subject).toMatch(/password was changed/i);
      expect(body).toMatch(/signed out everywhere/i);
    });

    it('does not fall over for an account with no address on file', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: null, name: null, passwordHash: 'stored' });
      users.verifyPassword.mockResolvedValue(true);

      await expect(
        service.change('u1', { currentPassword: 'old12345', password: 'newpassword123' }),
      ).resolves.toBeDefined();
      expect(mail.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('purgeExpired', () => {
    it('removes spent and expired tokens', async () => {
      prisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 4 });
      const now = new Date();

      expect(await service.purgeExpired(now)).toBe(4);
      expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
        where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] },
      });
    });
  });
});
