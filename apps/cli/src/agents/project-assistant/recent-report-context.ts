import { z } from 'zod';

import type { AgenticSession } from '../../session/types';
import { RunEntityReferenceEntityTypeEnum } from '../../shared/agent-bridge-contract/generated/api';
import type { RunEntityReference } from '../../shared/agent-bridge-contract/generated/api';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';

export interface ProjectAssistantReportEntityRef {
  entityType: 'TASK';
  entityId: string;
}

interface ReportEntityRef {
  entityType: string;
  entityId: string;
}

export interface RecentProjectAssistantReportDeps {
  organizationId: string;
  projectId: string;
  accessToken: string;
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  logger: PromptTypeHandlerDeps['logger'];
  now?: () => Date;
  recentWindowMs?: number;
}

interface RecentProjectAssistantReport {
  id: string;
  createdAt: string;
  summary: string;
  analysis: string;
  frameText: string | null;
  provenanceText: string | null;
  updatesText: string | null;
  refs: ReportEntityRef[];
}

interface StaleContextEvidence {
  newerEntityActivity: number;
  newerEdgeActivity: number;
  unknownTimestamps: number;
}

const DEFAULT_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const REPORT_TYPE = 'CODING_RESEARCH';

const reportRefSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
});

const codingResearchUpdateSchema = z
  .object({
    type: z.enum(['add', 'remove', 'update']),
    targets: z.array(
      z
        .object({
          entityType: z.string().min(1),
          entityId: z.string().min(1),
          title: z.string().min(1),
        })
        .strict(),
    ),
    description: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

const codingResearchPayloadSchema = z
  .object({
    reportType: z.literal(REPORT_TYPE),
    summary: z.string().optional(),
    analysis: z.string().optional(),
    frame: z.unknown().optional(),
    provenance: z.unknown().optional(),
    updates: z.array(codingResearchUpdateSchema).optional(),
  })
  .passthrough();

const apiReportSchema = z.object({
  id: z.string().min(1),
  reportType: z.literal(REPORT_TYPE),
  createdAt: z.string().min(1),
  payload: codingResearchPayloadSchema,
  entities: z.array(reportRefSchema).optional(),
  linkedEntities: z.array(reportRefSchema).optional(),
});

const listReportsResponseSchema = z.object({
  data: z.array(apiReportSchema).optional(),
});

const proposalSchema = z.object({
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const contextResponseSchema = z.object({
  data: z
    .object({
      createdAt: z.string().optional(),
      proposals: z.array(proposalSchema).optional(),
    })
    .optional(),
});

const edgeSchema = z.object({
  id: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const listEdgesResponseSchema = z.object({
  content: z.array(edgeSchema).optional(),
});

const encode = (value: string): string => encodeURIComponent(value);

const uniqueRefs = <T extends ReportEntityRef>(refs: ReadonlyArray<T>): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const ref of refs) {
    const key = `${ref.entityType}:${ref.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
};

const parseDateMs = (value: string): number | null => {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

const stringifyPayloadPart = (
  value: z.infer<typeof codingResearchPayloadSchema>['frame'],
): string | null => {
  if (value === undefined) return null;
  return JSON.stringify(value, null, 2);
};

const getTimestampState = (
  value: string | undefined,
  reportCreatedMs: number,
): 'newer' | 'known-not-newer' | 'unknown' => {
  if (!value) return 'unknown';
  const ms = parseDateMs(value);
  if (ms === null) return 'unknown';
  return ms > reportCreatedMs ? 'newer' : 'known-not-newer';
};

const readJson = async (response: Response) => JSON.parse(await response.text());

const fetchReportsForRef = async (
  deps: RecentProjectAssistantReportDeps,
  ref: ProjectAssistantReportEntityRef,
): Promise<RecentProjectAssistantReport[]> => {
  const params = new URLSearchParams({
    projectId: deps.projectId,
    reportType: REPORT_TYPE,
    entityType: ref.entityType,
    entityId: ref.entityId,
    ragEnabled: 'true',
    sortBy: 'createdAt',
    sortOrder: 'DESC',
    limit: '10',
  });
  const url = `${deps.apiBaseUrl}/organizations/${encode(deps.organizationId)}/reports?${params.toString()}`;

  const response = await deps.fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${deps.accessToken}` },
  });
  if (!response.ok) {
    const body = await response.text();
    deps.logger.warn('project-assistant.recent-report.list-failed', {
      entityType: ref.entityType,
      entityId: ref.entityId,
      status: response.status,
      body: body.slice(0, 500),
    });
    return [];
  }

  const parsed = listReportsResponseSchema.safeParse(await readJson(response));
  if (!parsed.success) {
    deps.logger.warn('project-assistant.recent-report.list-invalid', {
      entityType: ref.entityType,
      entityId: ref.entityId,
      issues: parsed.error.issues.map((issue) => issue.message),
    });
    return [];
  }

  return (parsed.data.data ?? []).map((report) => {
    const refs = uniqueRefs([...(report.entities ?? []), ...(report.linkedEntities ?? [])]);
    return {
      id: report.id,
      createdAt: report.createdAt,
      summary: report.payload.summary ?? '',
      analysis: report.payload.analysis ?? '',
      frameText: stringifyPayloadPart(report.payload.frame),
      provenanceText: stringifyPayloadPart(report.payload.provenance),
      updatesText: stringifyPayloadPart(report.payload.updates),
      refs,
    };
  });
};

const fetchEntityContextEvidence = async (
  deps: RecentProjectAssistantReportDeps,
  ref: ReportEntityRef,
  reportCreatedMs: number,
): Promise<Pick<StaleContextEvidence, 'newerEntityActivity' | 'unknownTimestamps'>> => {
  const params = new URLSearchParams({
    includeRelatedEntities: 'false',
    includeFeatureHierarchy: 'false',
    includeProposals: 'true',
    includeAvailableMcpTools: 'false',
  });
  const url =
    `${deps.apiBaseUrl}/organizations/${encode(deps.organizationId)}` +
    `/projects/${encode(deps.projectId)}` +
    `/entities/${encode(ref.entityType)}/${encode(ref.entityId)}/context?${params.toString()}`;

  const response = await deps.fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${deps.accessToken}` },
  });
  if (!response.ok) {
    deps.logger.warn('project-assistant.recent-report.context-failed', {
      entityType: ref.entityType,
      entityId: ref.entityId,
      status: response.status,
    });
    return { newerEntityActivity: 0, unknownTimestamps: 1 };
  }

  const parsed = contextResponseSchema.safeParse(await readJson(response));
  if (!parsed.success || !parsed.data.data) {
    deps.logger.warn('project-assistant.recent-report.context-invalid', {
      entityType: ref.entityType,
      entityId: ref.entityId,
      issues: parsed.success ? [] : parsed.error.issues.map((issue) => issue.message),
    });
    return { newerEntityActivity: 0, unknownTimestamps: 1 };
  }

  let newerEntityActivity = 0;
  let unknownTimestamps = 0;
  const createdState = getTimestampState(parsed.data.data.createdAt, reportCreatedMs);
  if (createdState === 'newer') newerEntityActivity += 1;
  if (createdState === 'unknown') unknownTimestamps += 1;

  for (const proposal of parsed.data.data.proposals ?? []) {
    const states = [
      getTimestampState(proposal.createdAt, reportCreatedMs),
      getTimestampState(proposal.updatedAt, reportCreatedMs),
    ];
    if (states.includes('newer')) newerEntityActivity += 1;
    unknownTimestamps += states.filter((state) => state === 'unknown').length;
  }

  return { newerEntityActivity, unknownTimestamps };
};

const fetchEdgeEvidence = async (
  deps: RecentProjectAssistantReportDeps,
  ref: ReportEntityRef,
  direction: 'sourceNodeId' | 'targetNodeId',
  reportCreatedMs: number,
): Promise<Pick<StaleContextEvidence, 'newerEdgeActivity' | 'unknownTimestamps'>> => {
  const params = new URLSearchParams({
    [direction]: ref.entityId,
    size: '100',
  });
  const url =
    `${deps.apiBaseUrl}/organizations/${encode(deps.organizationId)}` +
    `/projects/${encode(deps.projectId)}/agent-edges?${params.toString()}`;
  const response = await deps.fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${deps.accessToken}` },
  });
  if (!response.ok) {
    deps.logger.warn('project-assistant.recent-report.edges-failed', {
      entityType: ref.entityType,
      entityId: ref.entityId,
      direction,
      status: response.status,
    });
    return { newerEdgeActivity: 0, unknownTimestamps: 1 };
  }

  const parsed = listEdgesResponseSchema.safeParse(await readJson(response));
  if (!parsed.success) {
    deps.logger.warn('project-assistant.recent-report.edges-invalid', {
      entityType: ref.entityType,
      entityId: ref.entityId,
      direction,
      issues: parsed.error.issues.map((issue) => issue.message),
    });
    return { newerEdgeActivity: 0, unknownTimestamps: 1 };
  }

  let newerEdgeActivity = 0;
  let unknownTimestamps = 0;
  for (const edge of parsed.data.content ?? []) {
    const states = [
      getTimestampState(edge.createdAt, reportCreatedMs),
      getTimestampState(edge.updatedAt, reportCreatedMs),
    ];
    if (states.includes('newer')) newerEdgeActivity += 1;
    unknownTimestamps += states.filter((state) => state === 'unknown').length;
  }
  return { newerEdgeActivity, unknownTimestamps };
};

const inspectStaleContextEvidence = async (
  deps: RecentProjectAssistantReportDeps,
  report: RecentProjectAssistantReport,
): Promise<StaleContextEvidence> => {
  const reportCreatedMs = parseDateMs(report.createdAt);
  if (reportCreatedMs === null) {
    return { newerEntityActivity: 0, newerEdgeActivity: 0, unknownTimestamps: 1 };
  }

  const evidence: StaleContextEvidence = {
    newerEntityActivity: 0,
    newerEdgeActivity: 0,
    unknownTimestamps: 0,
  };
  for (const ref of report.refs) {
    const entityEvidence = await fetchEntityContextEvidence(deps, ref, reportCreatedMs);
    evidence.newerEntityActivity += entityEvidence.newerEntityActivity;
    evidence.unknownTimestamps += entityEvidence.unknownTimestamps;

    for (const direction of ['sourceNodeId', 'targetNodeId'] as const) {
      const edgeEvidence = await fetchEdgeEvidence(deps, ref, direction, reportCreatedMs);
      evidence.newerEdgeActivity += edgeEvidence.newerEdgeActivity;
      evidence.unknownTimestamps += edgeEvidence.unknownTimestamps;
    }
  }
  return evidence;
};

const formatRelativeAge = (createdAt: string, now: Date): string => {
  const createdMs = parseDateMs(createdAt);
  if (createdMs === null) return 'created at an unknown time';
  const elapsedMs = Math.max(0, now.getTime() - createdMs);
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return 'created less than 1 minute ago';
  if (minutes < 60) return `created ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `created ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `created ${days} ${days === 1 ? 'day' : 'days'} ago`;
};

const renderStaleEvidence = (evidence: StaleContextEvidence): string => {
  if (evidence.newerEntityActivity > 0 || evidence.newerEdgeActivity > 0) {
    return [
      `Advisory stale-context check found ${evidence.newerEntityActivity} linked-entity timestamp(s) and ${evidence.newerEdgeActivity} direct graph-edge timestamp(s) newer than the report.`,
      'Treat the report as possibly stale and validate against current context before relying on it.',
    ].join(' ');
  }
  if (evidence.unknownTimestamps > 0) {
    return [
      `Advisory stale-context check found no newer timestamped activity, but ${evidence.unknownTimestamps} timestamp(s) were missing or unavailable.`,
      'Treat the report as possibly stale and validate against current context before relying on it.',
    ].join(' ');
  }
  return 'Advisory stale-context check found no newer linked-entity or direct graph-edge timestamps. This does not prove the report is fresh; validate against current context before relying on it.';
};

const renderReportContext = (
  report: RecentProjectAssistantReport,
  evidence: StaleContextEvidence,
  now: Date,
): string => {
  const sections = [
    '## Recent Project Assistant report',
    '',
    `A prior Project Assistant report is available (${formatRelativeAge(report.createdAt, now)}). It is prior research, not guaranteed-current state; project state may have changed since it was created.`,
    '',
    renderStaleEvidence(evidence),
  ];
  if (report.summary.trim()) {
    sections.push('', '### Summary', '', report.summary.trim());
  }
  if (report.analysis.trim()) {
    sections.push('', '### Analysis', '', report.analysis.trim());
  }
  if (report.frameText) {
    sections.push('', '### Research frame', '', '```json', report.frameText, '```');
  }
  if (report.provenanceText) {
    sections.push('', '### Provenance', '', '```json', report.provenanceText, '```');
  }
  if (report.updatesText) {
    sections.push('', '### Reconciliation updates', '', '```json', report.updatesText, '```');
  }
  return sections.join('\n');
};

export const fetchRecentProjectAssistantReportContext = async (
  deps: RecentProjectAssistantReportDeps,
  refs: ReadonlyArray<ProjectAssistantReportEntityRef>,
): Promise<string | null> => {
  const lookupRefs = uniqueRefs(refs);
  if (lookupRefs.length === 0) return null;

  const now = deps.now?.() ?? new Date();
  const windowMs = deps.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS;
  const minCreatedMs = now.getTime() - windowMs;
  const byId = new Map<string, RecentProjectAssistantReport>();

  for (const ref of lookupRefs) {
    const reports = await fetchReportsForRef(deps, ref);
    for (const report of reports) {
      const createdMs = parseDateMs(report.createdAt);
      if (createdMs === null || createdMs < minCreatedMs || createdMs > now.getTime()) continue;
      const existing = byId.get(report.id);
      if (!existing || report.refs.length > existing.refs.length) {
        byId.set(report.id, report);
      }
    }
  }

  const candidates = [...byId.values()].sort((a, b) => {
    const bMs = parseDateMs(b.createdAt) ?? 0;
    const aMs = parseDateMs(a.createdAt) ?? 0;
    return bMs - aMs;
  });
  const report = candidates[0];
  if (!report) return null;

  const evidence = await inspectStaleContextEvidence(deps, report);
  deps.logger.info('project-assistant.recent-report.selected', {
    reportId: report.id,
    reportCreatedAt: report.createdAt,
    linkedRefCount: report.refs.length,
    newerEntityActivity: evidence.newerEntityActivity,
    newerEdgeActivity: evidence.newerEdgeActivity,
    unknownTimestamps: evidence.unknownTimestamps,
  });
  return renderReportContext(report, evidence, now);
};

const resolveProjectAssistantReportLookupRefs = (
  run: AgenticSession,
  focalEntity: RunEntityReference | undefined,
): ProjectAssistantReportEntityRef[] => {
  const refs: ProjectAssistantReportEntityRef[] = [];
  if (focalEntity?.entityType === RunEntityReferenceEntityTypeEnum.Task) {
    refs.push({ entityType: 'TASK', entityId: focalEntity.entityId });
  }
  const launchPlanId = run.contextMetadata?.launchPlanId;
  if (typeof launchPlanId === 'string' && launchPlanId.length > 0) {
    refs.push({ entityType: 'TASK', entityId: launchPlanId });
  }
  return uniqueRefs(refs);
};

export const prepareRecentProjectAssistantReportContext = async (
  run: AgenticSession,
  focalEntity: RunEntityReference | undefined,
  deps: PromptTypeHandlerDeps,
): Promise<string | null> => {
  const { organizationId, projectId } = run.contextMetadata ?? {};
  const refs = resolveProjectAssistantReportLookupRefs(run, focalEntity);
  const capturedAt = run.contextMetadata?.capturedAt;
  const capturedAtMs = typeof capturedAt === 'string' ? Date.parse(capturedAt) : NaN;
  const now = Number.isFinite(capturedAtMs) ? new Date(capturedAtMs) : undefined;
  if (!organizationId || !projectId || refs.length === 0) {
    deps.logger.debug('project_assistant.prepare.recent_report.skipped', {
      runId: run.agentic_session_id,
      hasOrganizationId: !!organizationId,
      hasProjectId: !!projectId,
      lookupRefCount: refs.length,
    });
    return null;
  }

  let accessToken: string;
  try {
    accessToken = await deps.auth.getAccessToken();
  } catch (error) {
    deps.logger.warn('project_assistant.prepare.recent_report.auth_failed', {
      runId: run.agentic_session_id,
      lookupRefCount: refs.length,
      error,
    });
    return null;
  }

  try {
    const context = await fetchRecentProjectAssistantReportContext(
      {
        organizationId,
        projectId,
        accessToken,
        apiBaseUrl: deps.apiBaseUrl,
        fetchImpl: deps.fetchImpl,
        logger: deps.logger,
        ...(now ? { now: () => now } : {}),
      },
      refs,
    );
    deps.logger.info('project_assistant.prepare.recent_report.loaded', {
      runId: run.agentic_session_id,
      lookupRefCount: refs.length,
      found: context !== null,
    });
    return context;
  } catch (error) {
    deps.logger.warn('project_assistant.prepare.recent_report.failed', {
      runId: run.agentic_session_id,
      lookupRefCount: refs.length,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};
