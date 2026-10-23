import { Injectable, Logger } from '@nestjs/common';
import type {
  RepositoryPlacementRequest,
  RepositoryPlacementSuccess,
} from 'src/generated';
import { LocalPromptType } from 'src/generated/local';
import {
  FeatureListLifecycleService,
  RepositoryPlacementValidationError,
} from '../../../services/feature-list/feature-list-lifecycle.service';
import {
  ExternalAgentActionSchemas,
  ExternalAgentFlowData,
  ExternalAgentNodeBase,
  ExternalAgentTriggerMessage,
  FlowUserMessage,
  MutableContextHandle,
  RepositoryImportFlowContext,
} from '../../../types/flow-internal.types';
import { REPOSITORY_IMPORT_NODES } from '../../constants/node-ids';
import {
  parseRepositoryPlacementCompletion,
  repositoryPlacementActions,
  REPOSITORY_PLACEMENT_ACTIONS,
} from './repository-grounding.contract';

@Injectable()
export class RepositoryGroundingPlacementNode extends ExternalAgentNodeBase<RepositoryImportFlowContext> {
  readonly id = REPOSITORY_IMPORT_NODES.PLACEMENT_AGENT;
  readonly title = 'Suggest imported Feature placement';
  readonly promptType = LocalPromptType.repository_placement;
  readonly actions: ExternalAgentActionSchemas = repositoryPlacementActions;
  readonly acceptsUserMessages = false;

  private readonly logger = new Logger(RepositoryGroundingPlacementNode.name);

  constructor(private readonly lifecycle: FeatureListLifecycleService) {
    super();
  }

  async buildTriggerMessage(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
  ): Promise<ExternalAgentTriggerMessage> {
    const context = tracker.getContext();
    const accepted = context.repositoryGrounding;
    const proposal = context.onboardingFeatureProposal;
    if (
      !accepted ||
      accepted.prerequisites.entryMode !== 'existing_project' ||
      proposal?.placementStrategy?.action !== 'INTELLIGENTLY_INTEGRATE'
    ) {
      throw new Error(
        'Intelligent placement requires an accepted existing-project repository import.',
      );
    }
    const candidates = this.lifecycle.toPlacementRoots(proposal);
    const { prerequisites, analysisConfiguration } = accepted;
    const payload = {
      promptType: 'repository_placement',
      projectId: context.core.projectId,
      conversationId: context.core.conversationId,
      workflowId: context.core.workflowId,
      workflowNodeId: this.id,
      serviceId: prerequisites.serviceId,
      machineId: prerequisites.machineId,
      provider: analysisConfiguration.provider,
      resolvedFrontierModel: analysisConfiguration.resolvedFrontierModel,
      reasoningEffort: analysisConfiguration.reasoningEffort,
      ...(analysisConfiguration.fastMode === undefined
        ? {}
        : { fastMode: analysisConfiguration.fastMode }),
      candidates,
      instructions: candidates.map((root) => ({
        rootKey: root.rootKey,
        instruction: `Select one parent for ${root.name}; preserve its children unchanged.`,
      })),
    } satisfies RepositoryPlacementRequest;

    return {
      response: '',
      uiElements: [],
      triggersAgent: { promptType: this.promptType, nodeId: this.id, payload },
      data: {
        detectedIntent: 'repository_placement_started',
        intentConfidence: 1,
        reasoning:
          'Existing-project imported roots are ready for parent suggestions.',
        ragEnabled: false,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    const data = (userMessage.data ?? {}) as Partial<ExternalAgentFlowData>;
    if (typeof data.action !== 'string') return;
    const completion = parseRepositoryPlacementCompletion(
      data.action,
      data.payload,
    );
    if (!completion) return;

    if (completion.outcome === 'success') {
      try {
        await this.lifecycle.applyPlacementSuggestions(
          this.toPlacementAssignments(completion),
          tracker,
          this.id,
        );
      } catch (error) {
        if (!(error instanceof RepositoryPlacementValidationError)) {
          throw error;
        }
        tracker.mutate((draft) => {
          draft.repositoryPlacementCompletion = {
            outcome: 'terminal_failure',
            code: 'invalid_completion',
            message:
              error instanceof Error
                ? error.message
                : 'Placement validation failed.',
          };
        });
        this.logger.warn('Repository placement completion rejected', {
          conversationId: tracker.getContext().core.conversationId,
          reason: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      tracker.mutate((draft) => {
        draft.repositoryPlacementCompletion = completion;
      });
      return;
    }

    tracker.mutate((draft) => {
      draft.repositoryPlacementCompletion = completion;
    });
  }

  async determineRoutingFromAgentCompletion(
    context: Readonly<RepositoryImportFlowContext>,
    action: string,
  ): Promise<string | undefined> {
    return action === REPOSITORY_PLACEMENT_ACTIONS.SUCCESS &&
      context.repositoryPlacementCompletion?.outcome === 'success'
      ? REPOSITORY_IMPORT_NODES.PLACEMENT_REVIEW
      : action === REPOSITORY_PLACEMENT_ACTIONS.RETRYABLE_FAILURE ||
          action === REPOSITORY_PLACEMENT_ACTIONS.TERMINAL_FAILURE ||
          context.repositoryPlacementCompletion?.outcome === 'terminal_failure'
        ? REPOSITORY_IMPORT_NODES.PLACEMENT_STRATEGY
        : undefined;
  }

  private toPlacementAssignments(completion: RepositoryPlacementSuccess) {
    return completion.placements.map((placement) => ({
      rootKey: placement.rootKey,
      target: placement.target,
      rationale: placement.rationale,
      confidence: placement.confidence,
    }));
  }
}
