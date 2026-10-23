import { Injectable, Logger } from '@nestjs/common';
import type {
  RepositoryFeatureEnrichmentCompletion,
  RepositoryFeatureEnrichmentQuestions,
  RepositoryFeatureEnrichmentRetryableFailure,
  RepositoryFeatureEnrichmentRequest,
  RepositoryFeatureEnrichmentSuccess,
  RepositoryFeatureEnrichmentTerminalFailure,
  RepositoryGroundingSuccess,
} from 'src/generated';
import { LocalPromptType } from 'src/generated/local';
import {
  ExternalAgentActionSchemas,
  ExternalAgentFlowData,
  ExternalAgentNodeBase,
  ExternalAgentTriggerMessage,
  FlowUserMessage,
  MutableContextHandle,
  RepositoryImportFlowContext,
} from 'src/types/flow-internal.types';
import { REPOSITORY_IMPORT_NODES } from '../../constants/node-ids';
import { createOpenApiRuntimeSchema } from '../shared/openapi-runtime-schema';

const questionsSchema =
  createOpenApiRuntimeSchema<RepositoryFeatureEnrichmentQuestions>(
    'RepositoryFeatureEnrichmentQuestions',
  );
const successSchema =
  createOpenApiRuntimeSchema<RepositoryFeatureEnrichmentSuccess>(
    'RepositoryFeatureEnrichmentSuccess',
  );
const retryableSchema =
  createOpenApiRuntimeSchema<RepositoryFeatureEnrichmentRetryableFailure>(
    'RepositoryFeatureEnrichmentRetryableFailure',
  );
const terminalSchema =
  createOpenApiRuntimeSchema<RepositoryFeatureEnrichmentTerminalFailure>(
    'RepositoryFeatureEnrichmentTerminalFailure',
  );

const MAX_ENRICHMENT_QUESTION_ROUNDS = 2;
const MAX_ENRICHMENT_QUESTIONS_PER_ROUND = 3;

function validateEnrichmentRoundState(
  context: Readonly<RepositoryImportFlowContext>,
): string | undefined {
  const completedRounds =
    context.repositoryFeatureEnrichmentCompletedRounds ?? 0;
  const answerBatches = context.repositoryFeatureEnrichmentAnswerBatches ?? [];
  if (
    !Number.isInteger(completedRounds) ||
    completedRounds < 0 ||
    completedRounds > MAX_ENRICHMENT_QUESTION_ROUNDS
  )
    return 'Repository Feature enrichment completedRounds must be an integer from zero through two.';
  if (
    answerBatches.length !== completedRounds ||
    answerBatches.some((batch, index) => batch.round !== index + 1)
  )
    return 'Repository Feature enrichment answer batches must match the API-owned completed-round count.';
  return undefined;
}

export const repositoryFeatureEnrichmentActions: ExternalAgentActionSchemas = {
  questions: { schema: questionsSchema, waitForUser: false },
  success: { schema: successSchema, waitForUser: false },
  retryable_failure: { schema: retryableSchema, waitForUser: false },
  terminal_failure: { schema: terminalSchema, waitForUser: false },
};

function parseCompletion(
  action: string,
  payload: unknown,
): RepositoryFeatureEnrichmentCompletion | undefined {
  switch (action) {
    case 'questions': {
      const parsed = questionsSchema.safeParse(payload);
      return parsed.success ? parsed.data : undefined;
    }
    case 'success': {
      const parsed = successSchema.safeParse(payload);
      return parsed.success ? parsed.data : undefined;
    }
    case 'retryable_failure': {
      const parsed = retryableSchema.safeParse(payload);
      return parsed.success ? parsed.data : undefined;
    }
    case 'terminal_failure': {
      const parsed = terminalSchema.safeParse(payload);
      return parsed.success ? parsed.data : undefined;
    }
    default:
      return undefined;
  }
}

type CandidateSnapshot = {
  name: string;
  description: string;
  tag: string;
  parentId: string | null;
};

function candidateSnapshots(
  hierarchy: RepositoryFeatureEnrichmentSuccess['hierarchy'],
): Map<string, CandidateSnapshot> {
  const candidates = new Map<string, CandidateSnapshot>();
  for (const root of hierarchy.topLevels) {
    candidates.set(root.id, {
      name: root.name,
      description: root.description,
      tag: root.tag,
      parentId: null,
    });
    for (const child of root.children) {
      candidates.set(child.id, {
        name: child.name,
        description: child.description,
        tag: child.tag,
        parentId: root.id,
      });
    }
  }
  return candidates;
}

function acceptedEnrichmentAnalysis(
  context: Readonly<RepositoryImportFlowContext>,
): RepositoryGroundingSuccess | undefined {
  return (
    context.repositoryFeatureEnrichmentAcceptedAnalysis ??
    context.repositoryGroundingBaseline
  );
}

function leanRepositoryGroundingAnalysis(
  analysis: RepositoryFeatureEnrichmentSuccess | RepositoryGroundingSuccess,
): RepositoryFeatureEnrichmentRequest['analysis'] {
  return {
    outcome: analysis.outcome,
    serviceId: analysis.serviceId,
    provider: analysis.provider,
    resolvedFrontierModel: analysis.resolvedFrontierModel,
    narrative: analysis.narrative,
    hierarchy: analysis.hierarchy,
    evidence: analysis.evidence,
    briefDiscrepancies: analysis.briefDiscrepancies,
  };
}

export function validateRepositoryFeatureEnrichmentSuccess(
  completion: RepositoryFeatureEnrichmentSuccess,
  context: Readonly<RepositoryImportFlowContext>,
): string | undefined {
  const acceptedAnalysis = acceptedEnrichmentAnalysis(context);
  const accepted = context.repositoryGrounding;
  if (!acceptedAnalysis || !accepted) {
    return 'Repository Feature enrichment has no accepted analysis snapshot.';
  }
  const roundStateError = validateEnrichmentRoundState(context);
  if (roundStateError) return roundStateError;
  if (
    completion.serviceId !== accepted.prerequisites.serviceId ||
    completion.provider !== accepted.analysisConfiguration.provider ||
    completion.resolvedFrontierModel !==
      accepted.analysisConfiguration.resolvedFrontierModel ||
    completion.outcome !== 'success'
  ) {
    return 'Repository Feature enrichment success changed API-owned runtime identity.';
  }
  const previousCandidates = candidateSnapshots(acceptedAnalysis.hierarchy);
  const currentCandidates = candidateSnapshots(completion.hierarchy);
  const candidateCount = completion.hierarchy.topLevels.reduce(
    (count, root) => count + 1 + root.children.length,
    0,
  );
  if (currentCandidates.size !== candidateCount) {
    return 'Repository Feature enrichment success contains duplicate candidate IDs.';
  }
  const evidencePaths = new Set(completion.evidence.map((item) => item.path));
  const answeredQuestions = new Map(
    (context.repositoryFeatureEnrichmentAnswerBatches ?? []).flatMap((batch) =>
      batch.answers.map((answer) => [answer.question, batch.round] as const),
    ),
  );
  const supportByCandidate = new Map<string, Set<string>>();
  for (const support of completion.support) {
    if (!currentCandidates.has(support.candidateKey)) {
      return `Repository Feature enrichment support references unknown candidate ${support.candidateKey}.`;
    }
    if (
      support.source === 'repository_evidence' &&
      (!support.evidencePaths?.length ||
        support.evidencePaths.some((path) => !evidencePaths.has(path)) ||
        support.answerRound !== undefined ||
        support.answerQuestion !== undefined)
    ) {
      return 'Repository Feature enrichment support must cite evidence in the returned snapshot.';
    }
    if (
      support.source === 'user_answer' &&
      (!support.answerQuestion ||
        support.answerRound !== answeredQuestions.get(support.answerQuestion) ||
        support.evidencePaths !== undefined)
    ) {
      return 'Repository Feature enrichment support cites an unaccepted user answer.';
    }
    const details =
      supportByCandidate.get(support.candidateKey) ?? new Set<string>();
    details.add(support.detail);
    supportByCandidate.set(support.candidateKey, details);
  }
  for (const [candidateKey, current] of currentCandidates) {
    const previous = previousCandidates.get(candidateKey);
    const supportedDetails = supportByCandidate.get(candidateKey);
    if (!previous) {
      for (const detail of [current.name, current.description]) {
        if (!supportedDetails?.has(detail)) {
          return `Added Feature ${candidateKey} lacks exact evidence or answer support.`;
        }
      }
      continue;
    }
    for (const [detail, baselineDetail] of [
      [current.name, previous.name],
      [current.description, previous.description],
    ] as const) {
      if (detail !== baselineDetail && !supportedDetails?.has(detail)) {
        return `Changed Feature detail for ${candidateKey} lacks exact evidence or answer support.`;
      }
    }
    if (
      (current.parentId !== previous.parentId ||
        current.tag !== previous.tag) &&
      !supportedDetails?.size
    ) {
      return `Changed Feature placement or tag for ${candidateKey} lacks evidence or answer support.`;
    }
  }
  return undefined;
}

@Injectable()
export class RepositoryFeatureEnrichmentNode extends ExternalAgentNodeBase<RepositoryImportFlowContext> {
  readonly id = REPOSITORY_IMPORT_NODES.ENRICHMENT;
  readonly promptType = LocalPromptType.repository_feature_enrichment;
  readonly actions = repositoryFeatureEnrichmentActions;
  readonly acceptsUserMessages = false;
  private readonly logger = new Logger(RepositoryFeatureEnrichmentNode.name);

  async buildTriggerMessage(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
  ): Promise<ExternalAgentTriggerMessage> {
    const context = tracker.getContext();
    const accepted = context.repositoryGrounding;
    const acceptedAnalysis = acceptedEnrichmentAnalysis(context);
    if (!accepted || !acceptedAnalysis)
      throw new Error(
        'Feature enrichment requires an accepted repository analysis snapshot.',
      );
    const roundStateError = validateEnrichmentRoundState(context);
    if (roundStateError) throw new Error(roundStateError);
    const payload = {
      promptType: 'repository_feature_enrichment',
      projectId: context.core.projectId,
      conversationId: context.core.conversationId,
      workflowId: context.core.workflowId,
      workflowNodeId: this.id,
      serviceId: accepted.prerequisites.serviceId,
      machineId: accepted.prerequisites.machineId,
      provider: accepted.analysisConfiguration.provider,
      resolvedFrontierModel:
        accepted.analysisConfiguration.resolvedFrontierModel,
      reasoningEffort: accepted.analysisConfiguration.reasoningEffort,
      ...(accepted.analysisConfiguration.fastMode === undefined
        ? {}
        : { fastMode: accepted.analysisConfiguration.fastMode }),
      analysis: leanRepositoryGroundingAnalysis(acceptedAnalysis),
      reviewedCandidates:
        context.repositoryFeatureEnrichmentReviewedCandidates ??
        acceptedAnalysis.hierarchy,
      completedRounds: context.repositoryFeatureEnrichmentCompletedRounds ?? 0,
      answerBatches: context.repositoryFeatureEnrichmentAnswerBatches ?? [],
    } satisfies RepositoryFeatureEnrichmentRequest;
    this.logger.debug('Repository Feature enrichment request built', {
      conversationId: context.core.conversationId,
      serviceId: payload.serviceId,
      completedRounds: payload.completedRounds,
      answerBatchCount: payload.answerBatches.length,
      provider: payload.provider,
      model: payload.resolvedFrontierModel,
    });
    return {
      response:
        'Reviewing the repository-backed Feature details before the proposal.',
      uiElements: [],
      triggersAgent: { promptType: this.promptType, nodeId: this.id, payload },
      data: {
        detectedIntent: 'repository_feature_enrichment_started',
        intentConfidence: 1,
        ragEnabled: false,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    message: FlowUserMessage,
  ): Promise<void> {
    const data = (message.data ?? {}) as Partial<ExternalAgentFlowData>;
    if (typeof data.action !== 'string') return;
    const completion = parseCompletion(data.action, data.payload);
    if (!completion) return;
    const context = tracker.getContext();
    const roundStateError = validateEnrichmentRoundState(context);
    if (roundStateError) {
      this.rejectCompletion(tracker, roundStateError);
      return;
    }
    if (completion.outcome === 'questions') {
      const completedRounds =
        context.repositoryFeatureEnrichmentCompletedRounds ?? 0;
      if (
        completedRounds >= MAX_ENRICHMENT_QUESTION_ROUNDS ||
        completion.questionGroup.questions.length >
          MAX_ENRICHMENT_QUESTIONS_PER_ROUND
      ) {
        this.rejectCompletion(
          tracker,
          'Repository Feature enrichment returned an invalid question group.',
        );
        return;
      }
    }
    let acceptedCompletion: RepositoryFeatureEnrichmentCompletion = completion;
    if (completion.outcome === 'success') {
      const validationError = validateRepositoryFeatureEnrichmentSuccess(
        completion,
        context,
      );
      if (validationError) {
        this.rejectCompletion(tracker, validationError);
        return;
      }
      acceptedCompletion = completion;
      this.logger.debug('Repository Feature enrichment success validated', {
        conversationId: context.core.conversationId,
        completedRounds:
          context.repositoryFeatureEnrichmentCompletedRounds ?? 0,
        candidateCount: candidateSnapshots(acceptedCompletion.hierarchy).size,
        evidenceCount: acceptedCompletion.evidence.length,
        supportCount: acceptedCompletion.support.length,
        discrepancyCount: acceptedCompletion.briefDiscrepancies.length,
      });
    }
    tracker.mutate((draft) => {
      draft.repositoryFeatureEnrichmentLatestOutcome = acceptedCompletion;
      if (acceptedCompletion.outcome === 'success') {
        draft.repositoryFeatureEnrichmentAcceptedAnalysis =
          leanRepositoryGroundingAnalysis(acceptedCompletion);
        draft.repositoryFeatureEnrichmentFinal = acceptedCompletion;
      }
    });
    this.logger.debug('Repository Feature enrichment outcome stored', {
      conversationId: context.core.conversationId,
      outcome: acceptedCompletion.outcome,
      completedRounds: context.repositoryFeatureEnrichmentCompletedRounds ?? 0,
    });
  }

  async determineRoutingFromAgentCompletion(
    context: Readonly<RepositoryImportFlowContext>,
    action: string,
  ): Promise<string | undefined> {
    if (
      action === 'questions' &&
      context.repositoryFeatureEnrichmentLatestOutcome?.outcome === 'questions'
    )
      return REPOSITORY_IMPORT_NODES.ENRICHMENT_QUESTIONS;
    if (
      action === 'success' &&
      context.repositoryFeatureEnrichmentLatestOutcome?.outcome === 'success' &&
      context.repositoryFeatureEnrichmentFinal
    )
      return REPOSITORY_IMPORT_NODES.GENERATE_FEATURES;
    return REPOSITORY_IMPORT_NODES.ENRICHMENT_RECOVERY;
  }

  private rejectCompletion(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    reason: string,
  ): void {
    tracker.mutate((draft) => {
      draft.repositoryFeatureEnrichmentLatestOutcome = {
        outcome: 'terminal_failure',
        code: 'invalid_completion',
        message: reason,
      };
    });
    this.logger.warn('Repository Feature enrichment completion rejected', {
      conversationId: tracker.getContext().core.conversationId,
      reason,
    });
  }
}
