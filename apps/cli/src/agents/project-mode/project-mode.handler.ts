import type { AgenticSession } from '../../session/types';
import type { RunCreatePayloadProjectMode } from '../../shared/agent-bridge-contract/generated/api';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type {
  LocalWorktreeStateByService,
  ResolvedServiceBinding,
} from '../../shared/agent-bridge-contract/contract';
import {
  defaultAddUserMessage,
  type ProjectAssistantPolicy,
  type PrepareResult,
  type PromptTypeHandlerContext,
  type PromptTypeHandlerDeps,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import { buildStartingMessage as buildStartingMessageForPromptType } from '../prompts/starting-message';
import { requestAgentSessionServiceScopeTool } from '../service-scope-request/service-scope-tool';
import { buildProjectModePrompt } from './project-mode-prompt';
import {
  validateProjectModeConfig,
  type ValidatedProjectModeConfig,
} from './project-mode-snapshot';

type PreparedProjectModePayload = RunCreatePayloadProjectMode & {
  _projectMode: ValidatedProjectModeConfig;
  _bundleLocation: string;
  _services?: ResolvedServiceBinding[];
  _launchServiceId?: string;
  _worktreeState?: LocalWorktreeStateByService;
};

// Authority stays fixed in code; the MODE author only chooses participation.
const PROJECT_MODE_PROJECT_ASSISTANT_POLICY: Readonly<ProjectAssistantPolicy> = Object.freeze({
  allowEdgeUpdates: false,
  notifyDiscrepancies: false,
  workItemProposalMode: 'all',
});

/**
 * The sole routing handler for every project-defined MODE. Project content is
 * prepared from the Run-owned snapshot; all authority-bearing fields remain
 * fixed here and cannot be supplied by the bundle.
 */
const handlerDefinition: UserLaunchablePromptTypeHandler<RunCreatePayloadProjectMode> = {
  id: 'project_mode',
  promptType: LocalPromptType.ProjectMode,
  service: 'required',
  launchEntity: 'required',
  implementationReadiness: 'none',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  mcpToolUseCase: 'coding',
  submissionTools: [requestAgentSessionServiceScopeTool],
  projectAssistant: PROJECT_MODE_PROJECT_ASSISTANT_POLICY,

  resolveProjectAssistant(session, logger): ProjectAssistantPolicy | undefined {
    const validated = validateProjectModeConfig(session.config);
    if (!validated.ok) {
      logger.error('project_mode.project_assistant.invalid_captured_config', {
        runId: session.agentic_session_id,
        issues: validated.issues,
      });
      return undefined;
    }
    const enabled = validated.value.snapshot.projectAssistantEnabled;
    logger.info('project_mode.project_assistant.resolved', {
      runId: session.agentic_session_id,
      modeId: validated.value.snapshot.modeId,
      schemaVersion: validated.value.snapshot.schemaVersion,
      enabled,
    });
    return enabled ? PROJECT_MODE_PROJECT_ASSISTANT_POLICY : undefined;
  },

  async prepare(
    run: AgenticSession,
    payload: RunCreatePayloadProjectMode,
    deps: PromptTypeHandlerDeps,
    context?: PromptTypeHandlerContext,
  ): Promise<PrepareResult<RunCreatePayloadProjectMode>> {
    const validated = validateProjectModeConfig(run.config);
    if (!validated.ok) {
      deps.logger.error('project_mode.prepare.invalid_captured_config', {
        runId: run.agentic_session_id,
        issues: validated.issues,
      });
      throw new Error(`project_mode captured config is invalid: ${validated.issues.join('; ')}`);
    }
    if (!context?.projectModeBundleDirectory) {
      deps.logger.error('project_mode.prepare.bundle_location_missing', {
        runId: run.agentic_session_id,
      });
      throw new Error('project_mode requires a materialized captured bundle location');
    }

    const prepared: PreparedProjectModePayload = {
      ...payload,
      _projectMode: validated.value,
      _bundleLocation: context.projectModeBundleDirectory,
      ...(run.services.length > 0 ? { _services: run.services } : {}),
      ...(run.launchServiceId ? { _launchServiceId: run.launchServiceId } : {}),
      ...(run.worktreeState ? { _worktreeState: run.worktreeState } : {}),
    };
    return { payload: prepared };
  },

  buildPrompt(payload: RunCreatePayloadProjectMode): string {
    const prepared = payload as PreparedProjectModePayload;
    return buildProjectModePrompt({
      snapshot: prepared._projectMode.snapshot,
      bundleLocation: prepared._bundleLocation,
      ...(prepared._services ? { services: prepared._services } : {}),
      ...(prepared._launchServiceId ? { launchServiceId: prepared._launchServiceId } : {}),
      ...(prepared._worktreeState ? { worktreeState: prepared._worktreeState } : {}),
    });
  },

  addUserMessage: defaultAddUserMessage,

  buildStartingMessage(
    payload: RunCreatePayloadProjectMode,
    ctx?: PromptTypeHandlerContext,
  ): string | null {
    if (payload.userMessage) {
      return `"${payload.userMessage}"\n\nI'll get started...`;
    }
    return buildStartingMessageForPromptType('free_form', payload, ctx);
  },
};

export const projectModeHandler = Object.freeze(handlerDefinition);
