import { isAxiosError } from 'axios';
import { Configuration, ReportsApi } from '../../shared/api/generated';
import type {
  EvalAttemptReportPayload,
  EvalRunReportPayload,
  ReportDto,
} from '../../shared/api/generated/api';
import type { EvalAttemptPatch, EvalRunRecorder } from './eval-runner';

const RUN_WRITE_ATTEMPTS = 5;

const isVersionConflict = (error: unknown): boolean =>
  isAxiosError(error) && error.response?.status === 409;

type ReportsClient = Pick<ReportsApi, 'getReport' | 'updateReport'>;

const readPayload = <TType extends 'EVAL_RUN' | 'EVAL_ATTEMPT'>(
  report: ReportDto,
  reportType: TType,
): TType extends 'EVAL_RUN' ? EvalRunReportPayload : EvalAttemptReportPayload => {
  const payload: unknown = report.payload;
  if (
    typeof payload !== 'object' ||
    payload === null ||
    (payload as { reportType?: unknown }).reportType !== reportType
  ) {
    throw new Error(`Report ${report.id} is not an ${reportType} report.`);
  }
  return payload as TType extends 'EVAL_RUN' ? EvalRunReportPayload : EvalAttemptReportPayload;
};

/**
 * Writes run and attempt state onto the EVAL_RUN and EVAL_ATTEMPT reports that
 * launch recorded. An attempt's payload is read once and every later write
 * replaces it with the merged state, since only the runner writes attempts. The
 * run's payload is read again before every write because people rename the run
 * while it is going. Writes to one report are serialised so a slower earlier
 * write can never land after a later one.
 */
export class EvalReportRecorder implements EvalRunRecorder {
  private readonly payloads = new Map<string, Promise<EvalAttemptReportPayload>>();
  private readonly writes = new Map<string, Promise<void>>();

  public constructor(
    private readonly client: ReportsClient,
    private readonly organizationId: string,
    private readonly evalRunId: string,
  ) {}

  public static create(input: {
    accessToken: string;
    apiBaseUrl: string;
    organizationId: string;
    evalRunId: string;
  }): EvalReportRecorder {
    const client = new ReportsApi(
      new Configuration({ accessToken: input.accessToken, basePath: input.apiBaseUrl }),
    );
    return new EvalReportRecorder(client, input.organizationId, input.evalRunId);
  }

  public setRunStatus(status: 'RUNNING' | 'FINISHED' | 'STOPPED'): Promise<void> {
    return this.enqueue(this.evalRunId, () =>
      this.writeRun(this.evalRunId, (payload) => ({
        ...payload,
        status,
        ...(status === 'RUNNING' ? {} : { completedAt: new Date().toISOString() }),
      })),
    );
  }

  public updateAttempt(attemptId: string, patch: EvalAttemptPatch): Promise<void> {
    return this.enqueue(attemptId, () =>
      this.writeAttempt(attemptId, (payload) => {
        const next: EvalAttemptReportPayload = { ...payload, ...patch };
        if (next.status !== 'STOPPED') delete next.stopReason;
        return next;
      }),
    );
  }

  private enqueue(reportId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.writes.get(reportId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.writes.set(reportId, next);
    return next;
  }

  /** Only the runner writes an attempt, so its payload is read once and kept. */
  private async writeAttempt(
    reportId: string,
    apply: (payload: EvalAttemptReportPayload) => EvalAttemptReportPayload,
  ): Promise<void> {
    let cached = this.payloads.get(reportId);
    if (!cached) {
      cached = this.client
        .getReport({ organizationId: this.organizationId, reportId })
        .then((response) => {
          const report = response.data.data;
          if (!report) throw new Error(`Report ${reportId} was not returned.`);
          return readPayload(report, 'EVAL_ATTEMPT');
        });
      this.payloads.set(reportId, cached);
      // A failed read must not poison later writes.
      cached.catch(() => this.payloads.delete(reportId));
    }
    const updated = apply(await cached);
    await this.client.updateReport({
      organizationId: this.organizationId,
      reportId,
      updateReportDto: { payload: updated, ragEnabled: false },
    });
    this.payloads.set(reportId, Promise.resolve(updated));
  }

  /**
   * People rename the run while it is going, so the run is read fresh for each
   * write and written against the version that was read. If the run moved on
   * in between, nothing is written and the write is redone on what is now
   * stored, so neither a rename nor a status change is ever overwritten.
   */
  private async writeRun(
    reportId: string,
    apply: (payload: EvalRunReportPayload) => EvalRunReportPayload,
  ): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      const response = await this.client.getReport({
        organizationId: this.organizationId,
        reportId,
      });
      const report = response.data.data;
      if (!report) throw new Error(`Report ${reportId} was not returned.`);
      const updated = apply(readPayload(report, 'EVAL_RUN'));
      try {
        await this.client.updateReport({
          organizationId: this.organizationId,
          reportId,
          updateReportDto: { payload: updated, expectedVersion: report.version, ragEnabled: false },
        });
        return;
      } catch (error) {
        if (!isVersionConflict(error) || attempt === RUN_WRITE_ATTEMPTS) {
          throw error;
        }
      }
    }
  }
}
