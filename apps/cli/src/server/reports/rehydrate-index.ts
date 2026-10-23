import type { ServerLogger } from '../logger';
import { ReportType } from '../../shared/api/index';
import type { EntityReportIndex } from './entity-report-index';

export interface RehydrateReportIndexDeps {
  index: EntityReportIndex;
  organizationId: string;
  projectId: string;
  accessToken: string;
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  logger: ServerLogger;
}

interface ApiReportEntity {
  entityType: string;
  entityId: string;
  relation: string;
}

interface ApiReport {
  id: string;
  reportType: string;
  entities?: ApiReportEntity[];
}

const buildReportsUrl = (deps: RehydrateReportIndexDeps, params: URLSearchParams): string =>
  `${deps.apiBaseUrl}/organizations/${encodeURIComponent(deps.organizationId)}/reports?${params.toString()}`;

const fetchReports = async (
  deps: RehydrateReportIndexDeps,
  params: URLSearchParams,
  logContext: Record<string, unknown>,
): Promise<ApiReport[]> => {
  const response = await deps.fetchImpl(buildReportsUrl(deps, params), {
    method: 'GET',
    headers: { Authorization: `Bearer ${deps.accessToken}` },
  });
  if (!response.ok) {
    const body = await response.text();
    deps.logger.warn('report-update.rehydrate.list-failed', {
      ...logContext,
      status: response.status,
      body: body.slice(0, 500),
    });
    return [];
  }
  const json = (await response.json()) as { data?: unknown };
  const data = json.data;
  if (!Array.isArray(data)) return [];
  return data.filter((item): item is ApiReport => {
    return typeof item === 'object' && item !== null && typeof (item as ApiReport).id === 'string';
  });
};

const fetchLatestDailySession = async (
  deps: RehydrateReportIndexDeps,
): Promise<ApiReport | null> => {
  const params = new URLSearchParams({
    projectId: deps.projectId,
    reportType: ReportType.DailySession,
    sortBy: 'createdAt',
    sortOrder: 'DESC',
    limit: '1',
  });
  const reports = await fetchReports(deps, params, {
    stage: 'parent',
    reportType: ReportType.DailySession,
  });
  return reports[0] ?? null;
};

const fetchChildReports = async (
  deps: RehydrateReportIndexDeps,
  parentReportId: string,
): Promise<ApiReport[]> => {
  const params = new URLSearchParams({
    projectId: deps.projectId,
    parentReportId,
  });
  return fetchReports(deps, params, { stage: 'children', parentReportId });
};

/**
 * Rehydrate the entity-report index on CLI startup. Loads the most recent
 * DAILY_SESSION report and its children, then registers each child's entity
 * refs so incoming platform events start accumulating immediately. The parent
 * DAILY_SESSION report references only the run itself, so it's not indexed.
 */
export const rehydrateReportIndex = async (
  deps: RehydrateReportIndexDeps,
): Promise<{ reportCount: number; entityCount: number }> => {
  const parent = await fetchLatestDailySession(deps);
  if (!parent) {
    deps.logger.debug('report-update.rehydrate.no-parent', {
      projectId: deps.projectId,
    });
    return { reportCount: 0, entityCount: 0 };
  }

  const children = await fetchChildReports(deps, parent.id);
  let entityCount = 0;
  for (const report of children) {
    const entities = report.entities ?? [];
    const refs = entities.map((e) => ({
      entityType: e.entityType,
      entityId: e.entityId,
    }));
    deps.index.registerReport(report.id, refs);
    entityCount += refs.length;
  }

  deps.logger.debug('report-update.rehydrate.completed', {
    parentReportId: parent.id,
    reportCount: children.length,
    entityCount,
    projectId: deps.projectId,
  });

  return { reportCount: children.length, entityCount };
};
