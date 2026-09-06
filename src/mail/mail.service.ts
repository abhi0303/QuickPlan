import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/**
 * Three transports, in order of preference.
 *
 * Brevo's transactional API when BREVO_API_KEY is set - note this is
 * /v3/smtp/email, not the campaigns endpoint, which is for marketing sends and
 * would be the wrong tool for a reset link.
 *
 * Otherwise SMTP, so Resend, SendGrid, Mailgun, SES or a Gmail app password all
 * work with the same four variables and no lock-in.
 *
 * Otherwise the message is written to the log. That keeps the flows usable in
 * development without a mail account, and makes missing configuration loud
 * rather than a silent no-op.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private brevoKey: string | null = null;
  private from = 'QuickPlan <no-reply@quickplan.app>';
  private fromName = 'QuickPlan';
  private fromEmail = 'no-reply@quickplan.app';

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.from = this.config.get<string>('MAIL_FROM', this.from);
    this.parseFrom(this.from);

    const brevo = this.config.get<string>('BREVO_API_KEY');

    if (brevo) {
      this.brevoKey = brevo;
      this.logger.log(`Mail configured via Brevo, sending as ${this.fromEmail}`);
      return;
    }

    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASSWORD');
    const port = Number(this.config.get<string>('SMTP_PORT', '587'));

    if (!host || !user || !pass) {
      this.logger.warn(
        'No BREVO_API_KEY and no SMTP settings. Emails will be written to the log instead of sent.',
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
    return this.brevoKey !== null || this.transporter !== null;
  }

  /**
   * Send without making the caller wait.
   *
   * forgot-password and resend-verification have to answer identically for a
   * registered and an unregistered address. Awaiting a mail round-trip on only
   * one of those branches makes them trivially distinguishable with a
   * stopwatch, which defeats the point of the identical wording. Nothing the
   * caller does depends on the result, and failures are already logged.
   */
  dispatch(to: string, subject: string, text: string, html?: string): void {
    void this.send(to, subject, text, html).catch((error) => {
      this.logger.error(
        `Dispatching "${subject}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  async send(to: string, subject: string, text: string, html?: string): Promise<boolean> {
    if (this.brevoKey) {
      return this.sendViaBrevo(to, subject, text, html);
    }

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

  private async sendViaBrevo(
    to: string,
    subject: string,
    text: string,
    html?: string,
  ): Promise<boolean> {
    try {
      const response = await fetch(BREVO_ENDPOINT, {
        method: 'POST',
        headers: {
          'api-key': this.brevoKey as string,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { name: this.fromName, email: this.fromEmail },
          to: [{ email: to }],
          subject,
          textContent: text,
          ...(html ? { htmlContent: html } : {}),
        }),
      });

      if (!response.ok) {
        // Body, not just the status: Brevo explains an unverified sender or a
        // bad key there, and the status alone would send someone hunting.
        const detail = await response.text();
        this.logger.error(`Brevo refused "${subject}" (${response.status}): ${detail.slice(0, 300)}`);

        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(
        `Brevo request for "${subject}" failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return false;
    }
  }

  /** Accepts either "Name <a@b.com>" or a bare address. */
  private parseFrom(value: string): void {
    const match = value.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);

    if (match) {
      this.fromName = match[1] || 'QuickPlan';
      this.fromEmail = match[2];

      return;
    }

    this.fromEmail = value.trim();
  }
}
