import { z } from 'zod';
import {
  MonitorNodeResultOutcome,
  type MonitorNodeResultReportPayload,
} from '@hey-hey/contracts/api/models';
import type { ServerLogger } from '../../../server/logger';
import type { PlatformAuthContext } from '../../../server/platform-auth-context';

const MONITOR_NODE_RESULT = 'MONITOR_NODE_RESULT';

/** Which node and session a normalized result must belong to. */
export interface TaskMonitorNodeResultScope {
  readonly organizationId: string;
  readonly projectId: string;
  readonly nodeId: string;
  readonly agentSessionId: string;
  /**
   * When set, only these reports count: the ones the settled Turn produced. A result an earlier
   * Turn left behind must not settle the current one.
   */
  readonly turnReportIds?: readonly string[];
}

/**
 * A node's durable normalized result: accepted, failed with a reason, or not available. Only an
 * `ACCEPTED` result counts as done; anything else, including a missing result, never does.
 */
export type TaskMonitorNodeResult =
  | { readonly outcome: 'ACCEPTED'; readonly reportId: string }
  | { readonly outcome: 'FAILED'; readonly reportId: string; readonly reason: string }
  | { readonly outcome: 'MISSING'; readonly reason: string };

export interface TaskMonitorNodeResultReaderDependencies {
  readonly apiBaseUrl: string;
  readonly fetchImpl: typeof fetch;
  readonly authContext: PlatformAuthContext;
  readonly logger: ServerLogger;
}

const listedReportSchema = z
  .object({ id: z.string().uuid(), reportType: z.string(), payload: z.unknown() })
  .passthrough();
const reportListSchema = z.object({ data: z.array(listedReportSchema) }).passthrough();

const nodeResultPayloadSchema = z
  .object({
    reportType: z.literal(MONITOR_NODE_RESULT),
    summary: z.string().min(1),
    nodeId: z.string().uuid(),
    outcome: z.nativeEnum(MonitorNodeResultOutcome),
    reason: z.string().min(1),
  })
  .strict() satisfies z.ZodType<MonitorNodeResultReportPayload>;

/**
 * Reads a node's normalized result: the newest MONITOR_NODE_RESULT report linked to the node's
 * Agent Session whose payload names that node. The same read serves direct acceptance,
 * dependency checks and restart, so they always agree. A malformed report never counts.
 */
export class TaskMonitorNodeResultReader {
  private readonly baseUrl: string;

  public constructor(private readonly dependencies: TaskMonitorNodeResultReaderDependencies) {
    this.baseUrl = dependencies.apiBaseUrl.replace(/\/$/u, '');
  }

  public async read(scope: TaskMonitorNodeResultScope): Promise<TaskMonitorNodeResult> {
    const reports = await this.listSessionResults(scope);
    const candidates =
      scope.turnReportIds === undefined
        ? reports
        : reports.filter((report) => scope.turnReportIds?.includes(report.id));

    for (const report of candidates) {
      const payload = nodeResultPayloadSchema.safeParse(report.payload);
      if (!payload.success) {
        this.dependencies.logger.error('task_monitor.kind.node_result.malformed', {
          projectId: scope.projectId,
          nodeId: scope.nodeId,
          agentSessionId: scope.agentSessionId,
          reportId: report.id,
          issues: payload.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
        });
        continue;
      }
      if (payload.data.nodeId !== scope.nodeId) {
        continue;
      }

      this.dependencies.logger.debug('task_monitor.kind.node_result.read', {
        nodeId: scope.nodeId,
        agentSessionId: scope.agentSessionId,
        reportId: report.id,
        outcome: payload.data.outcome,
      });
      return payload.data.outcome === MonitorNodeResultOutcome.Accepted
        ? { outcome: 'ACCEPTED', reportId: report.id }
        : { outcome: 'FAILED', reportId: report.id, reason: payload.data.reason };
    }

    this.dependencies.logger.warn('task_monitor.kind.node_result.missing', {
      projectId: scope.projectId,
      nodeId: scope.nodeId,
      agentSessionId: scope.agentSessionId,
      turnScoped: scope.turnReportIds !== undefined,
      candidateCount: candidates.length,
    });
    return {
      outcome: 'MISSING',
      reason:
        `No valid ${MONITOR_NODE_RESULT} report for node ${scope.nodeId} from session ` +
        `${scope.agentSessionId}${scope.turnReportIds === undefined ? '' : ' in the settled Turn'}.`,
    };
  }

  /** The session's node-result reports, newest first. */
  private async listSessionResults(scope: TaskMonitorNodeResultScope) {
    const query = new URLSearchParams({
      projectId: scope.projectId,
      reportType: MONITOR_NODE_RESULT,
      entityType: 'AGENT_SESSION',
      entityId: scope.agentSessionId,
      sortBy: 'createdAt',
      sortOrder: 'DESC',
      limit: '50',
    });
    const token = await this.dependencies.authContext.getAccessToken();
    const response = await this.dependencies.fetchImpl(
      `${this.baseUrl}/organizations/${encodeURIComponent(scope.organizationId)}/reports?${query.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
      this.dependencies.logger.error('task_monitor.kind.node_result.read_failed', {
        projectId: scope.projectId,
        agentSessionId: scope.agentSessionId,
        status: response.status,
      });
      throw new Error(`Node result read failed with status ${String(response.status)}.`);
    }
    return reportListSchema
      .parse(await response.json())
      .data.filter((report) => report.reportType === MONITOR_NODE_RESULT);
  }
}
