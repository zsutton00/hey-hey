import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import {
  renderPrivateBetaAccessExistingAccountEmail,
  renderPrivateBetaAccessOperatorEmail,
  renderPrivateBetaAccessRequesterEmail,
  type PrivateBetaAccessEmailRequest,
} from './email/private-beta-access-email.template';
import { renderWelcomeEmail } from './email/welcome-email.template';
import { renderPasswordRecoveryEmail } from './email/password-recovery-email.template';

type EmailDeliveryFailure =
  | 'provider_rejected'
  | 'transport_failed'
  | 'not_configured';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly fromAddress: string | null;
  private readonly webAppUrl: string | null;
  private readonly localDeliveryUrl: string | null;
  private readonly localDeliveryApiKey: string | null;

  constructor(private readonly configService: ConfigService) {
    const isDevelopment =
      this.configService.get<string>('NODE_ENV') === 'development';
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    const from = this.configService.get<string>('RESEND_FROM_ADDRESS');
    const configuredBaseUrl = this.configService.get<string>('RESEND_BASE_URL');
    this.webAppUrl =
      this.configService.get<string>('WEB_APP_URL') ??
      (isDevelopment ? 'http://localhost:5173' : null);

    if (apiKey && from && configuredBaseUrl) {
      this.resend = null;
      this.fromAddress = from;
      this.localDeliveryUrl = `${configuredBaseUrl.replace(/\/+$/, '')}/emails`;
      this.localDeliveryApiKey = apiKey;
    } else if (apiKey && from) {
      this.resend = new Resend(apiKey);
      this.fromAddress = from;
      this.localDeliveryUrl = null;
      this.localDeliveryApiKey = null;
    } else if (isDevelopment) {
      const baseUrl =
        this.configService.get<string>('RESEND_BASE_URL') ??
        'http://127.0.0.1:4010';
      this.resend = null;
      this.fromAddress = from ?? 'Hey Hey <noreply@localhost>';
      this.localDeliveryUrl = `${baseUrl.replace(/\/+$/, '')}/emails`;
      this.localDeliveryApiKey = null;
      this.logger.warn(
        `Email provider is not configured; using local development delivery at ${this.localDeliveryUrl}`,
      );
    } else {
      this.resend = null;
      this.fromAddress = null;
      this.localDeliveryUrl = null;
      this.localDeliveryApiKey = null;
      this.logger.warn(
        'RESEND_API_KEY or RESEND_FROM_ADDRESS not set — emails will not be sent',
      );
    }
  }

  async sendWelcomeEmail(params: {
    to: string;
    name: string;
    passwordChangeCredential: string;
    providerIdempotencyKey?: string;
  }): Promise<void> {
    if ((!this.resend && !this.localDeliveryUrl) || !this.fromAddress) {
      this.logger.error(
        'Cannot send welcome email: RESEND_API_KEY or RESEND_FROM_ADDRESS not set',
      );
      throw new Error('Email service is not configured');
    }

    if (!this.webAppUrl) {
      this.logger.error('Cannot send welcome email: WEB_APP_URL not set');
      throw new Error('Email service is not configured');
    }

    const recipientName = this.deriveRecipientName(params.name);
    const welcomeUrl = this.buildWelcomeUrl(
      this.webAppUrl,
      params.name,
      params.passwordChangeCredential,
    );

    this.logger.log('Sending welcome email', {
      hasRecipientName: recipientName !== null,
      hasProviderIdempotencyKey: Boolean(params.providerIdempotencyKey),
    });

    const { subject, html, text } = renderWelcomeEmail({
      recipientName,
      welcomeUrl,
    });

    const email = {
      from: this.fromAddress,
      to: params.to,
      subject,
      html,
      text,
    };
    const error = await this.sendEmail(email, params.providerIdempotencyKey);

    if (error) {
      this.logger.error('Failed to send welcome email', {
        failureType: error,
      });
      throw new Error('Failed to send welcome email');
    }

    this.logger.log('Welcome email sent');
  }

  async sendPasswordRecoveryEmail(params: {
    to: string;
    name: string;
    recoveryCredential: string;
  }): Promise<void> {
    if (!this.webAppUrl) {
      throw new Error('Email service is not configured');
    }
    const url = new URL('/change-password', this.webAppUrl);
    url.hash = new URLSearchParams({
      recoveryCredential: params.recoveryCredential,
    }).toString();
    const rendered = renderPasswordRecoveryEmail({
      recipientName: this.deriveRecipientName(params.name),
      recoveryUrl: url.toString(),
    });
    await this.sendRenderedEmail({
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      kind: 'password recovery',
    });
  }

  async sendPrivateBetaAccessRequesterEmail(
    request: Pick<
      PrivateBetaAccessEmailRequest,
      'requestId' | 'name' | 'submittedEmail'
    >,
  ): Promise<void> {
    const rendered = renderPrivateBetaAccessRequesterEmail(request);
    await this.sendRenderedEmail({
      to: request.submittedEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      kind: 'private-beta requester',
    });
  }

  async sendPrivateBetaAccessExistingAccountEmail(
    request: Pick<PrivateBetaAccessEmailRequest, 'name' | 'submittedEmail'>,
  ): Promise<void> {
    if (!this.webAppUrl) {
      this.logger.error(
        'Cannot send private-beta existing-account email: WEB_APP_URL not set',
      );
      throw new Error('Email service is not configured');
    }
    const rendered = renderPrivateBetaAccessExistingAccountEmail({
      name: request.name,
      signInUrl: new URL('/login', this.webAppUrl).toString(),
    });
    await this.sendRenderedEmail({
      to: request.submittedEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      kind: 'private-beta existing-account',
    });
  }

  async sendPrivateBetaAccessOperatorEmail(
    request: PrivateBetaAccessEmailRequest,
  ): Promise<void> {
    const operatorAddress = this.configService.get<string>(
      'PRIVATE_BETA_ACCESS_OPERATOR_EMAIL',
    );
    if (!operatorAddress) {
      this.logger.error(
        'Cannot send private-beta operator email: PRIVATE_BETA_ACCESS_OPERATOR_EMAIL not set',
      );
      throw new Error('Private-beta operator email is not configured');
    }

    const rendered = renderPrivateBetaAccessOperatorEmail(request);
    await this.sendRenderedEmail({
      to: operatorAddress,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      kind: 'private-beta operator',
    });
  }

  private async sendRenderedEmail(params: {
    to: string;
    subject: string;
    html: string;
    text: string;
    kind: string;
  }): Promise<void> {
    if ((!this.resend && !this.localDeliveryUrl) || !this.fromAddress) {
      this.logger.error(
        `Cannot send ${params.kind} email: RESEND_API_KEY or RESEND_FROM_ADDRESS not set`,
      );
      throw new Error('Email service is not configured');
    }

    this.logger.debug(`Sending ${params.kind} email`);
    const error = await this.sendEmail({
      from: this.fromAddress,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });

    if (error) {
      this.logger.error(`Failed to send ${params.kind} email`, {
        failureType: error,
      });
      throw new Error(`Failed to send ${params.kind} email`);
    }

    this.logger.debug(`${params.kind} email sent`);
  }

  private async sendEmail(
    email: {
      from: string;
      to: string;
      subject: string;
      html: string;
      text: string;
    },
    idempotencyKey?: string,
  ): Promise<EmailDeliveryFailure | null> {
    try {
      if (this.resend) {
        const response = idempotencyKey
          ? await this.resend.emails.send(email, { idempotencyKey })
          : await this.resend.emails.send(email);
        return response.error ? 'provider_rejected' : null;
      }

      if (!this.localDeliveryUrl) {
        return 'not_configured';
      }

      const response = await fetch(this.localDeliveryUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.localDeliveryApiKey
            ? { authorization: `Bearer ${this.localDeliveryApiKey}` }
            : {}),
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
        body: JSON.stringify(email),
      });
      if (!response.ok) {
        return 'provider_rejected';
      }
      return null;
    } catch {
      return 'transport_failed';
    }
  }

  private deriveRecipientName(
    rawName: string | null | undefined,
  ): string | null {
    if (!rawName) return null;
    const trimmed = rawName.trim();
    if (trimmed.length === 0) return null;
    // Guard against callers passing the email as a fallback name.
    if (trimmed.includes('@')) return null;
    return trimmed;
  }

  private buildWelcomeUrl(
    webAppUrl: string,
    inviteName: string,
    passwordChangeCredential: string,
  ): string {
    const url = new URL(webAppUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
    url.searchParams.set('welcome', '1');
    url.searchParams.set('name', inviteName);
    url.hash = new URLSearchParams({
      welcomeCredential: passwordChangeCredential,
    }).toString();
    return url.toString();
  }
}
