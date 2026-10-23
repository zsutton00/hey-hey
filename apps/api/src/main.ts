import './load-environment';
// Register tracing before Nest, Express, Prisma, and outbound clients load.
const { startApiTracing, shutdownApiTracing } =
  require('./telemetry/api-tracing') as typeof import('./telemetry/api-tracing');
startApiTracing();

import { assertDeploymentEnvironmentConfigured } from './load-environment';
import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

import { PrismaExceptionFilter } from './prisma-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { OrganizationContextInterceptor } from './common/interceptors/organization-context.interceptor';
import { EventContextInterceptor } from './common/interceptors/event-context.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ValidationPipe, LogLevel, Logger } from '@nestjs/common';
import { CorsConfig } from './common/config/cors.config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { CustomLoggerService } from './common/logger/logger.service';
import * as cookieParser from 'cookie-parser';
import * as compression from 'compression';

import './workflows/workers';
import { PrismaService } from './prisma/prisma.service';
import { OutboxPublisher } from './core/events/outbox-publisher.service';
import { assertCurrentWorktreeDatabaseTarget } from './utils/worktree-database';

// Configure global BigInt serialization for JSON responses
declare global {
  interface BigInt {
    toJSON(): string;
  }
}

BigInt.prototype.toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  assertDeploymentEnvironmentConfigured();
  assertCurrentWorktreeDatabaseTarget();
  const logLevel = process.env.LOG_LEVEL?.toLowerCase() || 'log';
  const nestLogLevels: LogLevel[] = [
    'error',
    'warn',
    'log',
    'debug',
    'verbose',
  ];
  const maxLevelIndex = nestLogLevels.indexOf(logLevel as LogLevel);
  const allowedLevels: LogLevel[] =
    maxLevelIndex >= 0 ? nestLogLevels.slice(0, maxLevelIndex + 1) : ['log'];

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    logger: allowedLevels,
    bodyParser: false,
    rawBody: true,
  });

  // Production nginx is the single proxy hop and appends the peer address to
  // X-Forwarded-For. Trusting exactly one hop makes request.ip the real client
  // address and ignores any forged entries the client put in the header.
  app.set('trust proxy', 1);

  // Replace default logger completely
  if (process.env.LOGGER !== 'nestjs') {
    const customLogger = app.get(CustomLoggerService);
    app.useLogger(customLogger);
  }
  const bootstrapLogger = new Logger('Bootstrap');
  const logFormat = process.env.LOG_FORMAT?.toLowerCase();
  const useJsonConsoleLogs =
    process.env.LOG_JSON === 'true' || logFormat === 'json';

  if (!useJsonConsoleLogs) {
    // Include process ID for direct console calls in local/dev output.
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => originalLog(`[PID:${process.pid}]`, ...args);
    console.error = (...args) => originalError(`[PID:${process.pid}]`, ...args);
  }

  // Use Socket.IO adapter for WebSocket support
  app.useWebSocketAdapter(new IoAdapter(app));

  // Enable cookie parsing for HTTP-only cookies
  app.use(cookieParser());

  // Enable response compression
  app.use(compression());

  // Keep Nest's authoritative raw-body capture and ordinary URL-encoded
  // parsing. The JSON limit fits a 1,000,000-byte image section once base64
  // encoded (~1.34 MB) plus its task or proposal envelope.
  app.useBodyParser('json', { limit: '2mb' });

  // Parse URL-encoded bodies (OAuth form submissions)
  app.useBodyParser('urlencoded', { extended: true });

  // Configure CORS with whitelist
  app.enableCors(CorsConfig.getCorsOptions());

  // Log CORS configuration for debugging
  CorsConfig.logConfiguration();

  // Apply global pipes, filters, interceptors and guards
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.useGlobalFilters(new PrismaExceptionFilter(), new HttpExceptionFilter());

  app.useGlobalInterceptors(
    new EventContextInterceptor(), // Must run after auth to populate EventContext with user info
    new OrganizationContextInterceptor(app.get(PrismaService)),
    new TransformInterceptor(app.get(Reflector)),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  bootstrapLogger.log(`Application is running on: http://localhost:${port}`);

  // Start worker if in development mode or explicitly requested
  if (
    process.env.START_WORKER === 'true' ||
    process.env.NODE_ENV === 'development'
  ) {
    try {
      const { startWorker } = await import('./worker');
      await startWorker(app);
      bootstrapLogger.log('Temporal Worker started successfully');
    } catch (error) {
      const trace = error instanceof Error ? error.stack : String(error);
      bootstrapLogger.error('Failed to start Temporal Worker', trace);
      // Don't exit - let the API continue running
    }
  }

  // Graceful shutdown handling
  const gracefulShutdown = async (signal: string) => {
    bootstrapLogger.log(`Received ${signal}. Starting graceful shutdown...`);
    try {
      // Gracefully stop outbox polling loop
      try {
        const publisher = app.get(OutboxPublisher, { strict: false });
        await publisher?.stopPublisher?.();
      } catch {}

      await app.close();
      await shutdownApiTracing();
      bootstrapLogger.log('Application closed successfully');
      process.exit(0);
    } catch (error) {
      await shutdownApiTracing();
      const trace = error instanceof Error ? error.stack : String(error);
      bootstrapLogger.error('Error during shutdown', trace);
      process.exit(1);
    }
  };

  // Listen for termination signals
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}
bootstrap();
