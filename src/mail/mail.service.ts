import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

/**
 * SMTP rather than a provider SDK, so Resend, SendGrid, Mailgun, SES or a plain
 * Gmail app password all work with the same four variables and no lock-in.
 *
 * With nothing configured, mail is logged instead of sent. That keeps the whole
 * reset flow usable in development without a mail account, and makes the
 * missing configuration loud rather than a silent no-op in production.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private from = 'QuickPlan <no-reply@quickplan.app>';

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASSWORD');
    const port = Number(this.config.get<string>('SMTP_PORT', '587'));

    this.from = this.config.get<string>('MAIL_FROM', this.from);

    if (!host || !user || !pass) {
      this.logger.warn(
        'SMTP_HOST / SMTP_USER / SMTP_PASSWORD are not set. Emails will be written to the log instead of sent.',
      );
      return;
    }

    this.transporter = createTransport({
      host,
      port,
      // 465 is implicit TLS; everything else upgrades with STARTTLS.
      secure: port === 465,
      auth: { user, pass },
    });

    this.logger.log(`Mail configured via ${host}:${port}`);
  }

  isConfigured(): boolean {
    return this.transporter !== null;
  }

  async send(to: string, subject: string, text: string, html?: string): Promise<boolean> {
    if (!this.transporter) {
      // Logged so a developer can complete the flow locally. The link is
      // single-use and short-lived, and this only ever runs when no mail
      // account is configured at all.
      this.logger.warn(`[mail not configured] To: ${to} | ${subject}\n${text}`);
      return false;
    }

    try {
      await this.transporter.sendMail({ from: this.from, to, subject, text, html });
      return true;
    } catch (error) {
      // Never surface a mail failure to the caller: it would tell an attacker
      // which addresses exist.
      this.logger.error(
        `Sending "${subject}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
