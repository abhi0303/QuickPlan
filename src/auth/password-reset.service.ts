import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from '../user/user.service';
import { MailService } from '../mail/mail.service';
import { ForgotPasswordDto, ResetPasswordDto, ChangePasswordDto } from './dto/password.dto';

const TOKEN_TTL_MINUTES = 60;

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

    if (user?.passwordHash) {
      const token = randomBytes(32).toString('base64url');

      await this.prisma.$transaction([
        // Requesting again invalidates the previous link, so only the newest
        // email in the inbox works.
        this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
        this.prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: this.hash(token),
            expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000),
          },
        }),
      ]);

      await this.sendResetEmail(email, user.name, token);
    }

    return {
      message:
        'If an account exists for that address, a reset link is on its way. It expires in an hour.',
    };
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
      await this.mail.send(
        record.user.email,
        'Your QuickPlan password was changed',
        `Hi${record.user.name ? ` ${record.user.name}` : ''},\n\n` +
          'Your QuickPlan password has just been changed, and you have been signed out everywhere.\n\n' +
          'If this was not you, reset it again immediately.',
      );
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

    return { message: 'Your password has been changed. Please sign in again.' };
  }

  /** Expired and used tokens are of no further use to anyone. */
  async purgeExpired(now = new Date()): Promise<number> {
    const { count } = await this.prisma.passwordResetToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] },
    });

    return count;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async sendResetEmail(email: string, name: string | null, token: string) {
    const base = this.config.get<string>('APP_URL', 'https://abhi0303.github.io/QuickPlan-FE');
    const link = `${base}/reset-password?token=${token}`;

    await this.mail.send(
      email,
      'Reset your QuickPlan password',
      `Hi${name ? ` ${name}` : ''},\n\n` +
        `Use this link to set a new password. It expires in ${TOKEN_TTL_MINUTES} minutes and can only be used once:\n\n` +
        `${link}\n\n` +
        'If you did not ask for this, you can ignore this email — nothing has changed.',
      `<p>Hi${name ? ` ${name}` : ''},</p>
       <p><a href="${link}">Set a new password</a></p>
       <p>The link expires in ${TOKEN_TTL_MINUTES} minutes and can only be used once.</p>
       <p>If you did not ask for this, you can ignore this email — nothing has changed.</p>`,
    );
  }
}
