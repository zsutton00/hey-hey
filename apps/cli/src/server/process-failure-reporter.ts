import { mkdirSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { resolveBaseDir } from '../session/paths';
import type { DiagnosticFeed } from './diagnostic-feed';
import type { ServerLogger } from './logger';

/** Owns the process-level failure listeners installed for a running local server. */
export class ProcessFailureReporter {
  private installed = false;

  public constructor(
    private readonly logger: ServerLogger,
    private readonly diagnosticFeed: DiagnosticFeed,
  ) {}

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
    this.reportAndExit('local.server.uncaught_exception', error);
  };

  private readonly handleUnhandledRejection = (reason: unknown): void => {
    this.reportAndExit(
      'local.server.unhandled_rejection',
      reason instanceof Error ? reason : new Error(String(reason)),
    );
  };

  private reportAndExit(event: string, error: Error): never {
    // Interactive log output is memory-only. Both persistence and terminal
    // output must finish synchronously before exiting, bypassing TUI capture.
    const timestamp = new Date().toISOString();
    try {
      this.logger.error(event, { error: error.message, stack: error.stack });
    } catch {
      // A broken log sink must not hide the original process failure.
    }
    let reportStatus: string;
    try {
      const directory = path.join(resolveBaseDir(), 'crashes');
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const reportPath = path.join(
        directory,
        `crash-${timestamp.replace(/:/gu, '-')}-${String(process.pid)}.json`,
      );
      writeFileSync(
        reportPath,
        JSON.stringify({
          timestamp,
          event,
          pid: process.pid,
          error: error.message,
          stack: error.stack,
          diagnostics: this.diagnosticFeed.snapshot(),
        }),
        { encoding: 'utf8', mode: 0o600, flag: 'wx' },
      );
      reportStatus = `Crash report: ${reportPath}`;
    } catch (reportError) {
      reportStatus = `Could not save crash report: ${
        reportError instanceof Error ? reportError.message : String(reportError)
      }`;
    }
    try {
      writeSync(2, `\n${event}: ${error.stack ?? error.message}\n${reportStatus}\n`);
    } catch {
      // stderr may be closed; the report is already durable when available.
    }
    process.exit(1);
  }
}
