import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Verifies a Cloudflare Turnstile token server-side with the configured secret. */
@Injectable()
export class BotCheckService {
  constructor(private readonly config: ConfigService) {}

  async verify(token: string, remoteIp: string | undefined): Promise<boolean> {
    const body = new URLSearchParams({
      secret: this.config.getOrThrow<string>('DEMO_BOT_CHECK_SECRET'),
      response: token,
    });
    if (remoteIp) body.set('remoteip', remoteIp);
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Bot-check verification failed: ${response.status}`);
    }
    const result = (await response.json()) as { success: boolean };
    return result.success;
  }
}
