import { Injectable } from '@nestjs/common';
import { InitiativeService } from '../../../services/initiatives/initiative.service';
import { SystemMessageResponseType } from '../../../generated';
import {
  NodeResult,
  InitiativeRefinementFlowContext,
  NodeType,
} from '../../../types/flow-internal.types';
import { MutableContextHandle } from '../../../utils/mutable-context';
import { QuestionsNodeBase } from '../base/';
import { INITIATIVE_REFINEMENT_NODES } from '../../constants/node-ids';

/**
 * Initiative Refinement Recovery Node
 *
 * This node:
 * - Recovers from errors in the refinement flow
 * - Shows initiative details and prompts for feedback (like welcome)
 * - Provides error-aware messaging
 * - Routes to classify_message for intent detection
 */
@Injectable()
export class InitiativeRefinementRecoveryNode extends QuestionsNodeBase<InitiativeRefinementFlowContext> {
  readonly id = INITIATIVE_REFINEMENT_NODES.RECOVERY;
  readonly title = 'Initiative Refinement Recovery';

  constructor(private initiativeService: InitiativeService) {
    super();
  }

  async execute(
    tracker: MutableContextHandle<InitiativeRefinementFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    const initiative = await this.initiativeService.findOne(
      context.initiativeId,
      context.core.organizationId,
    );

    if (!initiative) {
      return {
        type: NodeType.ERROR,
        message: 'Initiative data not found. Please try again.',
        data: {
          errorType: 'missing_data',
          context: 'initiative_not_loaded',
          temporary: true,
          detectedIntent: 'initiative_missing',
          intentConfidence: 1,
        },
      };
    }

    // Get current level from initiative status
    const getCurrentLevelFromStatus = (
      status: string,
    ): 'description' | 'details' | 'acceptanceCriteria' => {
      switch (status) {
        case 'REFINING_DESCRIPTION':
          return 'description';
        case 'REFINING_DETAILS':
          return 'details';
        case 'REFINING_ACCEPTANCE_CRITERIA':
          return 'acceptanceCriteria';
        default:
          return 'description'; // Default for PLANNING or other statuses
      }
    };

    // Create level-specific welcome message
    const levelMessages = {
      description:
        "Let's review the high-level description of this initiative.",
      details:
        "Now let's work on the technical details and implementation approach.",
      acceptanceCriteria:
        "Finally, let's define the acceptance criteria and validation requirements.",
    };

    const currentLevel = getCurrentLevelFromStatus(initiative.status);
    const levelMessage = levelMessages[currentLevel];
    if (!levelMessage) {
      throw new Error(
        `Unknown currentLevel '${currentLevel}' derived from initiative status '${initiative.status}' ` +
          `for initiative ${context.initiativeId}. Expected: description, details, or acceptanceCriteria.`,
      );
    }

    return {
      type: NodeType.QUESTIONS,
      message: '',
      uiElements: [
        {
          id: 'initiative_intro',
          type: 'initiative_intro',
          label: `Sorry about that! ${levelMessage} What would you like to change or improve?`,
          placeholder:
            currentLevel === 'description'
              ? 'Share your thoughts on the initiative name, description, scope, or priority...'
              : currentLevel === 'details'
                ? 'Share your thoughts on the technical approach, resources, timeline, or implementation details...'
                : 'Share your thoughts on the acceptance criteria, testing approach, or validation requirements...',
          required: false,
          influences: [],
        },
      ],
      actions: [],
      data: {
        detectedIntent: 'opener_displayed',
        intentConfidence: 1.0,
        reasoning: initiative.reasoning ?? undefined,
      },
    };
  }
}
