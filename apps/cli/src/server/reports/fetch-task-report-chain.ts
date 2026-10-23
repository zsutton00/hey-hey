/**
 * Task-scoped report reader. Fetches every report attached to a task and
 * maps each `ReportDto` into a `ReportChainEntry` so the active Run can seed
 * its in-memory chain at construction. Mirrors the fetch + auth pattern used
 * by `rehydrate-index.ts`; see `Run`'s seed path for how the entries are
 * threaded onto the chain.
 *
 * `audience` is collapsed to `EXTERNAL`/`INTERNAL` the same way the
 * `create-phase-grounding-tool.ts` wrapper does — the chain entry does
 * not preserve project-vs-organization distinction.
 *
 * Seeded entries do not belong to any in-Run handler span, so their `phase`
 * is the sentinel `seeded` (display-only in the renderer).
 */

import type { ReportChainEntry } from '../../run/types';
import type { ReportType } from '../../shared/api/index';
import type { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { ServerLogger } from '../logger';

/** Sentinel phase value for entries seeded from a prior task scope. */
const SEEDED_PHASE = 'seeded' as LocalPromptType;

export interface FetchTaskReportChainDeps {
  organizationId: string;
  projectId: string;
  accessToken: string;
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  logger: ServerLogger;
}

interface ApiReport {
  id: string;
  reportType: string;
  audience?: string;
  createdAt: string;
  payload?: Record<string, unknown>;
}

const collapseAudience = (raw: unknown): 'EXTERNAL' | 'INTERNAL' =>
  raw === 'INTERNAL' ? 'INTERNAL' : 'EXTERNAL';

const readSummary = (payload: Record<string, unknown> | undefined): string => {
  if (!payload) return '';
  const summary = payload['summary'];
  return typeof summary === 'string' ? summary : '';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isApiReport = (value: unknown): value is ApiReport => {
  if (!isRecord(value)) return false;
  if (
    typeof value['id'] !== 'string' ||
    typeof value['reportType'] !== 'string' ||
    typeof value['createdAt'] !== 'string'
  ) {
    return false;
  }
  if (value['payload'] !== undefined && !isRecord(value['payload'])) return false;
  return true;
};

export const fetchTaskReportChain = async (
  deps: FetchTaskReportChainDeps,
  taskId: string,
): Promise<ReportChainEntry[]> => {
  const params = new URLSearchParams({
    entityType: 'TASK',
    entityId: taskId,
    projectId: deps.projectId,
    sortBy: 'createdAt',
    sortOrder: 'ASC',
  });
  const url = `${deps.apiBaseUrl}/organizations/${encodeURIComponent(deps.organizationId)}/reports?${params.toString()}`;

  const response = await deps.fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${deps.accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text();
    deps.logger.warn('report-chain.seed.list-failed', {
      taskId,
      status: response.status,
      body: body.slice(0, 500),
    });
    return [];
  }

  const json: unknown = await response.json();
  const data = isRecord(json) ? json['data'] : undefined;
  if (!Array.isArray(data)) return [];

  const reports = data.filter(isApiReport);
  return reports.map(
    (report): ReportChainEntry => ({
      createdAt: report.createdAt,
      phase: SEEDED_PHASE,
      reportId: report.id,
      reportType: report.reportType as ReportType,
      summary: readSummary(report.payload),
      audience: collapseAudience(report.audience),
    }),
  );
};
