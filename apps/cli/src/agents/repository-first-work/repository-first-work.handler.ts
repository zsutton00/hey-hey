import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import {
  ExtendedUIFieldType,
  MessageStatus,
  SystemMessageDataTypeEnum,
} from '../../shared/api/generated/api';
import type { UpdateMessageDto } from '../../shared/api';
import type { AssistantCompleteEvent } from '../../run/types';
import type { AgenticSession } from '../../session/types';
import {
  PROJECT_ASSISTANT_CREATE_WORK_ITEM_MCP_TOOL,
  PROJECT_ASSISTANT_EDIT_WORK_ITEM_MCP_TOOL,
  PROJECT_ASSISTANT_WORK_ITEM_GUIDANCE_MCP_TOOL,
} from '../mcp-server-config';
import type {
  CompletionAction,
  CompletionValidationResult,
  PrepareResult,
  PromptTypeHandler,
  PromptTypeHandlerContext,
  PromptTypeHandlerDeps,
  ProviderExecutionSelection,
} from '../prompt-type-handler';
import { AgentSessionRunnerError } from '../providers/session-runner';
import { buildRepositoryFirstWorkPrompt } from './repository-first-work-prompt';
import { parseRepositoryFirstWorkCompletionFromText } from './response-parser';
import type { RepositoryFirstWorkPromptPayload } from './types';

const MAX_FOLLOW_UP_ROUNDS = 1;

const invalidAction = (): CompletionAction => ({
  action: {
    action: 'terminal_failure',
    payload: {
      outcome: 'terminal_failure',
      code: 'invalid_completion',
      message: 'The provider did not return a valid first-work outcome.',
    },
  },
  hidden: true,
  userFacingResponse: '',
});

class RepositoryFirstWorkHandler implements PromptTypeHandler<RepositoryFirstWorkPromptPayload> {
  readonly id = 'repository-first-work';
  readonly promptType = LocalPromptType.RepositoryFirstWork;
  readonly service = 'required';
  readonly launchEntity = 'none';
  readonly implementationReadiness = 'none';
  readonly runnerKind = 'provider_session' as const;
  readonly providerSessionCountsForContext = true;
  readonly providerSessionStart = 'fresh' as const;
  readonly providerSessionLifetime = 'turn' as const;
  readonly readOnlyFilesystem = true;
  // Placement's read surface (search + context) plus the ordinary proposal
  // tools; authoring guidance is added automatically for the gated tools.
  readonly mcpToolUseCase = 'repository_placement' as const;
  readonly additionalAllowedTools = [
    PROJECT_ASSISTANT_WORK_ITEM_GUIDANCE_MCP_TOOL,
    PROJECT_ASSISTANT_CREATE_WORK_ITEM_MCP_TOOL,
    PROJECT_ASSISTANT_EDIT_WORK_ITEM_MCP_TOOL,
  ];
  readonly builtinTools = [];
  readonly omitServiceContextNote = true;
  readonly reports = [];

  resolveProviderExecution(payload: RepositoryFirstWorkPromptPayload): ProviderExecutionSelection {
    return { provider: payload.provider, model: payload.resolvedFrontierModel };
  }

  prepare(
    run: AgenticSession,
    payload: RepositoryFirstWorkPromptPayload,
    deps: PromptTypeHandlerDeps,
  ): Promise<PrepareResult<RepositoryFirstWorkPromptPayload>> {
    return Promise.resolve().then(() => {
      if (
        run.launchServiceId !== payload.serviceId ||
        !run.services.some((service) => service.id === payload.serviceId)
      )
        throw new Error('The selected Service is not the Run-owned launch workspace.');
      deps.logger.info('repository_first_work.prepare.completed', {
        runId: run.agentic_session_id,
        serviceId: payload.serviceId,
        followUpRoundCount: payload.followUpRoundCount,
        materializedFeatureCount: payload.materializedFeatureIds.length,
        provider: payload.provider,
        model: payload.resolvedFrontierModel,
      });
      return { payload };
    });
  }

  buildPrompt(payload: RepositoryFirstWorkPromptPayload, ctx?: PromptTypeHandlerContext): string {
    const prompt = buildRepositoryFirstWorkPrompt(payload);
    ctx?.logger?.info('repository_first_work.prompt_builder.completed', {
      handlerId: this.id,
      runId: ctx.runId ?? null,
      followUpRoundCount: payload.followUpRoundCount,
      promptLength: prompt.length,
    });
    return prompt;
  }

  buildStartingMessage = (): string => 'Preparing your first piece of work...';

  validateCompletion(
    event: AssistantCompleteEvent,
    payload: RepositoryFirstWorkPromptPayload,
  ): CompletionValidationResult {
    const parsed = parseRepositoryFirstWorkCompletionFromText(event.summary);
    if (!parsed.ok)
      return { ok: false, error: { code: 'INVALID_COMPLETION', message: parsed.error } };
    if (parsed.value.outcome === 'questions' && payload.followUpRoundCount >= MAX_FOLLOW_UP_ROUNDS)
      return {
        ok: false,
        error: {
          code: 'INVALID_COMPLETION',
          message: 'The follow-up round has already been used.',
        },
      };
    if (parsed.value.outcome === 'success') {
      const ids = [...parsed.value.taskProposalIds, ...parsed.value.featureProposalIds];
      if (new Set(ids).size !== ids.length)
        return {
          ok: false,
          error: { code: 'INVALID_COMPLETION', message: 'A proposal id was reported twice.' },
        };
    }
    return { ok: true };
  }

  getCompletionAction(
    event: AssistantCompleteEvent,
    payload?: RepositoryFirstWorkPromptPayload,
  ): CompletionAction {
    const parsed = parseRepositoryFirstWorkCompletionFromText(event.summary);
    if (!parsed.ok || !payload || !this.validateCompletion(event, payload).ok)
      return invalidAction();
    return {
      action: { action: parsed.value.outcome, payload: { ...parsed.value } },
      hidden: true,
      userFacingResponse: '',
    };
  }

  transformCompletionOutput(event: AssistantCompleteEvent): UpdateMessageDto | null {
    const parsed = parseRepositoryFirstWorkCompletionFromText(event.summary);
    if (!parsed.ok) return null;
    const response =
      parsed.value.outcome === 'success'
        ? parsed.value.summary
        : parsed.value.outcome === 'questions'
          ? 'A little more detail will help shape the first task.'
          : parsed.value.message;
    return {
      status: MessageStatus.Completed,
      data: {
        type: SystemMessageDataTypeEnum.Agent,
        response,
        detectedIntent: 'agent_response',
        intentConfidence: 1,
        processResponseType: LocalPromptType.RepositoryFirstWork,
        uiElements: [
          {
            id: 'repository-first-work-completion',
            // Visible on success so the proposals the agent created, which are
            // attached to this message, render with the normal proposal review.
            type:
              parsed.value.outcome === 'success'
                ? ExtendedUIFieldType.AgentResponse
                : ExtendedUIFieldType.AgentHidden,
            label: 'Repository first-work completion',
          },
        ],
      },
    };
  }

  getRunnerFailureAction(error: unknown): CompletionAction | null {
    const terminal = error instanceof AgentSessionRunnerError && error.code === 'NOT_SUPPORTED';
    return {
      action: terminal
        ? {
            action: 'terminal_failure',
            payload: {
              outcome: 'terminal_failure',
              code: 'unsupported_provider',
              message: 'The accepted provider is not supported by this CLI.',
            },
          }
        : {
            action: 'retryable_failure',
            payload: {
              outcome: 'retryable_failure',
              code: 'provider_unavailable',
              message: 'Preparing the first task is temporarily unavailable.',
            },
          },
      hidden: true,
      userFacingResponse: '',
    };
  }
}

export const repositoryFirstWorkHandler = new RepositoryFirstWorkHandler();
