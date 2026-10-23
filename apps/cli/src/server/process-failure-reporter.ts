import type { ServerLogger } from './logger';

/** Owns the process-level failure listeners installed for a running local server. */
export class ProcessFailureReporter {
  private installed = false;

  public constructor(private readonly logger: ServerLogger) {}

  public start(): void {
    if (this.installed) return;
    this.installed = true;
    process.on('uncaughtException', this.handleUncaughtException);
    process.on('unhandledRejection', this.handleUnhandledRejection);
  }

  public dispose(): void {
    if (!this.installed) return;
    this.installed = false;
    process.off('uncaughtException', this.handleUncaughtException);
    process.off('unhandledRejection', this.handleUnhandledRejection);
  }

  private readonly handleUncaughtException = (error: Error): void => {
    this.logger.error('local.server.uncaught_exception', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  };

  private readonly handleUnhandledRejection = (reason: unknown): void => {
    this.logger.error('local.server.unhandled_rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
    process.exit(1);
  };
}
