import { Injectable } from '@nestjs/common';
import { AgentEdgeEndpointEntityType } from '../../../generated/graphs';
import { PendingEdgeService } from '../../../services/proposal/pending-edge.service';
import { CreateTaskDto } from '../../../generated';
import { TaskService } from '../../../services/tasks/task.service';
import {
  ActionNodeBase,
  CompensationContext,
  CompensationResult,
  NodeResult,
  NodeType,
  OnboardingFlowContext,
} from '../../../types/flow-internal.types';
import { PlanId, UserId } from '../../../types';
import { MutableContextHandle } from '../../../utils/mutable-context';
import { SHARED_NODES } from '../../constants/node-ids';

class OnboardingPlanLinkingError extends Error {
  constructor(
    readonly createdPlanIds: PlanId[],
    readonly failedPlanId: PlanId,
    readonly originalError: Error,
  ) {
    super(
      `Failed to link onboarding conversation to plan ${failedPlanId}: ${originalError.message}`,
    );
    this.name = 'OnboardingPlanLinkingError';
  }
}

@Injectable()
export class OnboardingCreatePlansNode extends ActionNodeBase<OnboardingFlowContext> {
  readonly id = SHARED_NODES.CREATE_PLANS;
  readonly title = 'Create Accepted Plans';

  constructor(
    private readonly taskService: TaskService,
    private readonly pendingEdges: PendingEdgeService,
  ) {
    super();
  }

  async execute(
    tracker: MutableContextHandle<OnboardingFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    const userId = context.core.user?.id as UserId | undefined;
    if (!userId) {
      throw new Error(
        'Missing user id in onboarding context for plan creation.',
      );
    }
    const conversationId = context.core.conversationId;
    if (!conversationId) {
      throw new Error(
        'Missing conversation id in onboarding context for plan linking.',
      );
    }

    const proposal = context.onboardingPlanProposal;
    if (!proposal?.candidates.length) {
      throw new Error(
        'No onboarding plan proposal candidates available to create plans.',
      );
    }

    const acceptedCandidateIds = proposal.acceptedCandidateIds ?? [];
    if (!acceptedCandidateIds.length) {
      throw new Error(
        'No accepted plan candidates found for onboarding plan creation.',
      );
    }

    const acceptedCandidates = proposal.candidates.filter((candidate) =>
      acceptedCandidateIds.includes(candidate.id),
    );
    if (!acceptedCandidates.length) {
      throw new Error(
        'Accepted plan candidates could not be resolved from the latest proposal round.',
      );
    }

    const createdPlanIds: PlanId[] = [];
    for (const candidate of acceptedCandidates) {
      const createPlanDto = {
        name: candidate.title,
        type: 'PLAN',
        assigneeId: userId,
        sections: [
          { key: 'description', content: candidate.description },
          { key: 'outcome', content: candidate.outcome },
          {
            key: 'planConfiguration',
            content: {
              schemaVersion: 'plan-configuration.v1',
              planType: 'STANDARD',
              worktreeBranch: null,
            },
          },
        ],
      } satisfies CreateTaskDto;
      const createdPlan = await this.taskService.create(
        context.core.organizationId,
        undefined,
        createPlanDto,
        context.core.projectId,
      );
      const createdPlanId = createdPlan.id as PlanId;
      createdPlanIds.push(createdPlanId);

      try {
        await this.pendingEdges.materializeEdges(
          context.core.organizationId,
          context.core.projectId,
          [
            {
              sourceEntityId: createdPlanId,
              sourceEntityType: AgentEdgeEndpointEntityType.Task,
              targetEntityId: conversationId,
              targetEntityType: AgentEdgeEndpointEntityType.Conversation,
              edgeType: 'RELATED_TO',
            },
          ],
          conversationId,
        );
      } catch (error) {
        const originalError =
          error instanceof Error
            ? error
            : new Error(`Unknown relationship linking error: ${String(error)}`);
        throw new OnboardingPlanLinkingError(
          createdPlanIds,
          createdPlanId,
          originalError,
        );
      }
    }

    tracker.mutate((draft) => {
      if (!draft.onboardingPlanProposal) {
        return;
      }
      draft.onboardingPlanProposal.feedbackError = undefined;
    });

    return {
      type: NodeType.ACTION,
      message: `Created ${createdPlanIds.length} accepted plan${createdPlanIds.length === 1 ? '' : 's'} from the latest proposal round.`,
      data: {
        type: 'ACTION_COMPLETE',
        detectedIntent: 'onboarding_plans_created',
        intentConfidence: 1,
        createdPlanIds,
      },
    };
  }

  async compensate(
    context: Readonly<OnboardingFlowContext>,
    error: Error,
    _compensationContext: CompensationContext,
  ): Promise<CompensationResult> {
    if (error instanceof OnboardingPlanLinkingError) {
      return {
        action: 'FAIL',
        reason: `Created ${error.createdPlanIds.length} onboarding plan(s), but failed to link plan ${error.failedPlanId} to conversation ${context.core.conversationId}. Plans remain persisted and can be linked manually.`,
      };
    }

    return {
      action: 'FAIL',
      reason:
        'Onboarding plan creation failed. Automatic retry is disabled to avoid duplicate plan creation.',
    };
  }
}
