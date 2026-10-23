import { Injectable } from '@nestjs/common';
import { QuestionsNodeBase } from '../base/';
import { ONBOARDING_NODES } from '../../constants/node-ids';
import {
  RepositoryImportFlowContext,
  NodeResult,
  NodeType,
} from '../../../types/flow-internal.types';
import { ExtendedUIFieldType } from 'src/generated';
import { MutableContext } from 'src/utils/mutable-context';
import { OnboardingNextStepsService } from '../../../services/onboarding-next-steps.service';

/**
 * Onboarding Finalize Node
 *
 * Saves the Help "Where to start" suggestions, then presents the completion
 * message with the Complete Onboarding button and pauses for user
 * confirmation before advancing to the terminal node. Suggestions are saved
 * here, after Feature approval and before the Complete button activates the
 * Project, so Help reads them on its first load.
 */
@Injectable()
export class OnboardingFinalizeNode extends QuestionsNodeBase<RepositoryImportFlowContext> {
  readonly id = ONBOARDING_NODES.FINALIZE;
  readonly title = 'Setup Complete';

  // Free-text user messages here have no meaningful effect: the only valid
  // action is clicking the CompleteOnboarding UI field button. Setting this
  // false makes MessageProcessor.handleUserMessageCreated skip
  // signalWorkflow when a user posts text while paused on this node.
  readonly acceptsUserMessages = false;

  constructor(private readonly nextStepsService: OnboardingNextStepsService) {
    super();
  }

  async execute(
    tracker: MutableContext<RepositoryImportFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    await this.nextStepsService.generateAndRecord({
      organizationId: context.core.organizationId,
      projectId: context.core.projectId,
      conversationId: context.core.conversationId,
      workflowId: context.core.workflowId,
      userId: context.core.user.id,
      mockLlmSessionId: context.mockLlmSessionId,
      nodeId: this.id,
      materializedFeatureIds:
        context.repositoryImportMaterializedFeatureIds ?? [],
    });

    return {
      type: NodeType.QUESTIONS,
      message:
        'Perfect! Your project is all set up. You have a clear roadmap with plans or initiatives, your team is configured, and your workspace is ready to help you succeed.',
      data: {
        detectedIntent: 'flow_complete',
        intentConfidence: 1.0,
      },
      uiElements: [
        {
          id: 'complete_onboarding',
          type: ExtendedUIFieldType.CompleteOnboarding,
          label: 'Ready to get started!',
          required: true,
          influences: [],
        },
      ],
    };
  }
}
