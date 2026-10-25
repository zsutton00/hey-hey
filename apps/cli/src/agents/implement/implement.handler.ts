import { CodingPlanVersionSchema } from '../../generated/coding-plan.schemas';
import { HINT_WRITE_MCP_TOOLS } from '../mcp-server-config';
import { reportChangedFilesTool } from '../submission-tools/report-changed-files-tool';
import {
  completionResponseHooks,
  changedFileReportingDuty,
} from '../completion-reconciliation/message-mapper';
/**
 * `implement` prompt-type handler.
 *
 * Dispatched by the CLI's workflow-defined prompt-type resolution when a
 * user message lands on a conversation whose coding session is active.
 * The handler's `prepare` step resolves the most recent PLAN report from the
 * conversation log (falling back to the legacy startup-plan UI element) and
 * packages it, along with service/session identifiers, onto the launch
 * payload. The turn runs on the Run-lifetime provider session: the first turn
 * mints it carrying the approved plan and ids, and consecutive user replies
 * resume that same session so context accumulates across the run rather than
 * restarting in a fresh window each time. A turn ends with a normal
 * task-complete assistant message; the conversation stays paused on its
 * trigger and the next user reply resumes.
 */

import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { LocalImplementPromptPayload } from '../../shared/agent-bridge-contract/runtime-types';
import { ExtendedUIFieldType, ReportAudience, ReportType } from '../../shared/api/generated/api';
import { renderStartupPlanMarkdown, type StartupPlanRenderable } from '../../agent-runtime/index';
import {
  defaultAddUserMessage,
  type PrepareResult,
  type PromptTypeHandlerDeps,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import type { AgenticSession } from '../../session/types';
import type {
  LocalWorktreeStateByService,
  ResolvedServiceBinding,
} from '../../shared/agent-bridge-contract/contract';
import type { LocalStartupSessionPlanResponse } from '../../shared/agent-bridge-contract/index';
import { parseStartupSessionPlanResponse } from '../response-schemas';
import { buildImplementPrompt, type EnrichedImplementPromptPayload } from './prompts';
import { taskIdFromHandlerContext, taskIdFromSession } from '../run-entity';
import { requestAgentSessionServiceScopeTool } from '../service-scope-request/service-scope-tool';

/**
 * Pull the most recent approved-plan body out of the conversation log.
 *
 * The platform stores the canonical structured plan as a PLAN report attached
 * to a conversation message. We walk every message in the tree (the API
 * returns nested `responses[]`), reverse by createdAt, and prefer the first
 * PLAN report payload. Older conversations may only have the retired
 * `coding_prompt_startup_plan` UI element, so that remains a fallback.
 *
 * No approval check: `implement` only dispatches once the workflow has
 * advanced past the coding-plan approval gate, so the most recent plan
 * body in the conversation is — by construction — the one the user
 * approved. Any approval-aware filter (parsing `nextAction`, walking the
 * subtree for an EXTERNAL_AGENT completion, etc.) would be brittle without
 * adding any safety the workflow doesn't already provide.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const collectMessagesDepthFirst = (
  messages: readonly unknown[],
  out: Record<string, unknown>[],
): void => {
  for (const message of messages) {
    if (!isRecord(message)) continue;
    out.push(message);
    const children = message['responses'];
    if (Array.isArray(children) && children.length > 0) {
      collectMessagesDepthFirst(children, out);
    }
  }
};

const findLatestApprovedPlan = (
  messages: readonly unknown[],
  logger: PromptTypeHandlerDeps['logger'],
  runId: string,
): LocalStartupSessionPlanResponse | null => {
  const flat: Record<string, unknown>[] = [];
  collectMessagesDepthFirst(messages, flat);
  flat.sort((a, b) => {
    const aCreatedAt = typeof a['createdAt'] === 'string' ? a['createdAt'] : '';
    const bCreatedAt = typeof b['createdAt'] === 'string' ? b['createdAt'] : '';
    return bCreatedAt.localeCompare(aCreatedAt);
  });

  for (const message of flat) {
    const reports = message['reports'];
    if (!Array.isArray(reports)) continue;
    for (const report of reports) {
      if (!isRecord(report) || report['reportType'] !== ReportType.Plan) continue;
      const payload = report['payload'];
      if (!isRecord(payload)) {
        logger.warn('implement.prepare.plan_report_invalid', {
          runId,
          reportId: report['id'],
          error: 'PLAN report payload is not an object',
        });
        return null;
      }
      const parsed = parseStartupSessionPlanResponse({
        ...payload,
        responseType: 'startup_plan_v1',
      });
      if (parsed.ok) return parsed.value;
      logger.warn('implement.prepare.plan_report_invalid', {
        runId,
        reportId: report['id'],
        error: parsed.error,
      });
      return null;
    }
  }

  for (const message of flat) {
    if (message['type'] !== 'SYSTEM') continue;
    const data = message['data'];
    if (!isRecord(data)) continue;
    const uiElements = data['uiElements'];
    if (!Array.isArray(uiElements)) continue;
    for (const element of uiElements) {
      if (!isRecord(element)) continue;
      if (element['type'] !== ExtendedUIFieldType.CodingPromptStartupPlan) continue;
      const parsed = parseStartupSessionPlanResponse(element['payload']);
      if (parsed.ok) return parsed.value;
      logger.warn('implement.prepare.legacy_plan_invalid', {
        runId,
        messageId: message['id'],
        error: parsed.error,
      });
      return null;
    }
  }
  return null;
};

const renderApprovedPlanMarkdown = (payload: LocalStartupSessionPlanResponse): string => {
  const plan: StartupPlanRenderable = {
    sessionTitle: payload.sessionTitle,
    executionPlan: payload.executionPlan,
    primaryImplementations: payload.primaryImplementations,
    discrepancies: payload.discrepancies,
    clarificationQuestions: payload.clarificationQuestions,
  };

  return renderStartupPlanMarkdown(plan);
};

export const readPreparedImplementRequiredServiceIds = (
  payload: unknown,
): readonly string[] | null => {
  if (!isRecord(payload)) return null;
  if (payload['approvedVersion'] !== undefined) {
    return CodingPlanVersionSchema.parse(payload['approvedVersion']).requiredServiceIds;
  }
  const parsed = parseStartupSessionPlanResponse(payload['_approvedPlanPayload']);
  return parsed.ok ? Array.from(parsed.value.requiredServiceIds) : null;
};

export const withPreparedImplementSessionScope = (
  payload: unknown,
  services: ResolvedServiceBinding[],
  launchServiceId: string,
  worktreeState?: LocalWorktreeStateByService,
): unknown => {
  if (!isRecord(payload)) return payload;
  return {
    ...payload,
    _services: services,
    _launchServiceId: launchServiceId,
    ...(worktreeState ? { _worktreeState: worktreeState } : {}),
  };
};

const fetchApprovedPlan = async (
  run: AgenticSession,
  deps: PromptTypeHandlerDeps,
): Promise<LocalStartupSessionPlanResponse | null> => {
  const { organizationId, projectId } = run.contextMetadata;
  const conversationId = run.conversationId;
  if (!organizationId || !projectId || !conversationId) return null;

  let accessToken: string;
  try {
    accessToken = await deps.auth.getAccessToken();
  } catch {
    deps.logger.warn('implement.prepare.auth_failed', {
      runId: run.agentic_session_id,
    });
    return null;
  }

  try {
    const query = new URLSearchParams({ projectId, conversationId, includeReports: 'true' });
    const path = `/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/messages?${query.toString()}`;
    const res = await deps.fetchImpl(`${deps.apiBaseUrl}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      deps.logger.warn('implement.prepare.messages_fetch_failed', {
        runId: run.agentic_session_id,
        status: res.status,
      });
      return null;
    }
    const body: unknown = await res.json();
    const messages = isRecord(body) && Array.isArray(body['data']) ? body['data'] : [];
    return findLatestApprovedPlan(messages, deps.logger, run.agentic_session_id);
  } catch (error) {
    deps.logger.warn('implement.prepare.messages_fetch_error', {
      runId: run.agentic_session_id,
      error,
    });
    return null;
  }
};

export const implementHandler: UserLaunchablePromptTypeHandler<LocalImplementPromptPayload> = {
  ...completionResponseHooks,
  ...changedFileReportingDuty,
  id: 'implement',
  promptType: LocalPromptType.Implement,
  service: 'required',
  launchEntity: 'none',
  implementationReadiness: 'gated',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [
    { reportType: ReportType.Implement, audience: ReportAudience.ProjectVisible, required: true },
  ],
  mcpToolUseCase: 'coding',
  additionalAllowedTools: HINT_WRITE_MCP_TOOLS,
  submissionTools: [reportChangedFilesTool, requestAgentSessionServiceScopeTool],

  async prepare(
    run: AgenticSession,
    payload: LocalImplementPromptPayload,
    deps: PromptTypeHandlerDeps,
  ): Promise<PrepareResult<LocalImplementPromptPayload>> {
    const approvedVersion = payload.approvedVersion
      ? CodingPlanVersionSchema.parse(payload.approvedVersion)
      : null;
    const approvedPlan = approvedVersion ? null : await fetchApprovedPlan(run, deps);
    const services = run.services ?? [];
    const launchServiceId = run.launchServiceId ?? undefined;
    const codingSessionId = run.contextMetadata?.agentSessionId ?? undefined;
    const agenticSessionId = run.agentic_session_id;
    const taskId = taskIdFromSession(run);

    deps.logger.info('implement.prepare.resolved', {
      runId: run.agentic_session_id,
      hasApprovedPlan: Boolean(approvedVersion || approvedPlan),
      versionMessageId: payload.versionMessageId,
      requiredServiceCount:
        approvedVersion?.requiredServiceIds.length ??
        (approvedPlan ? Array.from(approvedPlan.requiredServiceIds).length : 0),
      serviceCount: services.length,
      hasLaunchServiceId: Boolean(launchServiceId),
      hasCodingSessionId: Boolean(codingSessionId),
      hasTaskId: Boolean(taskId),
    });

    const enriched: EnrichedImplementPromptPayload = {
      ...payload,
      ...(approvedVersion
        ? {
            _approvedPlanMarkdown: approvedVersion.markdown,
            _approvedPlan: [
              approvedVersion.markdown,
              payload.planningDiscussion
                ? `## Supporting planning discussion\n${payload.planningDiscussion}`
                : '',
              payload.approvalFeedback ? `Approval feedback: ${payload.approvalFeedback}` : '',
            ]
              .filter(Boolean)
              .join('\n\n'),
          }
        : {}),
      ...(approvedPlan
        ? {
            _approvedPlan: renderApprovedPlanMarkdown(approvedPlan),
            _approvedPlanMarkdown: renderApprovedPlanMarkdown(approvedPlan),
            _approvedPlanPayload: approvedPlan,
          }
        : {}),
      ...(services.length > 0 ? { _services: services } : {}),
      ...(launchServiceId ? { _launchServiceId: launchServiceId } : {}),
      ...(run.worktreeState ? { _worktreeState: run.worktreeState } : {}),
      ...(codingSessionId ? { _codingSessionId: codingSessionId } : {}),
      _agenticSessionId: agenticSessionId,
    };

    return { payload: enriched };
  },

  buildPrompt(payload: LocalImplementPromptPayload, context): string {
    const enriched = payload as EnrichedImplementPromptPayload;
    return buildImplementPrompt({
      approvedPlan: enriched._approvedPlan ?? null,
      services: enriched._services ?? null,
      launchServiceId: enriched._launchServiceId ?? null,
      worktreeState: enriched._worktreeState ?? null,
      codingSessionId: enriched._codingSessionId ?? null,
      agenticSessionId: enriched._agenticSessionId ?? null,
      taskId: taskIdFromHandlerContext(context),
      ...(context?.startedPromptTypes ? { startedPromptTypes: context.startedPromptTypes } : {}),
    });
  },

  addUserMessage: defaultAddUserMessage,

  buildStartingMessage(): string | null {
    return 'Starting on the plan...';
  },
};
