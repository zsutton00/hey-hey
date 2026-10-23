import { Injectable, Logger } from '@nestjs/common';
import type {
  RepositoryGroundingRequest,
  RepositoryGroundingSuccess,
  RepositoryGroundingTerminalFailure,
  RepositoryGroundingWorkflowContext,
} from 'src/generated';
import { ExtendedUIFieldType, UIElement } from 'src/generated';
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
import {
  REPOSITORY_IMPORT_NODES,
  SHARED_NODES,
} from '../../constants/node-ids';
import {
  buildRepositoryGroundingFieldPayload,
  getRepositoryGroundingAnswers,
  hasRepositoryGroundingTypedAnswers,
  parseRepositoryGroundingCompletion,
  parseRepositoryGroundingFormSubmission,
  repositoryGroundingActions,
  REPOSITORY_GROUNDING_ACTIONS,
} from './repository-grounding.contract';

function invalidSuccessCompletionReason(
  completion: RepositoryGroundingSuccess,
  accepted: RepositoryGroundingWorkflowContext | undefined,
): string | undefined {
  if (!accepted) {
    return 'The analysis result arrived without an accepted repository-grounding request.';
  }

  const { prerequisites, analysisConfiguration } = accepted;
  if (completion.serviceId !== prerequisites.serviceId) {
    return 'The analysis result identified a different Service than the one selected.';
  }
  if (
    completion.provider !== analysisConfiguration.provider ||
    completion.resolvedFrontierModel !==
      analysisConfiguration.resolvedFrontierModel
  ) {
    return 'The analysis result does not match the provider configuration that was accepted.';
  }
  if (
    completion.hierarchy.topLevels.some(
      (topLevel) => topLevel.children.length < 2,
    )
  ) {
    return 'The analysis result must provide at least two children for every top-level capability.';
  }

  return undefined;
}

@Injectable()
export class OnboardingRepositoryGroundingAnalysisNode extends ExternalAgentNodeBase<RepositoryImportFlowContext> {
  readonly id = REPOSITORY_IMPORT_NODES.ANALYSIS;
  readonly title = 'Repository capability analysis';
  readonly promptType = LocalPromptType.repository_grounding;
  readonly actions: ExternalAgentActionSchemas = repositoryGroundingActions;
  readonly acceptsUserMessages = true;

  private readonly logger = new Logger(
    OnboardingRepositoryGroundingAnalysisNode.name,
  );

  async buildTriggerMessage(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
  ): Promise<ExternalAgentTriggerMessage> {
    const context = tracker.getContext();
    const accepted = context.repositoryGrounding;
    if (!accepted) {
      throw new Error(
        'Repository-grounding analysis requires accepted prerequisites and configuration before it can start',
      );
    }

    const { prerequisites, analysisConfiguration } = accepted;
    const triggerPayload = {
      promptType: 'repository_grounding',
      projectId: context.core.projectId,
      conversationId: context.core.conversationId,
      workflowId: context.core.workflowId,
      workflowNodeId: this.id,
      entryMode: prerequisites.entryMode,
      serviceId: prerequisites.serviceId,
      confirmedServiceBrief: prerequisites.confirmedServiceBrief,
      machineId: prerequisites.machineId,
      scope: analysisConfiguration.scope,
      provider: analysisConfiguration.provider,
      resolvedFrontierModel: analysisConfiguration.resolvedFrontierModel,
      reasoningEffort: analysisConfiguration.reasoningEffort,
      ...(analysisConfiguration.fastMode === undefined
        ? {}
        : { fastMode: analysisConfiguration.fastMode }),
      bounds: analysisConfiguration.bounds,
    } satisfies RepositoryGroundingRequest;

    this.logger.debug('Repository-grounding trigger built', {
      conversationId: context.core.conversationId,
      projectId: context.core.projectId,
      serviceId: prerequisites.serviceId,
      machineId: prerequisites.machineId,
      scope: analysisConfiguration.scope.scope,
      provider: analysisConfiguration.provider,
      resolvedFrontierModel: analysisConfiguration.resolvedFrontierModel,
      reasoningEffort: analysisConfiguration.reasoningEffort,
      fastMode: analysisConfiguration.fastMode,
      // The repository path and source contents are intentionally absent.
      includesLocalPath: false,
      includesSourceBody: false,
    });

    const uiElements: UIElement[] = [
      {
        id: 'repository_grounding',
        type: ExtendedUIFieldType.RepositoryGrounding,
        label: 'Repository capability analysis',
        required: false,
        influences: [],
        payload: buildRepositoryGroundingFieldPayload(context, {
          phase: 'running',
          statusMessage:
            'Your paired machine is running the bounded repository analysis.',
        }),
      },
    ];

    return {
      response:
        'Your paired machine is running the bounded repository analysis. Hey Hey will show the evidence-backed result here when it completes.',
      uiElements,
      triggersAgent: {
        promptType: this.promptType,
        nodeId: this.id,
        payload: triggerPayload,
      },
      data: {
        detectedIntent: 'repository_grounding_started',
        intentConfidence: 1,
        reasoning:
          'A signed, machine-addressed repository-grounding request was emitted only after the explicit start gate.',
        ragEnabled: false,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    try {
      const answers = getRepositoryGroundingAnswers(userMessage);
      if (hasRepositoryGroundingTypedAnswers(answers)) {
        const { action } = parseRepositoryGroundingFormSubmission(answers);
        tracker.mutate((draft) => {
          if (action === 'START_ANALYSIS' || action === 'RETRY_ANALYSIS') {
            draft.repositoryGroundingCompletion = undefined;
            draft.repositoryGroundingPaused = false;
          } else if (action === 'FINISH_LATER') {
            draft.repositoryGroundingPaused = true;
          } else if (action === 'CONTINUE_CONVERSATION') {
            draft.repositoryGroundingPaused = undefined;
          }
        });
        return;
      }
    } catch (error) {
      if (error instanceof Error) {
        this.logger.warn('Repository-grounding user action rejected', {
          conversationId: tracker.getContext().core.conversationId,
          reason: error.message,
        });
        return;
      }
      throw error;
    }

    const data = (userMessage.data ?? {}) as Partial<ExternalAgentFlowData>;
    if (typeof data.action !== 'string') return;

    const completion = parseRepositoryGroundingCompletion(
      data.action,
      data.payload,
    );
    if (!completion) return;

    const context = tracker.getContext();
    if (
      data.action === REPOSITORY_GROUNDING_ACTIONS.SUCCESS &&
      completion.outcome === 'success'
    ) {
      const invalidReason = invalidSuccessCompletionReason(
        completion,
        context.repositoryGrounding,
      );
      if (invalidReason) {
        const invalidCompletion: RepositoryGroundingTerminalFailure = {
          outcome: 'terminal_failure',
          code: 'invalid_completion',
          message: `${invalidReason} Review the request and try again.`,
        };
        tracker.mutate((draft) => {
          draft.repositoryGroundingCompletion = invalidCompletion;
        });
        this.logger.error('Repository-grounding completion rejected', {
          conversationId: context.core.conversationId,
          reason: invalidReason,
          selectedServiceId:
            context.repositoryGrounding?.prerequisites.serviceId,
          completedServiceId: completion.serviceId,
          provider: completion.provider,
          resolvedFrontierModel: completion.resolvedFrontierModel,
        });
        return;
      }
    }

    tracker.mutate((draft) => {
      draft.repositoryGroundingCompletion = completion;
      if (completion.outcome === 'success') {
        draft.repositoryFeatureEnrichmentAcceptedAnalysis = completion;
        draft.repositoryGroundingBaseline = undefined;
        draft.repositoryFeatureEnrichmentCompletedRounds = 0;
        draft.repositoryFeatureEnrichmentAnswerBatches = [];
        draft.repositoryFeatureEnrichmentLatestOutcome = undefined;
        draft.repositoryFeatureEnrichmentFinal = undefined;
        draft.repositoryFeatureEnrichmentChoice = undefined;
        draft.repositoryFeatureEnrichmentReviewedCandidates = undefined;
      }
      draft.repositoryGroundingPaused = false;
    });

    this.logger.debug('Repository-grounding completion captured', {
      conversationId: context.core.conversationId,
      action: data.action,
      outcome: completion.outcome,
    });
  }

  async determineRoutingFromAgentCompletion(
    context: Readonly<RepositoryImportFlowContext>,
    action: string,
  ): Promise<string | undefined> {
    if (
      action === REPOSITORY_GROUNDING_ACTIONS.SUCCESS &&
      context.repositoryGroundingCompletion?.outcome === 'success'
    ) {
      return REPOSITORY_IMPORT_NODES.GENERATE_FEATURES;
    }
    if (
      action === REPOSITORY_GROUNDING_ACTIONS.RETRYABLE_FAILURE ||
      action === REPOSITORY_GROUNDING_ACTIONS.TERMINAL_FAILURE ||
      context.repositoryGroundingCompletion?.outcome !== 'success'
    ) {
      return REPOSITORY_IMPORT_NODES.RECOVERY;
    }
    return undefined;
  }

  async determineRoutingFromUserMessage(
    _context: Readonly<RepositoryImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<string> {
    try {
      const answers = getRepositoryGroundingAnswers(userMessage);
      if (!hasRepositoryGroundingTypedAnswers(answers)) return this.id;

      const { action } = parseRepositoryGroundingFormSubmission(answers);
      switch (action) {
        case 'START_ANALYSIS':
        case 'RETRY_ANALYSIS':
          return this.id;
        case 'FINISH_LATER':
          return REPOSITORY_IMPORT_NODES.RECOVERY;
        case 'CONTINUE_CONVERSATION':
          return REPOSITORY_IMPORT_NODES.RECOVERY;
        default:
          return this.id;
      }
    } catch (error) {
      if (error instanceof Error) return this.id;
      throw error;
    }
  }
}
