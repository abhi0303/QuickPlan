import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from '../user/user.service';
import { MailService } from '../mail/mail.service';
import { ForgotPasswordDto, ResetPasswordDto, ChangePasswordDto } from './dto/password.dto';
import { DEFAULT_APP_URL } from '../common/app-url';
import { esc, renderEmail } from '../mail/email-template';

const TOKEN_TTL_MINUTES = 60;

/**
 * A second limit, keyed on the address rather than the caller. The IP throttle
 * cannot protect one mailbox from somebody rotating IPs, and the person being
 * spammed is the one who never asked for any of it.
 */
const RESEND_COOLDOWN_MS = 60_000;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Always answers the same way, whether or not the address exists. Anything
   * else turns this endpoint into a way to discover who has an account.
   */
  async forgot(dto: ForgotPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Both branches do exactly one indexed lookup and nothing else before
    // answering. Everything expensive - the cooldown check, the token write,
    // the mail - happens after the response, because a registered address that
    // takes half a second longer than an unknown one is just enumeration with
    // extra steps, and identical wording does not help.
    if (user?.passwordHash) {
      void this.issueResetToken(user.id, email, user.name);
    }

    return {
      message:
        'If an account exists for that address, a reset link is on its way. It expires in an hour.',
    };
  }

  /** Runs after the response has gone out. Never throws into the request. */
  private async issueResetToken(userId: string, email: string, name: string | null): Promise<void> {
    try {
      if (await this.recentlySent(userId)) {
        return;
      }

      const token = randomBytes(32).toString('base64url');

      await this.prisma.$transaction([
        // Requesting again invalidates the previous link, so only the newest
        // email in the inbox works.
        this.prisma.passwordResetToken.deleteMany({ where: { userId, usedAt: null } }),
        this.prisma.passwordResetToken.create({
          data: {
            userId,
            tokenHash: this.hash(token),
            expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000),
          },
        }),
      ]);

      this.sendResetEmail(email, name, token);
    } catch (error) {
      this.logger.error(
        `Could not issue a reset link: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async reset(dto: ResetPasswordDto) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hash(dto.token) },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    // One message for every failure, so a caller cannot tell an unknown token
    // from an expired or already-used one.
    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw new BadRequestException('This reset link is invalid or has expired. Request a new one.');
    }

    const passwordHash = await this.users.hashPassword(dto.password);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        // passwordChangedAt ends every session that was already open. A reset
        // that left the old sessions alive would not lock out whoever caused it.
        data: { passwordHash, passwordChangedAt: new Date() },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.deleteMany({
        where: { userId: record.userId, usedAt: null },
      }),
    ]);

    if (record.user.email) {
      this.notifyPasswordChanged(record.user.email, record.user.name);
    }

    return { message: 'Your password has been changed. Please sign in again.' };
  }

  /** For somebody already signed in; proves they know the current password. */
  async change(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user?.passwordHash) {
      throw new BadRequestException('This account has no password set.');
    }

    const correct = await this.users.verifyPassword(dto.currentPassword, user.passwordHash);

    if (!correct) {
      throw new UnauthorizedException('Your current password is not correct.');
    }

    if (dto.currentPassword === dto.password) {
      throw new BadRequestException('The new password must be different from the current one.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await this.users.hashPassword(dto.password),
        passwordChangedAt: new Date(),
      },
    });

    // The same warning a reset sends. Somebody who has taken over a live
    // session can change the password from Settings, and the real owner has no
    // other way of finding out.
    if (user.email) {
      this.notifyPasswordChanged(user.email, user.name);
    }

    return { message: 'Your password has been changed. Please sign in again.' };
  }

  /**
   * Sent however the password changed - reset link or Settings. This is the
   * only thing that tells somebody their account has been taken over, so it
   * must not depend on which route was used.
   */
  private notifyPasswordChanged(email: string, name: string | null): void {
    const signIn = `${this.config.get<string>('APP_URL', DEFAULT_APP_URL)}/auth`;

    this.mail.dispatch(
      email,
      'Your QuickPlan password was changed',
      `Hi${name ? ` ${name}` : ''},\n\n` +
        `The password for ${email} has just been changed, and you have been signed out everywhere.\n\n` +
        `If this was not you, reset it immediately: ${signIn}`,
      renderEmail({
        preheader: `The password for ${email} was just changed.`,
        badge: '&#128274;',
        tone: 'tangerine',
        heading: 'Your password was changed',
        greeting: `Hi${name ? ` ${esc(name)}` : ''},`,
        intro: `The password for <strong style="color:#10241d;">${esc(email)}</strong> has just been changed, and you have been signed out on every device.`,
        notice: {
          tone: 'rose',
          text: '&#9888;&#65039;&nbsp; If this was not you, reset your password immediately — somebody else may have access to your account.',
        },
        action: { label: 'Reset it now', url: signIn },
        footer: 'If you made this change, no further action is needed.',
      }),
    );
  }

  /** Expired and used tokens are of no further use to anyone. */
  async purgeExpired(now = new Date()): Promise<number> {
    const { count } = await this.prisma.passwordResetToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] },
    });

    return count;
  }

  /** True when a link went out to this account within the cooldown. */
  private async recentlySent(userId: string): Promise<boolean> {
    const latest = await this.prisma.passwordResetToken.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    return latest !== null && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private sendResetEmail(email: string, name: string | null, token: string): void {
    const base = this.config.get<string>('APP_URL', DEFAULT_APP_URL);
    const link = `${base}/reset-password?token=${token}`;

    this.mail.dispatch(
      email,
      'Reset your QuickPlan password',
      `Hi${name ? ` ${name}` : ''},\n\n` +
        `Use this link to set a new password for ${email}. It expires in ${TOKEN_TTL_MINUTES} minutes and can only be used once:\n\n` +
        `${link}\n\n` +
        'If you did not ask for this, you can ignore this email — nothing has changed.',
      renderEmail({
        preheader: `Set a new password for ${email}. The link expires in ${TOKEN_TTL_MINUTES} minutes.`,
        badge: '&#128273;',
        tone: 'periwinkle',
        heading: 'Reset your password',
        greeting: `Hi${name ? ` ${esc(name)}` : ''},`,
        intro: `Tap the button below to set a new password for <strong style="color:#10241d;">${esc(email)}</strong>.`,
        action: { label: 'Set a new password', url: link },
        meta: `&#9201;&nbsp; Expires in ${TOKEN_TTL_MINUTES} minutes &middot; single use`,
        footer:
          'If you did not ask for this, you can ignore this email — nothing has changed.',
      }),
    );
  }
}
