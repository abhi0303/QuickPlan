import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { esc, renderEmail } from '../mail/email-template';

const TOKEN_TTL_HOURS = 24;

/** Keyed on the address, because an IP limit cannot protect one mailbox. */
const RESEND_COOLDOWN_MS = 60_000;

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * With no mail transport at all there is no way for anybody to confirm an
   * address, so enforcing it would lock every new account out of the app. In
   * that case registration verifies immediately and says so loudly, rather than
   * quietly creating users who can never sign in.
   */
  enforced(): boolean {
    return this.mail.isConfigured();
  }

  /** Issued on registration and whenever somebody asks for another. */
  async issue(userId: string, email: string, name: string | null): Promise<void> {
    if (!this.enforced()) {
      this.logger.warn(
        `No mail transport configured, so ${email} was verified automatically. ` +
          'Set BREVO_API_KEY or the SMTP variables to require confirmation.',
      );

      await this.prisma.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: new Date() },
      });

      return;
    }

    const token = randomBytes(32).toString('base64url');

    await this.prisma.$transaction([
      // Only the newest link in the inbox should work.
      this.prisma.emailVerificationToken.deleteMany({ where: { userId, usedAt: null } }),
      this.prisma.emailVerificationToken.create({
        data: {
          userId,
          tokenHash: this.hash(token),
          expiresAt: new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000),
        },
      }),
    ]);

    const base = this.config.get<string>('APP_URL', 'https://abhi0303.github.io/QuickPlan-FE');
    const link = `${base}/verify-email?token=${token}`;

    this.mail.dispatch(
      email,
      'Confirm your QuickPlan email',
      `Hi${name ? ` ${name}` : ''},\n\n` +
        `Confirm ${email} to finish setting up your account. The link expires in ${TOKEN_TTL_HOURS} hours:\n\n` +
        `${link}\n\n` +
        'If you did not create a QuickPlan account, ignore this email.',
      renderEmail({
        preheader: `Confirm ${email} to finish setting up your QuickPlan account.`,
        badge: '&#9993;&#65039;',
        tone: 'primary',
        heading: 'Confirm your email',
        greeting: `Hi${name ? ` ${esc(name)}` : ''},`,
        intro: `You are one tap from your QuickPlan account. Confirm <strong style="color:#10241d;">${esc(email)}</strong> to finish setting it up.`,
        action: { label: 'Confirm my email', url: link },
        meta: `&#9201;&nbsp; Expires in ${TOKEN_TTL_HOURS} hours`,
        footer: 'If you did not create a QuickPlan account, you can ignore this email.',
      }),
    );
  }

  async verify(token: string) {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: this.hash(token) },
      include: { user: { select: { id: true, emailVerifiedAt: true } } },
    });

    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw new BadRequestException(
        'This confirmation link is invalid or has expired. Ask for a new one.',
      );
    }

    // Clicking twice is a normal thing to do; the second click should read as
    // success, not as an error.
    if (record.user.emailVerifiedAt) {
      return { verified: true, message: 'Your email is already confirmed. You can sign in.' };
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { verified: true, message: 'Email confirmed. You can sign in now.' };
  }

  /**
   * Same non-committal answer as forgot-password, so this cannot be used to
   * find out which addresses are registered or already confirmed.
   */
  async resend(email: string) {
    const normalised = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalised } });

    // Deferred for the same reason as the reset flow: one lookup on both
    // branches, so the response time says nothing about who is registered.
    if (user && !user.emailVerifiedAt) {
      void this.reissue(user.id, normalised, user.name);
    }

    return {
      message:
        'If that address needs confirming, a new link is on its way. It expires in 24 hours.',
    };
  }

  /** Runs after the response has gone out. Never throws into the request. */
  private async reissue(userId: string, email: string, name: string | null): Promise<void> {
    try {
      if (!(await this.recentlySent(userId))) {
        await this.issue(userId, email, name);
      }
    } catch (error) {
      this.logger.error(
        `Could not issue a confirmation link: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Login calls this. An unconfirmed address cannot sign in. */
  assertVerified(user: { emailVerifiedAt: Date | null }): void {
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException(
        'Confirm your email address before signing in. Check your inbox, or ask for a new link.',
      );
    }
  }

  async purgeExpired(now = new Date()): Promise<number> {
    const { count } = await this.prisma.emailVerificationToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] },
    });

    return count;
  }

  private async recentlySent(userId: string): Promise<boolean> {
    const latest = await this.prisma.emailVerificationToken.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    return latest !== null && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
