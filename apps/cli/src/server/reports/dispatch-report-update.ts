import type { ServerLogger } from '../logger';
import {
  INTERNAL_ONLY_SYSTEM_AGENT_SESSION_ID,
  LocalReportEntityRelation,
  type LocalRunProvider,
} from '../../shared/agent-bridge-contract/index';
import type { ReportInfluenceDispatchInput } from './report-influence-accumulator';
import type { RunStore } from '../../run-store/run-store';
import type { PlatformAuthContext } from '../platform-auth-context';
import type { LocalAgentService } from '../local-agent-service';

export interface ReportUpdateRunBinding {
  conversationId: string;
  provider: string;
}

export interface ReportUpdateDispatcherOptions {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  authContext: PlatformAuthContext;
  runStore: RunStore;
  agentService: LocalAgentService;
  logger: ServerLogger;
}

interface FetchedReport {
  reportType: string;
  title?: string;
  text: string;
  entities: Array<{
    entityType: string;
    entityId: string;
    relation: LocalReportEntityRelation;
  }>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toRecord = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? value : null;

const fetchReport = async (
  reportId: string,
  deps: ReportUpdateDispatcherOptions,
  auth: { accessToken: string; organizationId: string },
): Promise<FetchedReport | null> => {
  const endpoint = `${deps.apiBaseUrl}/organizations/${encodeURIComponent(auth.organizationId)}/reports/${encodeURIComponent(reportId)}`;
  const response = await deps.fetchImpl(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  });
  if (!response.ok) {
    const body = await response.text();
    deps.logger.error('report-update.dispatch.report-fetch-failed', {
      reportId,
      status: response.status,
      body: body.slice(0, 500),
    });
    return null;
  }

  const json: unknown = await response.json();
  const envelope = toRecord(json);
  const report = toRecord(envelope?.['data']);
  if (!report) {
    deps.logger.error('report-update.dispatch.report-missing-data', { reportId });
    return null;
  }

  const payloadObj = toRecord(report['payload']) ?? {};
  const text = typeof payloadObj['text'] === 'string' ? payloadObj['text'] : '';
  const titleRaw =
    typeof report['title'] === 'string'
      ? report['title']
      : typeof payloadObj['title'] === 'string'
        ? payloadObj['title']
        : undefined;
  const reportType = typeof report['reportType'] === 'string' ? report['reportType'] : 'UNKNOWN';
  const entitiesRaw = report['entities'];
  const entities = Array.isArray(entitiesRaw)
    ? entitiesRaw
        .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
        .map((e) => ({
          entityType: String(e['entityType'] ?? ''),
          entityId: String(e['entityId'] ?? ''),
          relation:
            e['relation'] === LocalReportEntityRelation.Primary
              ? LocalReportEntityRelation.Primary
              : LocalReportEntityRelation.Context,
        }))
        .filter((e) => e.entityType && e.entityId)
    : [];

  if (!text) {
    deps.logger.warn('report-update.dispatch.report-has-no-text', { reportId });
    return null;
  }

  return {
    reportType,
    ...(titleRaw ? { title: titleRaw } : {}),
    text,
    entities,
  };
};

/**
 * Given an accumulated threshold firing, fetches the current report's content
 * and kicks off a scoped agent
 * run (`promptType: 'report_update'`) that will update the report in place.
 *
 * The created run id is returned to the accumulator so that the accumulator
 * remains the sole owner of its in-flight state.
 */
export class ReportUpdateDispatcher {
  public constructor(private readonly options: ReportUpdateDispatcherOptions) {}

  public async dispatch(input: ReportInfluenceDispatchInput): Promise<string | null> {
    const auth = await this.options.authContext.resolve();
    const binding = await this.resolveRunBinding();
    if (!auth || !binding) {
      this.options.logger.warn('report-update.dispatch.deps-unavailable', {
        reportId: input.reportId,
        hasAuth: !!auth,
        hasReportBinding: !!binding,
      });
      return null;
    }

    try {
      const report = await fetchReport(input.reportId, this.options, auth);
      if (!report) return null;

      const createResult = await this.options.agentService.createRun({
        attachments: [],
        stagedBrowserTab: null,
        context: {
          projectId: auth.projectId,
          provider: binding.provider as LocalRunProvider,
        },
        contextMetadata: {
          capturedAt: new Date().toISOString(),
          organizationId: auth.organizationId,
          projectId: auth.projectId,
          agentSessionId: INTERNAL_ONLY_SYSTEM_AGENT_SESSION_ID,
          userComments: [],
          fileReferences: { resolved: [], unresolved: [] },
        },
        conversationId: binding.conversationId,
        payload: {
          promptType: 'report_update',
          payloadVersion: 1,
          reportId: input.reportId,
          reportType: report.reportType,
          ...(report.title ? { title: report.title } : {}),
          text: report.text,
          entities: report.entities,
          changedEntities: input.changedEntities,
          events: input.events.map((event) => ({ ...event })),
        },
      });

      if (createResult.status === 'repo-required') {
        this.options.logger.warn('report-update.dispatch.repo-required', {
          reportId: input.reportId,
        });
        return null;
      }

      const runId = createResult.run.agentic_session_id;
      this.options.logger.debug('report-update.dispatch.run-created', {
        reportId: input.reportId,
        runId,
        changedCount: input.changedEntities.length,
        totalRefs: input.totalReferencedEntities,
      });
      return runId;
    } catch (error) {
      this.options.logger.error('report-update.dispatch.failed', {
        reportId: input.reportId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async resolveRunBinding(): Promise<ReportUpdateRunBinding | null> {
    const runs = await this.options.runStore.findRunsByPromptType('daily_session');
    const latest = [...runs].sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    )[0];
    if (!latest?.conversationId || !latest.provider) return null;
    return { conversationId: latest.conversationId, provider: latest.provider };
  }
}
