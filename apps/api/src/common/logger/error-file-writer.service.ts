import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { LogContext } from './logger.service';

export interface ErrorFileData {
  timestamp: string;
  level: 'error';
  message: string;
  stack?: string;
  context: LogContext;
  service: string;
  processId: number;
  environment: string;
  nodeVersion: string;
}

@Injectable()
export class ErrorFileWriter {
  private readonly errorsDir: string;
  private readonly isEnabled: boolean;

  constructor() {
    // Only enable in development environment
    this.isEnabled =
      process.env.NODE_ENV === 'development' ||
      process.env.NODE_ENV === 'local' ||
      process.env.ENABLE_ERROR_FILES === 'true';

    // Allow tests (and special deployments) to redirect error files to an
    // isolated directory. Defaults to the standard logs/errors location.
    this.errorsDir =
      process.env.ERROR_FILES_DIR || path.join(process.cwd(), 'logs', 'errors');

    if (this.isEnabled) {
      this.ensureErrorsDirectory();
    }
  }

  /**
   * Write an error to an individual timestamped file
   */
  async writeErrorFile(
    message: string,
    stack?: string,
    context: LogContext = {},
    additionalData?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    try {
      const timestamp = new Date().toISOString();
      const correlationId = context.correlationId || 'no-correlation';

      // Create filename with timestamp and correlation ID
      const safeTimestamp = timestamp.replace(/[:.]/g, '-');
      const safeCorrelationId = correlationId.replace(/[^a-zA-Z0-9-]/g, '');
      const filename = `error_${safeTimestamp}_${safeCorrelationId}.json`;
      const filepath = path.join(this.errorsDir, filename);

      const errorData: ErrorFileData = {
        timestamp,
        level: 'error',
        message,
        stack,
        context,
        service: 'hey-hey-api',
        processId: process.pid,
        environment: process.env.DEPLOYMENT_ENVIRONMENT || 'unknown',
        nodeVersion: process.version,
        ...additionalData,
      };

      // Write error data as formatted JSON
      const jsonContent = JSON.stringify(errorData, null, 2);
      await fs.promises.writeFile(filepath, jsonContent, 'utf8');

      // Optionally clean up old error files (keep last 100)
      this.cleanupOldErrorFiles().catch(() => {
        // Ignore cleanup errors
      });
    } catch (writeError) {
      // Don't throw - we don't want error file writing to break the main application
      console.warn('Failed to write error file:', writeError);
    }
  }

  /**
   * Write error from Error object
   */
  async writeErrorFromError(
    error: Error,
    context: LogContext = {},
    additionalData?: Record<string, unknown>,
  ): Promise<void> {
    await this.writeErrorFile(error.message, error.stack, context, {
      errorName: error.name,
      ...additionalData,
    });
  }

  /**
   * Ensure the errors directory exists
   */
  private ensureErrorsDirectory(): void {
    try {
      if (!fs.existsSync(this.errorsDir)) {
        fs.mkdirSync(this.errorsDir, { recursive: true });
      }
    } catch (error) {
      console.warn('Failed to create errors directory:', error);
    }
  }

  /**
   * Clean up old error files to prevent disk space issues
   * Keeps the most recent 100 error files
   */
  private async cleanupOldErrorFiles(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.errorsDir);
      const errorFiles = files
        .filter((file) => file.startsWith('error_') && file.endsWith('.json'))
        .map((file) => ({
          name: file,
          path: path.join(this.errorsDir, file),
          stat: fs.statSync(path.join(this.errorsDir, file)),
        }))
        .sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime()); // Sort by modification time, newest first

      // Keep only the most recent 100 files
      const filesToDelete = errorFiles.slice(100);

      for (const file of filesToDelete) {
        try {
          await fs.promises.unlink(file.path);
        } catch (deleteError) {
          // Ignore individual file deletion errors
        }
      }
    } catch (cleanupError) {
      // Ignore cleanup errors - they shouldn't break the application
    }
  }

  /**
   * Get the status of the error file writer
   */
  getStatus(): { enabled: boolean; errorsDir: string; fileCount?: number } {
    const status = {
      enabled: this.isEnabled,
      errorsDir: this.errorsDir,
    };

    if (this.isEnabled) {
      try {
        const files = fs.readdirSync(this.errorsDir);
        const errorFiles = files.filter(
          (file) => file.startsWith('error_') && file.endsWith('.json'),
        );
        return {
          ...status,
          fileCount: errorFiles.length,
        };
      } catch {
        return status;
      }
    }

    return status;
  }
}
