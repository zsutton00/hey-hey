import {
  parseChangeWalkthroughPayload,
  verifyChangeWalkthrough,
} from '../review-subagent/change-walkthrough-sources';
/**
 * Universal `create_report` pass-through submission tool.
 *
 * Registered on every Run at creation time (not per-handler) so every agent,
 * regardless of its handler, routes its report through `createReportProxy`.
 * This closes the gap where the platform `mcp__heyhey-platform__create_report`
 * tool was directly reachable, bypassing the report-emission lifecycle channel
 * and leaving the monitor pipeline blind to those reports. The proxy persists
 * via the platform REST report endpoint, then returns MCP content for the local
 * submission-tool transport.
 *
 * The proxy already publishes the lifecycle event after persisting the report.
 * This wrapper does not publish it again — it only appends the chain entry and
 * forwards the platform's response content to the agent.
 */

import path from 'node:path';
import { NOOP_LOGGER, type ServerLogger } from '../../server/logger';

import { ReportAudience, ReportRelatedEntityType, ReportType } from '../../shared/api/index';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import {
  isCreateReportPersistedFailure,
  type CreateReportProxy,
  type CreateReportProxyResult,
} from './create-report-proxy';
import {
  parseProjectReportPreparedEvidence,
  stampProjectReportCoverage,
} from '../project-report/project-report-submission';
import type { PassThroughSubmissionToolDeclaration, SubmissionToolExecuteContext } from './types';
import { groupFileChangeProjectionsByService } from '../../run/file-change-facts';
import type { Run } from '../../run/run';
import type { ReportChainEntry } from '../../run/types';
import { parseFeatureSyncDecisionReport } from './feature-sync-decision/schemas';

export const CREATE_REPORT_TOOL_NAME = 'create_report';

const CREATE_REPORT_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schemaVersion: {
      type: 'integer',
      minimum: 1,
      description:
        'Report envelope schema version. Omitted means legacy version 1; grouped Feature Sync decisions require 2.',
    },
    reportType: {
      type: 'string',
      description: 'Discriminator selecting which report payload variant to persist.',
    },
    audience: {
      type: 'string',
      enum: ['WORKFLOW_ONLY', 'PROJECT_VISIBLE', 'ORGANIZATION_VISIBLE'],
      description: 'Who the report is intended for.',
    },
    payload: {
      type: 'object',
      additionalProperties: true,
      description:
        'The full report payload. Must satisfy the JSON Schema returned by get_report_schema for this reportType.',
    },
    entities: {
      type: 'array',
      description: 'Entities this report references.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entityType: { type: 'string', enum: Object.values(ReportRelatedEntityType) },
          entityId: { type: 'string', format: 'uuid' },
          relation: { type: 'string', enum: ['PRIMARY', 'CONTEXT'] },
        },
        required: ['entityType', 'entityId'],
      },
    },
    linkedEntities: {
      type: 'array',
      description: 'Optional list of entities mentioned inline in the report body.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entityType: { type: 'string', enum: Object.values(ReportRelatedEntityType) },
          entityId: { type: 'string', format: 'uuid' },
        },
        required: ['entityType', 'entityId'],
      },
    },
    parentReportId: {
      type: 'string',
      format: 'uuid',
      description: 'Optional parent report ID for hierarchical grouping.',
    },
    agent: {
      type: 'string',
      description:
        'Optional report-level agent identity. The run-aware CLI wrapper stamps this from the active run/session when available.',
    },
  },
  required: ['reportType', 'audience', 'payload'],
} as const;

interface ImplementReportPartition {
  args: Record<string, unknown>;
  serviceId?: string;
  filesChanged: string[];
}

interface ImplementReportValidationResult {
  status: 'valid' | 'skipped' | 'failed';
  partitions: ImplementReportPartition[];
  reason?: string;
}

const skippedContent = (reason: string, filesChanged: readonly string[]) => [
  {
    type: 'text',
    text: JSON.stringify({
      status: 'skipped',
      reason,
      filesChanged,
    }),
  },
];

const readPayload = (args: Record<string, unknown>): Record<string, unknown> | null => {
  const payload = args['payload'];
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
};

const readObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readFilesChanged = (payload: Record<string, unknown>): string[] =>
  Array.isArray(payload['filesChanged'])
    ? payload['filesChanged'].filter((value): value is string => typeof value === 'string')
    : [];

const readServiceEntityId = (args: Record<string, unknown>): string | null => {
  const entities = args['entities'];
  if (!Array.isArray(entities)) return null;
  for (const entity of entities) {
    if (typeof entity !== 'object' || entity === null || Array.isArray(entity)) continue;
    const record = entity as Record<string, unknown>;
    if (record['entityType'] === 'SERVICE' && typeof record['entityId'] === 'string') {
      return record['entityId'];
    }
  }
  return null;
};

const withServiceEntity = (
  args: Record<string, unknown>,
  serviceId: string,
): Record<string, unknown> => {
  const entities = args['entities'];
  if (!Array.isArray(entities)) {
    return {
      ...args,
      entities: [{ entityType: 'SERVICE', entityId: serviceId, relation: 'CONTEXT' }],
    };
  }
  if (readServiceEntityId(args) !== null) return args;
  return {
    ...args,
    entities: [...entities, { entityType: 'SERVICE', entityId: serviceId, relation: 'CONTEXT' }],
  };
};

const readRunAgent = (run: Run): string | null => {
  const session = run.session as { provider_session_id?: unknown };
  if (typeof session.provider_session_id !== 'string') return null;
  const agent = session.provider_session_id.trim();
  if (agent.length === 0 || agent.startsWith('pending_')) return null;
  return agent;
};

const withRunAgent = (args: Record<string, unknown>, run: Run): Record<string, unknown> => {
  const agent = readRunAgent(run);
  const rest = { ...args };
  delete rest['agent'];
  if (agent === null) return rest;
  return {
    ...rest,
    agent,
  };
};

const validateImplementReportArgs = (
  ctx: SubmissionToolExecuteContext & { run: Run },
): ImplementReportValidationResult => {
  if (ctx.args['reportType'] !== ReportType.Implement) {
    return { status: 'valid', partitions: [{ args: ctx.args, filesChanged: [] }] };
  }

  const payload = readPayload(ctx.args);
  if (payload === null) {
    ctx.run.logImplementReportValidation('local.run.create_report.implement.rejected_payload', {
      reason: 'missing-payload',
    });
    return { status: 'skipped', partitions: [], reason: 'missing-payload' };
  }

  const requestedFiles = readFilesChanged(payload);
  if (requestedFiles.length === 0) {
    ctx.run.logImplementReportValidation('local.run.create_report.implement.rejected_files', {
      reason: 'no-files-changed',
    });
    return { status: 'skipped', partitions: [], reason: 'no-files-changed' };
  }

  const serviceReports = groupFileChangeProjectionsByService(ctx.run.getFileChangeProjection());
  if (serviceReports.length === 0) {
    ctx.run.logImplementReportValidation('local.run.create_report.implement.rejected_files', {
      reason: 'no-canonical-facts',
      requestedFiles,
    });
    return {
      status: 'skipped',
      partitions: [],
      reason: 'no-canonical-facts',
    };
  }

  const serviceId = readServiceEntityId(ctx.args);
  const candidateReports =
    serviceId === null
      ? serviceReports
      : serviceReports.filter((entry) => entry.serviceId === serviceId);
  if (serviceId !== null && candidateReports.length === 0) {
    ctx.run.logImplementReportValidation('local.run.create_report.implement.rejected_service', {
      reason: 'unknown-service-context',
      serviceId,
      candidateServiceIds: serviceReports.map((entry) => entry.serviceId),
      requestedFiles,
    });
    return {
      status: 'failed',
      partitions: [],
      reason: 'unknown-service-context',
    };
  }

  const validRequestedFiles = requestedFiles
    .map((requestedFile) => ({ original: requestedFile, trimmed: requestedFile.trim() }))
    .filter(
      ({ trimmed }) =>
        trimmed.length > 0 && !path.isAbsolute(trimmed) && !path.posix.isAbsolute(trimmed),
    );
  const partitions = candidateReports.flatMap<ImplementReportPartition>((serviceReport) => {
    const canonicalFiles = new Set(serviceReport.filesChanged);
    const filesChanged = [
      ...new Set(
        validRequestedFiles
          .map(({ trimmed }) => trimmed)
          .filter((requestedFile) => canonicalFiles.has(requestedFile)),
      ),
    ].sort();
    if (filesChanged.length === 0) return [];
    return [
      {
        args: withServiceEntity(
          { ...ctx.args, payload: { ...payload, filesChanged } },
          serviceReport.serviceId,
        ),
        serviceId: serviceReport.serviceId,
        filesChanged,
      },
    ];
  });

  const acceptedRequestedFiles = new Set(partitions.flatMap((partition) => partition.filesChanged));
  const rejectedFiles = requestedFiles.filter(
    (requestedFile) => !acceptedRequestedFiles.has(requestedFile.trim()),
  );

  if (rejectedFiles.length > 0) {
    ctx.run.logImplementReportValidation('local.run.create_report.implement.rejected_files', {
      reason: 'files-not-in-canonical-facts',
      ...(serviceId !== null ? { serviceId } : {}),
      rejectedFiles,
      acceptedFiles: [...acceptedRequestedFiles].sort(),
    });
  }

  if (partitions.length === 0) {
    return {
      status: 'skipped',
      partitions: [],
      reason: 'no-canonical-files-after-validation',
    };
  }

  return { status: 'valid', partitions };
};

export class CreateReportTool implements PassThroughSubmissionToolDeclaration {
  public readonly kind = 'pass_through' as const;
  public readonly name = CREATE_REPORT_TOOL_NAME;
  public readonly description =
    'Persist a report to the platform and register it in the run report chain. ' +
    'Accepts the same arguments as the platform create_report tool. Follow the generated payload ' +
    'contract in the active prompt; call get_report_schema first when that reportType is available there.';
  public readonly inputSchema = CREATE_REPORT_INPUT_SCHEMA as unknown as Record<string, unknown>;
  private readonly now: () => string;
  private readonly projectReportSubmissionRuns = new WeakSet<Run>();

  public constructor(
    private readonly proxy: CreateReportProxy,
    now: () => string = () => new Date().toISOString(),
    private readonly logger: ServerLogger = NOOP_LOGGER,
  ) {
    this.now = now;
  }

  public readonly execute = async (ctx: SubmissionToolExecuteContext) => {
    const run = ctx.run;
    if (!run) {
      throw new Error('create_report wrapper: ctx.run is required for pass-through tools');
    }

    const phase = run.session.promptType as LocalPromptType | undefined;
    if (!phase) {
      throw new Error(
        'create_report wrapper: run.session.promptType is required to derive chain entry phase',
      );
    }

    // release_notes submits the same PROJECT_REPORT payload under the same
    // request-bound, host-coverage rules as project_report.
    const isProjectReportRun =
      phase === LocalPromptType.ProjectReport || phase === LocalPromptType.ReleaseNotes;
    let args = ctx.args;
    if (isProjectReportRun) {
      const payload = readPayload(ctx.args);
      const scope = readObject(payload?.['scope']);
      const provenance = readObject(payload?.['provenance']);
      const config = run.session.config?.type === 'PROJECT_REPORT' ? run.session.config : null;
      const reportTypeMatches = ctx.args['reportType'] === ReportType.ProjectReport;
      const audienceMatches = ctx.args['audience'] === ReportAudience.ProjectVisible;
      const payloadTypeMatches = payload?.['reportType'] === ReportType.ProjectReport;
      const requestIdMatches = config !== null && provenance?.['requestId'] === config.requestId;
      const attemptIdMatches = config !== null && provenance?.['attemptId'] === config.attemptId;
      const projectIdMatches =
        scope?.['projectId'] === run.projectId &&
        scope['projectId'] === run.session.contextMetadata?.projectId;
      if (
        payload === null ||
        provenance === null ||
        config === null ||
        !reportTypeMatches ||
        !audienceMatches ||
        !payloadTypeMatches ||
        !requestIdMatches ||
        !attemptIdMatches ||
        !projectIdMatches
      ) {
        this.logger.error('local.run.create_report.project_report.invalid_submission', {
          runId: ctx.runId,
          agentSessionId: run.session.agentic_session_id,
          reportTypeMatches,
          audienceMatches,
          payloadTypeMatches,
          requestIdMatches,
          attemptIdMatches,
          projectIdMatches,
        });
        throw new Error(
          'project_report create_report requires a PROJECT_REPORT payload bound to this request, attempt, and project',
        );
      }

      const prepared = parseProjectReportPreparedEvidence(run.session.sessionContext);
      if (prepared.requestId !== config.requestId || prepared.attemptId !== config.attemptId) {
        throw new Error(
          'project_report prepared evidence does not belong to this AgentSession request attempt',
        );
      }
      const stamped = stampProjectReportCoverage(payload, provenance, prepared);
      if (!stamped.ok) {
        this.logger.warn('local.run.create_report.project_report.coverage_rejected', {
          runId: ctx.runId,
          agentSessionId: run.session.agentic_session_id,
        });
        throw new Error(stamped.error);
      }
      args = { ...ctx.args, payload: stamped.payload };
    }

    if (args['reportType'] === ReportType.ChangeWalkthrough) {
      if (run.activeTurn?.handler.promptType !== 'code_review') {
        throw new Error('CHANGE_WALKTHROUGH requires an active Review');
      }
      const payload = parseChangeWalkthroughPayload(args['payload']);
      args = { ...args, payload: await verifyChangeWalkthrough(payload, run.session, this.now()) };
      this.logger.debug('local.review.walkthrough.sources_checked', { runId: run.runId });
    }

    const decision = parseFeatureSyncDecisionReport(args);
    if (!decision.ok) {
      throw new Error(`Invalid FEATURE_SYNC_DECISION report: ${decision.error}`);
    }

    const validation = validateImplementReportArgs({ ...ctx, args, run });
    if (validation.status === 'skipped') {
      return {
        content: skippedContent(validation.reason ?? 'implement-report-not-persisted', []),
      };
    }
    if (validation.status === 'failed') {
      throw new Error(
        `create_report IMPLEMENT failed: ${validation.reason ?? 'unresolved-service-context'}`,
      );
    }

    if (isProjectReportRun) {
      if (this.projectReportSubmissionRuns.has(run)) {
        this.logger.error('local.run.create_report.project_report.duplicate_submission', {
          runId: ctx.runId,
          agentSessionId: run.session.agentic_session_id,
        });
        throw new Error(
          'project_report permits one create_report submission per AgentSession attempt',
        );
      }
      // One AgentSession is one durable request attempt. Claim the write before
      // crossing the platform boundary so concurrent tool calls cannot persist
      // more than one report for the same attempt. The claim is released when
      // the platform did not confirm persistence; see `create` below.
      this.projectReportSubmissionRuns.add(run);
      this.logger.debug('local.run.create_report.project_report.submission_claimed', {
        runId: ctx.runId,
        agentSessionId: run.session.agentic_session_id,
      });
    }

    let content: Awaited<ReturnType<CreateReportProxy['create']>>['content'] | null = null;
    for (const partition of validation.partitions) {
      // Diagnose declaration drift without logging plan prose or tool payloads.
      const rawRequiredIds = readPayload(partition.args)?.['requiredServiceIds'];
      const requiredServiceIds = Array.isArray(rawRequiredIds)
        ? rawRequiredIds.filter((value): value is string => typeof value === 'string')
        : null;
      const planScope = {
        runId: ctx.runId,
        turnId: run.activeTurn?.turnId ?? null,
        conversationId: run.conversationId,
        projectId: run.projectId,
        phase,
        launchServiceId: run.session.launchServiceId ?? null,
        selectedServiceIds: (run.session.services ?? []).map((service) => service.id),
        requiredServiceIds,
        requiredServiceIdsIsArray: Array.isArray(rawRequiredIds),
        requiredServiceIdsEntryCount: Array.isArray(rawRequiredIds) ? rawRequiredIds.length : null,
        outsideRunServiceIds:
          requiredServiceIds?.filter(
            (id) => !run.session.services?.some((service) => service.id === id),
          ) ?? [],
      };
      if (partition.args['reportType'] === ReportType.Plan) {
        this.logger.debug('coding_plan.report.scope_submitted', planScope);
      }
      const result = await this.create(ctx.runId, run, partition.args, isProjectReportRun);
      if (partition.args['reportType'] === ReportType.Plan) {
        this.logger.debug('coding_plan.report.scope_persisted', {
          ...planScope,
          reportId: result.reportId,
        });
      }
      const reportType = partition.args['reportType'];
      const audienceRaw = partition.args['audience'];
      const payload = partition.args['payload'];
      const audience: 'EXTERNAL' | 'INTERNAL' =
        audienceRaw === 'WORKFLOW_ONLY' ? 'INTERNAL' : 'EXTERNAL';
      const summary =
        typeof payload === 'object' && payload !== null && 'summary' in payload
          ? String((payload as Record<string, unknown>)['summary'] ?? '')
          : '';

      run.appendReportChainEntry({
        createdAt: this.now(),
        phase,
        reportId: result.reportId,
        reportType: reportType as ReportType,
        summary,
        audience,
        ...(partition.serviceId !== undefined ? { serviceId: partition.serviceId } : {}),
      });
      if (reportType === ReportType.Plan) run.observePersistedPlanReady(result.reportId);
      content = content === null ? result.content : [...content, ...result.content];
    }

    return { content: content ?? [] };
  };

  private async create(
    runId: string,
    run: Run,
    args: Record<string, unknown>,
    isProjectReportRun: boolean,
  ): Promise<CreateReportProxyResult> {
    try {
      return await this.proxy.create({
        runId,
        args: withRunAgent(args, run),
        conversationId: run.conversationId,
        projectId: run.projectId,
      });
    } catch (error) {
      // Completed-attempt conflicts return the existing report as success.
      // Release the claim unless the platform confirmed persistence.
      // A retry after an ambiguous failure (5xx, dropped connection) cannot
      // persist a second report: the platform locks the request row and only
      // accepts a report for a RUNNING attempt with no report id.
      if (isProjectReportRun && !isCreateReportPersistedFailure(error)) {
        this.projectReportSubmissionRuns.delete(run);
        this.logger.warn('local.run.create_report.project_report.submission_released', {
          runId,
          agentSessionId: run.session.agentic_session_id,
          error: error instanceof Error ? error.message : 'Unknown create_report failure',
        });
      }
      throw error;
    }
  }
}
