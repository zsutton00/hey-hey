import type { LocalCodeReviewPromptPayload } from '../../shared/agent-bridge-contract/index';
import { ReportAudience, ReportType } from '../../shared/api/index';
import type {
  LocalWorktreeStateByService,
  ResolvedServiceBinding,
} from '../../shared/agent-bridge-contract/contract';
import type {
  PromptTypeHandlerContext,
  RecentUserReply,
  UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import { buildReviewPrompt } from '../prompts/review';
import { buildStartingMessage as buildStartingMessageForPromptType } from '../prompts/starting-message';
import {
  ReviewIntegrationContextResolver,
  type ReviewIntegrationContext,
} from './review-integration-context';

type EnrichedCodeReviewPromptPayload = LocalCodeReviewPromptPayload & {
  _recentUserReplies?: ReadonlyArray<RecentUserReply>;
  _services?: ResolvedServiceBinding[];
  _launchServiceId?: string;
  _worktreeState?: LocalWorktreeStateByService;
  _touchedFiles?: readonly string[];
  _integrationContext?: ReviewIntegrationContext;
};

/**
 * Restricted MCP tool allowlist for the review subagent. The subagent may
 * ground its findings in project state (search + context tools) but must
 * never mutate project data — no create/edit/proposal tools are included.
 * Filesystem + shell access is handled separately via the built-in tools
 * allowlist below.
 */
export const REVIEW_SUBAGENT_MCP_ALLOWED_TOOLS: readonly string[] = [
  // Context / read
  'get_context',
  'get_full_entity',
  'get_agent_sessions',
  'get_report_body',
  'get_report_schema',
  'list_services',
  // Search
  'unified_search',
  'task_search',
  'plan_search',
  'search_features',
  'search_design_docs',
  'search_implementation_hints',
];

/** Inspection and checks run inside the provider's read-only filesystem boundary. */
const REVIEW_SUBAGENT_BUILTIN_ALLOWED_TOOLS: readonly string[] = [
  'Read',
  'Bash',
  'Glob',
  'Grep',
];

/**
 * Review subagent's user-message block has its own heading ("## User Focus")
 * baked into the system prompt's body via `buildReviewPrompt`, so the
 * handler's `addUserMessage` always returns null — there is no separate
 * append step.
 */
const reviewAddUserMessage = (): string | null => null;

export const reviewHandler: UserLaunchablePromptTypeHandler<LocalCodeReviewPromptPayload> = {
  id: 'code_review',
  promptType: 'code_review',
  service: 'required',
  launchEntity: 'none',
  implementationReadiness: 'gated',
  allowsEmptyUserMessage: true,
  runnerKind: 'subagent',
  readOnlyFilesystem: true,
  providerSessionCountsForContext: false,
  reports: [
    {
      reportType: ReportType.ChangeWalkthrough,
      audience: ReportAudience.ProjectVisible,
      required: true,
    },
    { reportType: ReportType.Review, audience: ReportAudience.ProjectVisible, required: false },
  ],
  submissionTools: [],
  subagentConfig: {
    mcpAllowedTools: REVIEW_SUBAGENT_MCP_ALLOWED_TOOLS,
    builtinAllowedTools: REVIEW_SUBAGENT_BUILTIN_ALLOWED_TOOLS,
    adapterId: 'review-subagent',
  },

  async prepare(run, payload, deps, ctx?: PromptTypeHandlerContext) {
    const services = run.services ?? [];
    const recentUserReplies = ctx?.recentUserReplies ?? [];
    const integrationContext = await new ReviewIntegrationContextResolver({
      auth: deps.auth,
      apiBaseUrl: deps.apiBaseUrl,
      logger: deps.logger,
    }).resolve(run);
    const enriched: EnrichedCodeReviewPromptPayload = {
      ...payload,
      _recentUserReplies: recentUserReplies,
      ...(services.length > 0 ? { _services: services } : {}),
      ...(run.launchServiceId ? { _launchServiceId: run.launchServiceId } : {}),
      ...(run.worktreeState ? { _worktreeState: run.worktreeState } : {}),
      ...(integrationContext ? { _integrationContext: integrationContext } : {}),
    };
    deps.logger.debug('local.review.prepare.session_scoped', {
      runId: run.agentic_session_id,
      hasFocusMessage: payload.userMessage !== undefined,
      recentUserReplyCount: recentUserReplies.length,
      serviceCount: services.length,
      hasLaunchServiceId: Boolean(run.launchServiceId),
      worktreeServiceCount: Object.keys(run.worktreeState ?? {}).length,
      integrationTrigger: integrationContext?.trigger ?? null,
    });
    return { payload: enriched };
  },

  buildPrompt(payload: LocalCodeReviewPromptPayload): string {
    const enriched = payload as EnrichedCodeReviewPromptPayload;
    return buildReviewPrompt({
      touchedFiles: enriched._touchedFiles ?? [],
      services: enriched._services,
      launchServiceId: enriched._launchServiceId,
      worktreeState: enriched._worktreeState,
      recentUserReplies: enriched._recentUserReplies ?? [],
      ...(enriched._integrationContext ? { integrationContext: enriched._integrationContext } : {}),
      ...(payload.userMessage !== undefined ? { userMessage: payload.userMessage } : {}),
    });
  },

  addUserMessage: reviewAddUserMessage,

  buildStartingMessage(payload: LocalCodeReviewPromptPayload): string | null {
    return buildStartingMessageForPromptType('code_review', payload);
  },
};
