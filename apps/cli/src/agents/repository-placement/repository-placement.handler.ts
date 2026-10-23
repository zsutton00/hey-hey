import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import {
  ExtendedUIFieldType,
  MessageStatus,
  SystemMessageDataTypeEnum,
} from '../../shared/api/generated/api';
import type { UpdateMessageDto } from '../../shared/api';
import type { AssistantCompleteEvent } from '../../run/types';
import type { AgenticSession } from '../../session/types';
import type {
  CompletionAction,
  CompletionValidationResult,
  PrepareResult,
  PromptTypeHandler,
  PromptTypeHandlerDeps,
  ProviderExecutionSelection,
} from '../prompt-type-handler';
import { AgentSessionRunnerError } from '../providers/session-runner';
import { buildRepositoryPlacementPrompt } from './repository-placement-prompt';
import { parseRepositoryPlacementCompletionFromText } from './response-parser';
import type { RepositoryPlacementPromptPayload, RepositoryPlacementSuccessResult } from './types';

const validateSuccess = (
  result: RepositoryPlacementSuccessResult,
  payload: RepositoryPlacementPromptPayload,
): string | null => {
  const roots = new Set(payload.candidates.map((candidate) => candidate.rootKey));
  const children = new Set(
    payload.candidates.flatMap((candidate) => candidate.children.map((child) => child.childKey)),
  );
  const seen = new Set<string>();
  for (const placement of result.placements) {
    if (seen.has(placement.rootKey)) return `Duplicate rootKey ${placement.rootKey}.`;
    if (children.has(placement.rootKey)) return `Child key ${placement.rootKey} is not placeable.`;
    if (!roots.has(placement.rootKey)) return `Unknown rootKey ${placement.rootKey}.`;
    seen.add(placement.rootKey);
  }
  return seen.size === roots.size ? null : 'Every proposed root requires exactly one placement.';
};

const invalidCompletionAction = (): CompletionAction => ({
  action: {
    action: 'terminal_failure',
    payload: {
      outcome: 'terminal_failure',
      code: 'invalid_completion',
      message: 'The provider did not return a complete valid imported-root placement.',
    },
  },
  hidden: true,
  userFacingResponse: '',
});

export const repositoryPlacementHandler: PromptTypeHandler<RepositoryPlacementPromptPayload> = {
  id: 'repository-placement',
  promptType: LocalPromptType.RepositoryPlacement,
  service: 'required',
  launchEntity: 'none',
  implementationReadiness: 'none',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  providerSessionStart: 'fresh',
  providerSessionLifetime: 'turn',
  mcpToolUseCase: 'repository_placement',
  builtinTools: [],
  omitServiceContextNote: true,
  reports: [],

  resolveProviderExecution(payload): ProviderExecutionSelection {
    if (!payload.provider.trim() || !payload.resolvedFrontierModel.trim()) {
      throw new Error('Repository placement requires the accepted provider and model.');
    }
    return { provider: payload.provider, model: payload.resolvedFrontierModel };
  },

  async prepare(
    run: AgenticSession,
    payload: RepositoryPlacementPromptPayload,
    deps: PromptTypeHandlerDeps,
  ): Promise<PrepareResult<RepositoryPlacementPromptPayload>> {
    if (
      run.launchServiceId !== payload.serviceId ||
      !run.services.some((service) => service.id === payload.serviceId)
    ) {
      throw new Error('The selected Service is not the Run-owned launch workspace.');
    }
    deps.logger.info('repository_placement.prepare.completed', {
      runId: run.agentic_session_id,
      serviceId: payload.serviceId,
      projectId: payload.projectId,
    });
    return { payload };
  },

  buildPrompt: buildRepositoryPlacementPrompt,
  buildStartingMessage: () => 'Reviewing where imported Features fit...',

  validateCompletion(
    event: AssistantCompleteEvent,
    payload: RepositoryPlacementPromptPayload,
  ): CompletionValidationResult {
    const parsed = parseRepositoryPlacementCompletionFromText(event.summary);
    if (!parsed.ok) {
      return { ok: false, error: { code: 'INVALID_COMPLETION', message: parsed.error } };
    }
    const semanticError =
      parsed.value.outcome === 'success' ? validateSuccess(parsed.value, payload) : null;
    return semanticError
      ? { ok: false, error: { code: 'INVALID_COMPLETION', message: semanticError } }
      : { ok: true };
  },

  getCompletionAction(
    event: AssistantCompleteEvent,
    payload?: RepositoryPlacementPromptPayload,
  ): CompletionAction {
    const parsed = parseRepositoryPlacementCompletionFromText(event.summary);
    if (!parsed.ok) return invalidCompletionAction();
    if (
      parsed.value.outcome === 'success' &&
      (!payload || validateSuccess(parsed.value, payload))
    ) {
      return invalidCompletionAction();
    }
    return {
      action: { action: parsed.value.outcome, payload: { ...parsed.value } },
      hidden: true,
      userFacingResponse: '',
    };
  },

  transformCompletionOutput(event: AssistantCompleteEvent): UpdateMessageDto | null {
    const parsed = parseRepositoryPlacementCompletionFromText(event.summary);
    if (!parsed.ok) return null;
    const response =
      parsed.value.outcome === 'success'
        ? 'Repository placement analysis completed.'
        : parsed.value.message;
    return {
      status: MessageStatus.Completed,
      data: {
        type: SystemMessageDataTypeEnum.Agent,
        response,
        detectedIntent: 'agent_response',
        intentConfidence: 1,
        processResponseType: LocalPromptType.RepositoryPlacement,
        uiElements: [
          {
            id: 'repository-placement-completion',
            type: ExtendedUIFieldType.AgentHidden,
            label: 'Repository placement completion',
          },
        ],
      },
    };
  },

  getRunnerFailureAction(error): CompletionAction | null {
    const terminal = error instanceof AgentSessionRunnerError && error.code === 'NOT_SUPPORTED';
    return {
      action: terminal
        ? {
            action: 'terminal_failure',
            payload: {
              outcome: 'terminal_failure',
              code: 'unsupported_provider',
              message: 'The accepted placement provider is not supported by this CLI.',
            },
          }
        : {
            action: 'retryable_failure',
            payload: {
              outcome: 'retryable_failure',
              code: 'provider_unavailable',
              message: 'Imported-root placement is temporarily unavailable.',
            },
          },
      hidden: true,
      userFacingResponse: '',
    };
  },
};
