import { Configuration, ReportsApi } from '../../shared/api/generated';
import type {
  EvalAttemptReportPayload,
  EvalRunReportPayload,
  ReportDto,
} from '../../shared/api/generated/api';
import type { EvalAttemptPatch, EvalRunRecorder } from './eval-runner';

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
 * launch recorded. Each report's payload is read once and every later write
 * replaces it with the merged state; writes to one report are serialised so a
 * slower earlier write can never land after a later one.
 */
export class EvalReportRecorder implements EvalRunRecorder {
  private readonly payloads = new Map<
    string,
    Promise<EvalRunReportPayload | EvalAttemptReportPayload>
  >();
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
    return this.write(
      this.evalRunId,
      'EVAL_RUN',
      (payload): EvalRunReportPayload => ({
        ...(payload as EvalRunReportPayload),
        status,
        ...(status === 'RUNNING' ? {} : { completedAt: new Date().toISOString() }),
      }),
    );
  }

  public updateAttempt(attemptId: string, patch: EvalAttemptPatch): Promise<void> {
    return this.write(attemptId, 'EVAL_ATTEMPT', (payload) => {
      const next: EvalAttemptReportPayload = { ...(payload as EvalAttemptReportPayload), ...patch };
      if (next.status !== 'STOPPED') delete next.stopReason;
      return next;
    });
  }

  private write(
    reportId: string,
    reportType: 'EVAL_RUN' | 'EVAL_ATTEMPT',
    apply: (
      payload: EvalRunReportPayload | EvalAttemptReportPayload,
    ) => EvalRunReportPayload | EvalAttemptReportPayload,
  ): Promise<void> {
    const previous = this.writes.get(reportId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const current = await this.read(reportId, reportType);
        const updated = apply(current);
        await this.client.updateReport({
          organizationId: this.organizationId,
          reportId,
          updateReportDto: { payload: updated },
        });
        this.payloads.set(reportId, Promise.resolve(updated));
      });
    this.writes.set(reportId, next);
    return next;
  }

  private read(
    reportId: string,
    reportType: 'EVAL_RUN' | 'EVAL_ATTEMPT',
  ): Promise<EvalRunReportPayload | EvalAttemptReportPayload> {
    let cached = this.payloads.get(reportId);
    if (!cached) {
      cached = this.client
        .getReport({ organizationId: this.organizationId, reportId })
        .then((response) => {
          const report = response.data.data;
          if (!report) throw new Error(`Report ${reportId} was not returned.`);
          return readPayload(report, reportType);
        });
      this.payloads.set(reportId, cached);
      // A failed read must not poison later writes.
      cached.catch(() => this.payloads.delete(reportId));
    }
    return cached;
  }
}
