import * as _ from 'lodash';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

export class CorsConfig {
  private static getWhitelistedOrigins(): string[] {
    const origins =
      process.env.CORS_WHITELIST ||
      `http://localhost:3000,${_.range(5173, 5178)
        .map((port) => `http://localhost:${port}`)
        .join(',')}`;
    return Array.from(
      new Set(
        origins
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0)
          .map((origin) => this.normalizeConfiguredOrigin(origin)),
      ),
    );
  }

  private static isDevelopment(): boolean {
    return process.env.NODE_ENV === 'development';
  }

  static getCorsOptions(): CorsOptions {
    return {
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) {
          return callback(null, true);
        }

        if (this.isBrowserOriginAllowed(origin)) {
          return callback(null, true);
        }

        // Log the rejected origin for debugging
        console.warn(`CORS: Origin ${origin} not allowed by whitelist`);
        return callback(new Error('Not allowed by CORS'), false);
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'X-API-Key',
      ],
      credentials: true,
      optionsSuccessStatus: 200, // Some legacy browsers (IE11, various SmartTVs) choke on 204
    };
  }

  static isBrowserOriginAllowed(origin: string | undefined): boolean {
    const normalizedOrigin = this.normalizeRequestOrigin(origin);
    if (!normalizedOrigin) {
      return false;
    }

    if (
      this.isDevelopment() &&
      new URL(normalizedOrigin).hostname === 'localhost'
    ) {
      return true;
    }

    return this.getWhitelistedOrigins().includes(normalizedOrigin);
  }

  static logConfiguration(): void {
    const whitelistedOrigins = this.getWhitelistedOrigins();
    const isDev = this.isDevelopment();

    console.log('CORS Configuration:');
    console.log(`- Environment: ${isDev ? 'development' : 'production'}`);
    console.log(`- Whitelisted origins: ${whitelistedOrigins.join(', ')}`);
    console.log(
      `- Development localhost bypass: ${isDev ? 'enabled' : 'disabled'}`,
    );
  }

  private static normalizeConfiguredOrigin(origin: string): string {
    const normalized = this.parseOrigin(origin);
    if (!normalized) {
      throw new Error('CORS_WHITELIST contains an invalid browser origin');
    }
    return normalized;
  }

  private static normalizeRequestOrigin(
    origin: string | undefined,
  ): string | undefined {
    if (typeof origin !== 'string' || origin.length === 0) {
      return undefined;
    }

    const trimmed = origin.trim();
    const normalized = this.parseOrigin(trimmed);
    return normalized === trimmed ? normalized : undefined;
  }

  private static parseOrigin(origin: string): string | undefined {
    try {
      const parsed = new URL(origin);
      if (
        (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash
      ) {
        return undefined;
      }
      return parsed.origin;
    } catch {
      return undefined;
    }
  }
}
