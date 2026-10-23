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
  PromptTypeHandlerContext,
  PromptTypeHandlerDeps,
  ProviderExecutionSelection,
} from '../prompt-type-handler';
import { AgentSessionRunnerError } from '../providers/session-runner';
import { buildRepositoryFeatureEnrichmentPrompt } from './repository-feature-enrichment-prompt';
import { parseRepositoryFeatureEnrichmentCompletionFromText } from './response-parser';
import type {
  RepositoryFeatureEnrichmentPromptPayload,
  RepositoryFeatureEnrichmentSuccessDecisionResult,
  RepositoryFeatureEnrichmentSuccessResult,
} from './types';

type CandidateSnapshot = {
  id: string;
  name: string;
  description: string;
  tag: string;
  parentId: string | null;
};

const candidateSnapshots = (
  hierarchy: RepositoryFeatureEnrichmentPromptPayload['analysis']['hierarchy'],
): Map<string, CandidateSnapshot> => {
  const candidates = new Map<string, CandidateSnapshot>();
  for (const root of hierarchy.topLevels) {
    candidates.set(root.id, {
      id: root.id,
      name: root.name,
      description: root.description,
      tag: root.tag,
      parentId: null,
    });
    for (const child of root.children) {
      candidates.set(child.id, {
        id: child.id,
        name: child.name,
        description: child.description,
        tag: child.tag,
        parentId: root.id,
      });
    }
  }
  return candidates;
};

export function validateRepositoryFeatureEnrichmentSemantics(
  result: RepositoryFeatureEnrichmentSuccessDecisionResult,
  payload: RepositoryFeatureEnrichmentPromptPayload,
): string | null {
  if (
    result.serviceId !== payload.serviceId ||
    result.provider !== payload.provider ||
    result.resolvedFrontierModel !== payload.resolvedFrontierModel
  )
    return 'The enrichment snapshot changed the API-owned runtime identity.';

  const previous = candidateSnapshots(payload.analysis.hierarchy);
  const current = candidateSnapshots(result.hierarchy);
  if (
    current.size !==
    result.hierarchy.topLevels.reduce((count, root) => count + 1 + root.children.length, 0)
  )
    return 'The enrichment snapshot contains duplicate candidate IDs.';
  const evidencePaths = new Set(result.evidence.map((item) => item.path));
  const answered = new Set(
    payload.answerBatches.flatMap((batch) =>
      batch.answers.map((answer) => `${String(batch.round)}\u0000${answer.question}`),
    ),
  );
  const supportByCandidate = new Map<string, Set<string>>();
  for (const item of result.support) {
    if (!current.has(item.candidateKey))
      return `Unknown support candidateKey ${item.candidateKey}.`;
    if (
      item.source === 'repository_evidence' &&
      (!item.evidencePaths?.length ||
        item.evidencePaths.some((path) => !evidencePaths.has(path)) ||
        item.answerRound !== undefined ||
        item.answerQuestion !== undefined)
    )
      return 'Repository support must cite only evidence paths in the returned snapshot.';
    if (
      item.source === 'user_answer' &&
      (!item.answerQuestion ||
        item.answerRound === undefined ||
        !answered.has(`${String(item.answerRound)}\u0000${item.answerQuestion}`) ||
        item.evidencePaths !== undefined)
    )
      return 'Answer support must cite only an exact accepted prior answer.';
    const details = supportByCandidate.get(item.candidateKey) ?? new Set<string>();
    details.add(item.detail);
    supportByCandidate.set(item.candidateKey, details);
  }
  for (const candidate of current.values()) {
    const prior = previous.get(candidate.id);
    const supportedDetails = supportByCandidate.get(candidate.id);
    if (!prior) {
      for (const detail of [candidate.name, candidate.description]) {
        if (!supportedDetails?.has(detail))
          return `Added Feature ${candidate.id} lacks exact evidence or answer support.`;
      }
      continue;
    }
    for (const detail of [
      candidate.name !== prior.name ? candidate.name : undefined,
      candidate.description !== prior.description ? candidate.description : undefined,
    ]) {
      if (detail !== undefined && !supportedDetails?.has(detail))
        return `Changed Feature detail for ${candidate.id} lacks exact evidence or answer support.`;
    }
    if (
      (candidate.parentId !== prior.parentId || candidate.tag !== prior.tag) &&
      !supportedDetails?.size
    )
      return `Changed Feature placement or tag for ${candidate.id} lacks evidence or answer support.`;
  }
  return null;
}

export function mergeRepositoryFeatureEnrichmentSuccess(
  result: RepositoryFeatureEnrichmentSuccessDecisionResult,
  payload: RepositoryFeatureEnrichmentPromptPayload,
): RepositoryFeatureEnrichmentSuccessResult {
  void payload;
  return result satisfies RepositoryFeatureEnrichmentSuccessResult;
}

const invalidAction = (): CompletionAction => ({
  action: {
    action: 'terminal_failure',
    payload: {
      outcome: 'terminal_failure',
      code: 'invalid_completion',
      message: 'The provider did not return a valid Feature enrichment outcome.',
    },
  },
  hidden: true,
  userFacingResponse: '',
});

export class RepositoryFeatureEnrichmentHandler implements PromptTypeHandler<RepositoryFeatureEnrichmentPromptPayload> {
  readonly id = 'repository-feature-enrichment';
  readonly promptType = LocalPromptType.RepositoryFeatureEnrichment;
  readonly service = 'required';
  readonly launchEntity = 'none';
  readonly implementationReadiness = 'none';
  readonly runnerKind = 'provider_session' as const;
  readonly providerSessionCountsForContext = true;
  readonly providerSessionStart = 'fresh' as const;
  readonly providerSessionLifetime = 'turn' as const;
  readonly readOnlyFilesystem = true;
  readonly repositoryResearch = { delegation: 'allowed' as const };
  readonly mcpToolUseCase = 'repository_grounding' as const;
  readonly builtinTools = [];
  readonly omitServiceContextNote = true;
  readonly reports = [];

  resolveProviderExecution(
    payload: RepositoryFeatureEnrichmentPromptPayload,
  ): ProviderExecutionSelection {
    return { provider: payload.provider, model: payload.resolvedFrontierModel };
  }
  prepare(
    run: AgenticSession,
    payload: RepositoryFeatureEnrichmentPromptPayload,
    deps: PromptTypeHandlerDeps,
  ): Promise<PrepareResult<RepositoryFeatureEnrichmentPromptPayload>> {
    return Promise.resolve().then(() => {
      if (
        run.launchServiceId !== payload.serviceId ||
        !run.services.some((service) => service.id === payload.serviceId)
      )
        throw new Error('The selected Service is not the Run-owned launch workspace.');
      deps.logger.info('repository_feature_enrichment.prepare.completed', {
        runId: run.agentic_session_id,
        serviceId: payload.serviceId,
        completedRounds: payload.completedRounds,
        answerBatchCount: payload.answerBatches.length,
        provider: payload.provider,
        model: payload.resolvedFrontierModel,
      });
      return { payload };
    });
  }
  buildPrompt(
    payload: RepositoryFeatureEnrichmentPromptPayload,
    ctx?: PromptTypeHandlerContext,
  ): string {
    ctx?.logger?.info('repository_feature_enrichment.prompt_builder.started', {
      handlerId: this.id,
      promptType: this.promptType,
      runId: ctx.runId ?? null,
      completedRounds: payload.completedRounds,
      answerBatchCount: payload.answerBatches.length,
      evidenceCount: payload.analysis.evidence.length,
      topLevelCount: payload.analysis.hierarchy.topLevels.length,
    });
    const prompt = buildRepositoryFeatureEnrichmentPrompt(payload);
    ctx?.logger?.info('repository_feature_enrichment.prompt_builder.completed', {
      handlerId: this.id,
      promptType: this.promptType,
      runId: ctx.runId ?? null,
      promptLength: prompt.length,
    });
    return prompt;
  }
  buildStartingMessage = (): string => 'Enriching repository-grounded Features...';
  validateCompletion(
    event: AssistantCompleteEvent,
    payload: RepositoryFeatureEnrichmentPromptPayload,
  ): CompletionValidationResult {
    const parsed = parseRepositoryFeatureEnrichmentCompletionFromText(event.summary);
    if (!parsed.ok)
      return { ok: false, error: { code: 'INVALID_COMPLETION', message: parsed.error } };
    if (parsed.value.outcome === 'questions') {
      if (payload.completedRounds >= 2)
        return {
          ok: false,
          error: {
            code: 'INVALID_COMPLETION',
            message: 'The API-owned question-round limit has been reached.',
          },
        };
      const prior = new Set(
        payload.answerBatches.flatMap((batch) =>
          batch.answers.map((answer) => answer.question.trim().toLocaleLowerCase()),
        ),
      );
      const normalized = parsed.value.questionGroup.questions.map((question) =>
        question.trim().toLocaleLowerCase(),
      );
      if (
        normalized.some((question) => prior.has(question)) ||
        new Set(normalized).size !== normalized.length
      )
        return {
          ok: false,
          error: { code: 'INVALID_COMPLETION', message: 'The completion repeated a question.' },
        };
    }
    const semanticError =
      parsed.value.outcome === 'success'
        ? validateRepositoryFeatureEnrichmentSemantics(parsed.value, payload)
        : null;
    return semanticError
      ? { ok: false, error: { code: 'INVALID_COMPLETION', message: semanticError } }
      : { ok: true };
  }
  getCompletionAction(
    event: AssistantCompleteEvent,
    payload?: RepositoryFeatureEnrichmentPromptPayload,
  ): CompletionAction {
    const parsed = parseRepositoryFeatureEnrichmentCompletionFromText(event.summary);
    if (!parsed.ok || !payload || !this.validateCompletion(event, payload).ok)
      return invalidAction();
    const completion =
      parsed.value.outcome === 'success'
        ? mergeRepositoryFeatureEnrichmentSuccess(parsed.value, payload)
        : parsed.value;
    return {
      action: { action: completion.outcome, payload: { ...completion } },
      hidden: true,
      userFacingResponse: '',
    };
  }
  transformCompletionOutput(event: AssistantCompleteEvent): UpdateMessageDto | null {
    const parsed = parseRepositoryFeatureEnrichmentCompletionFromText(event.summary);
    if (!parsed.ok) return null;
    const response =
      parsed.value.outcome === 'success'
        ? 'Repository Feature enrichment completed.'
        : parsed.value.outcome === 'questions'
          ? 'Repository Feature enrichment needs additional context.'
          : parsed.value.message;
    return {
      status: MessageStatus.Completed,
      data: {
        type: SystemMessageDataTypeEnum.Agent,
        response,
        detectedIntent: 'agent_response',
        intentConfidence: 1,
        processResponseType: LocalPromptType.RepositoryFeatureEnrichment,
        uiElements: [
          {
            id: 'repository-feature-enrichment-completion',
            type: ExtendedUIFieldType.AgentHidden,
            label: 'Repository Feature enrichment completion',
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
              message: 'The accepted enrichment provider is not supported by this CLI.',
            },
          }
        : {
            action: 'retryable_failure',
            payload: {
              outcome: 'retryable_failure',
              code: 'provider_unavailable',
              message: 'Feature enrichment is temporarily unavailable.',
            },
          },
      hidden: true,
      userFacingResponse: '',
    };
  }
}

export const repositoryFeatureEnrichmentHandler = new RepositoryFeatureEnrichmentHandler();
