import type { RunStore } from '../../run-store/run-store';
import type { ServerLogger } from '../logger';
import type { LocalAgentService } from '../local-agent-service';
import type { PlatformAuthContext } from '../platform-auth-context';
import type { PlatformWebSocketEvent } from '../platform-ws';
import { EntityReportIndex } from './entity-report-index';
import { rehydrateReportIndex } from './rehydrate-index';
import { ReportInfluenceAccumulator } from './report-influence-accumulator';

export interface ReportInfluenceRuntimeOptions {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  authContext: PlatformAuthContext;
  runStore: RunStore;
  agentService: LocalAgentService;
  index: EntityReportIndex;
  logger: ServerLogger;
}

/** Owns the complete entity-influence lifecycle for report-update Runs. */
export class ReportInfluenceRuntime {
  private readonly index: EntityReportIndex;
  private readonly accumulator: ReportInfluenceAccumulator;

  public constructor(private readonly options: ReportInfluenceRuntimeOptions) {
    this.index = options.index;
    this.accumulator = new ReportInfluenceAccumulator({
      index: this.index,
      apiBaseUrl: options.apiBaseUrl,
      fetchImpl: options.fetchImpl,
      authContext: options.authContext,
      runStore: options.runStore,
      agentService: options.agentService,
      logger: options.logger,
    });
  }

  public handlePlatformEvent(event: PlatformWebSocketEvent): void {
    this.accumulator.handleEvent(event);
  }

  public handleRunFinished(runId: string): void {
    this.accumulator.onRunFinished(runId);
  }

  public async rehydrate(): Promise<void> {
    const auth = await this.options.authContext.resolve();
    if (!auth) {
      this.options.logger.info('report-update.rehydrate.skipped_missing_context');
      return;
    }

    await rehydrateReportIndex({
      index: this.index,
      organizationId: auth.organizationId,
      projectId: auth.projectId,
      accessToken: auth.accessToken,
      apiBaseUrl: this.options.apiBaseUrl,
      fetchImpl: this.options.fetchImpl,
      logger: this.options.logger,
    });
  }
}
