import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReportService } from './report.service';

@Injectable()
export class ReportRetentionService {
  private readonly logger = new Logger(ReportRetentionService.name);
  private readonly cleanupBatchSize = this.parsePositiveInt(
    process.env.REPORT_RETENTION_BATCH_SIZE,
    500,
  );

  constructor(private readonly reportService: ReportService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpiredReports(): Promise<void> {
    try {
      const deletedCount = await this.reportService.deleteExpiredReports(
        this.cleanupBatchSize,
      );

      if (deletedCount > 0) {
        this.logger.log('Purged expired reports', {
          deletedCount,
          cleanupBatchSize: this.cleanupBatchSize,
        });
      }
    } catch (error) {
      this.logger.error('Failed to purge expired reports', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private parsePositiveInt(
    value: string | undefined,
    fallback: number,
  ): number {
    if (!value) {
      return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return fallback;
    }

    return parsed;
  }
}
