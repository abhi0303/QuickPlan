import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'crypto';
import { EmailVerificationService } from './email-verification.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;

  const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    emailVerificationToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      // No recent send, so the per-address cooldown never blocks these.
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };

  const mail = { send: jest.fn().mockResolvedValue(true), isConfigured: jest.fn(() => true) };

  beforeEach(async () => {
    jest.clearAllMocks();
    mail.isConfigured.mockReturnValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailVerificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
        { provide: ConfigService, useValue: { get: (_k: string, d?: string) => d } },
      ],
    }).compile();
    service = module.get(EmailVerificationService);
  });

  describe('issue', () => {
    it('stores a hash and emails the token itself', async () => {
      await service.issue('u1', 'a@b.com', 'A');

      const stored = prisma.emailVerificationToken.create.mock.calls[0][0].data.tokenHash;
      const emailed = mail.send.mock.calls[0][2].match(/token=([A-Za-z0-9_-]+)/)[1];

      expect(stored).toBe(sha(emailed));
      expect(stored).not.toBe(emailed);
    });

    it('supersedes any earlier unused link', async () => {
      await service.issue('u1', 'a@b.com', null);

      expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', usedAt: null },
      });
    });

    /**
     * With no transport nobody could ever confirm, so enforcing it would create
     * accounts that can never sign in.
     */
    it('verifies immediately when there is no mail transport at all', async () => {
      mail.isConfigured.mockReturnValue(false);

      await service.issue('u1', 'a@b.com', 'A');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { emailVerifiedAt: expect.any(Date) },
      });
      expect(mail.send).not.toHaveBeenCalled();
      expect(service.enforced()).toBe(false);
    });
  });

  describe('verify', () => {
    const valid = {
      id: 't1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      user: { id: 'u1', emailVerifiedAt: null },
    };

    it('marks the address confirmed', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(valid);

      const result = await service.verify('raw');

      expect(result.verified).toBe(true);
      expect(prisma.user.update.mock.calls[0][0].data).toEqual({
        emailVerifiedAt: expect.any(Date),
      });
    });

    it('looks the token up by hash', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(valid);

      await service.verify('raw');

      expect(prisma.emailVerificationToken.findUnique.mock.calls[0][0].where.tokenHash).toBe(
        sha('raw'),
      );
    });

    /** Clicking the link twice is normal and should not read as an error. */
    it('treats an already-confirmed address as success', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        ...valid,
        user: { id: 'u1', emailVerifiedAt: new Date() },
      });

      const result = await service.verify('raw');

      expect(result.verified).toBe(true);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it.each([
      ['unknown', null],
      ['used', { ...valid, usedAt: new Date() }],
      ['expired', { ...valid, expiresAt: new Date(Date.now() - 1000) }],
    ])('rejects an %s token with one message', async (_label, record) => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(record);

      await expect(service.verify('raw')).rejects.toThrow(BadRequestException);
    });
  });

  describe('resend', () => {
    it('answers identically for a stranger and a real unconfirmed address', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const unknown = await service.resend('nobody@b.com');

      prisma.user.findUnique.mockResolvedValue({ id: 'u1', name: 'A', emailVerifiedAt: null });
      const real = await service.resend('a@b.com');

      expect(unknown).toEqual(real);
    });

    it('sends nothing when a link went out moments ago', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', name: 'A', emailVerifiedAt: null });
      prisma.emailVerificationToken.findFirst.mockResolvedValue({ createdAt: new Date() });

      const result = await service.resend('a@b.com');

      expect(mail.send).not.toHaveBeenCalled();
      expect(result.message).toMatch(/If that address needs confirming/);
    });

    it('sends nothing to an address that is already confirmed', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', emailVerifiedAt: new Date() });

      await service.resend('a@b.com');

      expect(mail.send).not.toHaveBeenCalled();
    });
  });

  describe('assertVerified', () => {
    it('lets a confirmed account through', () => {
      expect(() => service.assertVerified({ emailVerifiedAt: new Date() })).not.toThrow();
    });

    it('stops an unconfirmed one', () => {
      expect(() => service.assertVerified({ emailVerifiedAt: null })).toThrow(ForbiddenException);
    });
  });
});
