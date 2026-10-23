import {
  ExtendedUIFieldType,
  MessageStatus,
  MessageType,
  SystemMessageDataTypeEnum,
} from '../../shared/api/generated/api';
import type { UpdateMessageDto } from '../../shared/api';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type {
  AssistantCompleteEvent,
  CreateMessageBody as RunCreateMessageBody,
} from '../../run/types';
import type { AgenticSession } from '../../session/types';
import {
  type CompletionAction,
  type CompletionValidationFailure,
  type CompletionValidationResult,
  type OnCompleteDeps,
  type OnInvalidCompletionContext,
  type PrepareResult,
  type PromptTypeHandler,
  type PromptTypeHandlerDeps,
} from '../prompt-type-handler';
import {
  parseRepositoryAnalysisCompletionFromText,
  parseRepositoryAnalysisCompletionResponseFromText,
} from './response-parser';
import {
  buildRepositoryAnalysisPrompt,
  type RepositoryAnalysisPromptInput,
} from './repository-analysis-prompt';
import type { RepositoryAnalysisPromptPayload, RepositoryAnalysisSuccess } from './types';
import type { ProviderExecutionSelection } from '../prompt-type-handler';
import { AgentSessionRunnerError } from '../providers/session-runner';

type RepositoryAnalysisHandlerPayload = RepositoryAnalysisPromptPayload;

export class RepositoryAnalysisPreparationError extends Error {
  public constructor(
    public readonly code: 'SERVICE_BINDING_UNAVAILABLE' | 'INVALID_ANALYSIS_INPUT',
    message: string,
  ) {
    super(message);
    this.name = 'RepositoryAnalysisPreparationError';
  }
}

const resolveRepositoryAnalysisProviderExecution = (
  payload: Pick<RepositoryAnalysisPromptPayload, 'provider' | 'resolvedFrontierModel'>,
): ProviderExecutionSelection => {
  const provider = payload.provider.trim();
  const model = payload.resolvedFrontierModel.trim();
  if (!model) {
    throw new RepositoryAnalysisPreparationError(
      'INVALID_ANALYSIS_INPUT',
      'Repository analysis requires a resolved frontier model.',
    );
  }
  return { provider, model };
};

const validateSuccessSemantics = (
  completion: RepositoryAnalysisSuccess,
  payload: RepositoryAnalysisHandlerPayload,
): CompletionValidationFailure | null => {
  if (completion.serviceId !== payload.serviceId) {
    return {
      code: 'INVALID_COMPLETION',
      message: 'The completion service id does not match the selected Service.',
      issues: [`/serviceId: must equal the selected Service id ${payload.serviceId}`],
    };
  }
  const issues = [
    ...(completion.provider !== payload.provider
      ? [`/provider: must equal the accepted provider ${payload.provider}`]
      : []),
    ...(completion.resolvedFrontierModel !== payload.resolvedFrontierModel
      ? [`/resolvedFrontierModel: must equal the accepted model ${payload.resolvedFrontierModel}`]
      : []),
  ];
  if (issues.length > 0) {
    return {
      code: 'INVALID_COMPLETION',
      message: 'The completion provider identity does not match the accepted analysis request.',
      issues,
    };
  }
  return null;
};

const invalidOutcomeMessage =
  'The provider did not return the required typed repository grounding outcome.';

const validateRepositoryAnalysisCompletion = (
  event: AssistantCompleteEvent,
  payload: RepositoryAnalysisHandlerPayload | undefined,
): CompletionValidationResult => {
  const parsed = parseRepositoryAnalysisCompletionResponseFromText(event.summary);
  if (!parsed.ok) {
    return {
      ok: false,
      error: {
        code: 'INVALID_COMPLETION',
        message: invalidOutcomeMessage,
        issues: parsed.error.split('; '),
      },
    };
  }
  if (parsed.value.outcome === 'success' && payload) {
    const semanticError = validateSuccessSemantics(parsed.value, payload);
    if (semanticError) return { ok: false, error: semanticError };
  }
  return { ok: true };
};

/**
 * Field paths only: schema issues are `<path>: <rule>`; anything without a
 * leading path (JSON syntax errors) may quote provider output and is dropped.
 */
const safeIssuePaths = (failure: CompletionValidationFailure): string[] => [
  ...new Set(
    (failure.issues ?? []).flatMap((issue) => {
      const match = /^(\/[^\s:]*):/u.exec(issue);
      return match?.[1] ? [match[1]] : [];
    }),
  ),
];

const preparePayload = async (
  run: AgenticSession,
  payload: RepositoryAnalysisHandlerPayload,
  deps: PromptTypeHandlerDeps,
): Promise<PrepareResult<RepositoryAnalysisHandlerPayload>> => {
  if (!payload.serviceId.trim()) {
    throw new RepositoryAnalysisPreparationError(
      'INVALID_ANALYSIS_INPUT',
      'Repository analysis requires a selected Service id.',
    );
  }
  if (!payload.provider.trim() || !payload.resolvedFrontierModel.trim()) {
    throw new RepositoryAnalysisPreparationError(
      'INVALID_ANALYSIS_INPUT',
      'Repository analysis requires the selected provider and resolved frontier model.',
    );
  }

  const binding = run.services.find((service) => service.id === payload.serviceId);
  if (!binding || run.launchServiceId !== payload.serviceId) {
    deps.logger.warn('repository_grounding.prepare.service_binding_unavailable', {
      runId: run.agentic_session_id,
      serviceId: payload.serviceId,
      launchServiceId: run.launchServiceId ?? null,
      boundServiceIds: run.services.map((service) => service.id),
    });
    throw new RepositoryAnalysisPreparationError(
      'SERVICE_BINDING_UNAVAILABLE',
      'The selected Service is not the Run-owned launch workspace.',
    );
  }

  deps.logger.info('repository_grounding.prepare.completed', {
    runId: run.agentic_session_id,
    serviceId: payload.serviceId,
    launchServiceId: run.launchServiceId,
    workspaceBound: true,
    researchMode: 'adaptive',
    provider: payload.provider,
    model: payload.resolvedFrontierModel,
  });

  return {
    payload,
    sessionContext: {
      repositoryGrounding: {
        serviceId: payload.serviceId,
        researchMode: 'adaptive',
      },
    },
  };
};

const buildInvalidCompletionDto = (
  failureMessage: string,
  projectId: string,
): RunCreateMessageBody => ({
  type: MessageType.System,
  status: MessageStatus.Completed,
  projectId,
  data: {
    type: SystemMessageDataTypeEnum.Agent,
    response: `Repository analysis could not be completed: ${failureMessage}`,
    detectedIntent: 'agent_response',
    intentConfidence: 1,
  },
});

const invalidCompletionAction = (failure: CompletionValidationFailure): CompletionAction => {
  const paths = safeIssuePaths(failure);
  return {
    action: {
      action: 'terminal_failure',
      payload: {
        outcome: 'terminal_failure',
        code: 'invalid_completion',
        message:
          paths.length > 0
            ? `${failure.message} Invalid fields: ${paths.join(', ')}.`
            : failure.message,
      },
    },
    hidden: true,
    userFacingResponse: '',
  };
};

const isAbortFailure = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return /\babort(?:ed|ing)?\b|\bcancel(?:ed|led|ing)?\b/i.test(error.message);
};

const runnerFailureAction = (error: unknown): CompletionAction | null => {
  // A user-initiated disconnect/abort is not an analysis outcome. Leaving the
  // workflow parked lets the reconnect/resume path restore the accepted
  // choices instead of manufacturing a retryable provider failure.
  if (isAbortFailure(error)) return null;

  if (error instanceof AgentSessionRunnerError && error.code === 'NOT_SUPPORTED') {
    return {
      action: {
        action: 'terminal_failure',
        payload: {
          outcome: 'terminal_failure',
          code: 'unsupported_provider',
          message: 'The accepted repository analysis provider is not supported by this CLI.',
        },
      },
      hidden: true,
      userFacingResponse: '',
    };
  }

  return {
    action: {
      action: 'retryable_failure',
      payload: {
        outcome: 'retryable_failure',
        code: 'provider_unavailable',
        message: 'Repository analysis was temporarily unavailable. Please try again.',
      },
    },
    hidden: true,
    userFacingResponse: '',
  };
};

const createRepositoryAnalysisHandler =
  (): PromptTypeHandler<RepositoryAnalysisHandlerPayload> => ({
    id: 'repository-analysis',
    promptType: LocalPromptType.RepositoryGrounding,
    service: 'required',
    launchEntity: 'none',
    implementationReadiness: 'none',
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    providerSessionStart: 'fresh',
    providerSessionLifetime: 'turn',
    readOnlyFilesystem: true,
    repositoryResearch: { delegation: 'allowed' },
    mcpToolUseCase: 'repository_grounding',
    omitServiceContextNote: true,
    reports: [],

    resolveProviderExecution(payload): ProviderExecutionSelection {
      return resolveRepositoryAnalysisProviderExecution(payload);
    },

    async prepare(
      run: AgenticSession,
      payload: RepositoryAnalysisHandlerPayload,
      deps: PromptTypeHandlerDeps,
    ): Promise<PrepareResult<RepositoryAnalysisHandlerPayload>> {
      return preparePayload(run, payload, deps);
    },

    buildPrompt(payload: RepositoryAnalysisHandlerPayload): string {
      const provider = payload.provider.trim();
      const model = payload.resolvedFrontierModel.trim();
      if (!provider || !model) {
        throw new RepositoryAnalysisPreparationError(
          'INVALID_ANALYSIS_INPUT',
          'Repository analysis prompt requires the accepted provider identity.',
        );
      }
      const input: RepositoryAnalysisPromptInput = {
        ...payload,
        provider,
        model,
      };
      return buildRepositoryAnalysisPrompt(input);
    },

    buildStartingMessage(): string {
      return 'Researching repository capabilities...';
    },

    validateCompletion(
      event: AssistantCompleteEvent,
      payload: RepositoryAnalysisHandlerPayload,
    ): CompletionValidationResult {
      return validateRepositoryAnalysisCompletion(event, payload);
    },

    getCompletionAction(
      event: AssistantCompleteEvent,
      payload?: RepositoryAnalysisHandlerPayload,
    ): CompletionAction {
      const validation = validateRepositoryAnalysisCompletion(event, payload);
      const parsed = parseRepositoryAnalysisCompletionFromText(event.summary);
      if (!validation.ok || !parsed.ok) {
        return invalidCompletionAction(
          validation.ok ? { message: invalidOutcomeMessage } : validation.error,
        );
      }
      return {
        action: {
          action: parsed.value.outcome,
          payload: { ...parsed.value },
        },
        hidden: true,
        userFacingResponse: '',
      };
    },

    getRunnerFailureAction(error: unknown): CompletionAction | null {
      return runnerFailureAction(error);
    },

    transformCompletionOutput(event: AssistantCompleteEvent): UpdateMessageDto | null {
      const parsed = parseRepositoryAnalysisCompletionFromText(event.summary);
      if (!parsed.ok) return null;
      const response =
        parsed.value.outcome === 'success'
          ? 'Repository capability analysis completed.'
          : parsed.value.message;
      return {
        status: MessageStatus.Completed,
        data: {
          type: SystemMessageDataTypeEnum.Agent,
          response,
          detectedIntent: 'agent_response',
          intentConfidence: 1,
          processResponseType: LocalPromptType.RepositoryGrounding,
          uiElements: [
            {
              id: 'repository-grounding-completion',
              type: ExtendedUIFieldType.AgentHidden,
              label: 'Repository grounding completion',
            },
          ],
        },
      };
    },

    async onInvalidCompletion(
      _event: AssistantCompleteEvent,
      ctx: OnInvalidCompletionContext,
      deps: OnCompleteDeps,
      failureResult,
    ): Promise<void> {
      deps.logger.warn('repository_grounding.completion.invalid', {
        runId: ctx.runId,
        code: failureResult.code,
        message: failureResult.message,
        issues: failureResult.issues,
      });
      await deps.poster.createOutOfBand({
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        conversationId: ctx.conversationId,
        dto: buildInvalidCompletionDto(failureResult.message, ctx.projectId),
        stamp: ctx.stamp,
      });
    },
  });

export const repositoryAnalysisHandler = createRepositoryAnalysisHandler();

const repositoryAnalysisHandlers = [repositoryAnalysisHandler] as const;
