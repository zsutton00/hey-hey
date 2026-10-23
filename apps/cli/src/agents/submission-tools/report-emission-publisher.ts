import type { ServerLogger } from '../../server/logger';
import type { MonitorPipeline } from '../../server/monitors';
import type { AgentSource } from '../../server/monitors/normalizer/agent-source';
import { REPORT_EMISSION_KIND } from '../../server/monitors/normalizer/types';
import type { ReportEmission } from './report-emission-events';

/** Publishes a successful report creation into the self-originated monitor lane. */
export class ReportEmissionPublisher {
  public constructor(
    private readonly agentSource: AgentSource,
    private readonly monitorPipeline: MonitorPipeline,
    private readonly logger: ServerLogger,
  ) {}

  public readonly handle = (emission: ReportEmission): void => {
    const canonical = this.agentSource.ingest({
      kind: REPORT_EMISSION_KIND,
      runId: emission.runId,
      reportId: emission.reportId,
      ...(emission.reportType ? { reportType: emission.reportType } : {}),
      targetSessionId: emission.runId,
      timestamp: new Date().toISOString(),
    });
    if (!canonical) {
      this.logger.warn('monitors.agent_source.report_emission.no_conversation', {
        runId: emission.runId,
        reportId: emission.reportId,
      });
      return;
    }

    this.logger.info('monitors.agent_source.report_emission', {
      runId: emission.runId,
      reportId: emission.reportId,
      targetSessionId: emission.runId,
    });
    this.monitorPipeline.ingest(canonical);
  };
}
