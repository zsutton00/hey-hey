import { Injectable } from '@nestjs/common';
import {
  NodeResult,
  InitiativeRefinementFlowContext,
  NodeType,
} from '../../../types/flow-internal.types';
import { MutableContextHandle } from '../../../utils/mutable-context';
import { Influence } from '../../../generated';
import { InitiativeService } from '../../../services/initiatives/initiative.service';
import {
  getCurrentSectionFromStatus,
  getPreviousSectionFromStatus,
} from '../../../utils/work-item.util';
import { QuestionsNodeBase } from '../base/';
import { INITIATIVE_REFINEMENT_NODES } from '../../constants/node-ids';

const DEFAULT_MESSAGE =
  "Ok, we've made some updates. What would you like to do next?";

function getMessage(
  currentLevel: 'description' | 'details' | 'acceptanceCriteria',
  previousLevel: string,
): string {
  if (currentLevel === previousLevel) {
    return DEFAULT_MESSAGE;
  }
  switch (currentLevel) {
    case 'details':
      return "Great! We've got details now. These help define the particulars of this initiative. What do you think?";
    case 'acceptanceCriteria':
      return "Ok! We've got acceptance criteria now. Your acceptance criteria will define when this initiative is done. What are your thoughts?";
    default:
      return DEFAULT_MESSAGE;
  }
}

/**
 * Initiative Refinement Prompt Next Input Node
 *
 * This node:
 * - Prompts user for next action after updates
 * - Provides level-specific contextual messages
 * - Routes to classify_message for intent detection
 */
@Injectable()
export class InitiativeRefinementPromptNextInputNode extends QuestionsNodeBase<InitiativeRefinementFlowContext> {
  readonly id = INITIATIVE_REFINEMENT_NODES.PROMPT_INPUT;
  readonly title = 'Gather Initiative Feedback';

  constructor(private initiativeService: InitiativeService) {
    super();
  }

  async execute(
    tracker: MutableContextHandle<InitiativeRefinementFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    try {
      // Get current initiative
      const initiative = await this.initiativeService.findOne(
        context.initiativeId,
        context.core.organizationId,
      );

      if (!initiative) {
        throw new Error(`Initiative not found: ${context.initiativeId}`);
      }

      // Get current level from initiative status
      const currentLevel = getCurrentSectionFromStatus(initiative.status);
      const previousLevel = getPreviousSectionFromStatus(initiative.status);

      // Provide standard contextual message based on current level
      const message =
        context.flowPath.previousNode ===
        INITIATIVE_REFINEMENT_NODES.AGENT_EDITOR
          ? ''
          : getMessage(currentLevel, previousLevel);
      const uiElements = [
        {
          id: `what_next_${Date.now()}`,
          type: 'textarea' as const,
          label: 'What should we do next',
          influences: [] as Influence[],
        },
      ];

      return {
        type: NodeType.QUESTIONS,
        message,
        uiElements,
        data: {
          detectedIntent: '',
          intentConfidence: 0,
        },
      };
    } catch (error) {
      return {
        type: NodeType.ERROR,
        message:
          'There was an error processing your approval. Please try again.',
        data: {
          errorType: 'processing_error',
          context: error instanceof Error ? error.message : 'Unknown error',
          temporary: false,
          detectedIntent: 'processing_error',
          intentConfidence: 1,
        },
      };
    }
  }
}
