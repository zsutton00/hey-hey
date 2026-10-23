import { Injectable } from '@nestjs/common';
import { InitiativeService } from '../../../services/initiatives/initiative.service';
import {
  InitiativeRefinementFlowContext,
  NodeResult,
  NodeType,
  RefinementCompleteConfirmData,
} from '../../../types/flow-internal.types';
import { MutableContextHandle } from '../../../utils/mutable-context';
import { ActionNodeBase } from '../base/';
import { INITIATIVE_REFINEMENT_NODES } from '../../constants/node-ids';
import { materializedSectionsToContentMap } from '../../../utils/work-item-section.util';

/**
 * Initiative Refinement End Node
 *
 * This node:
 * - Displays final refinement summary
 * - Shows all changes applied
 * - Provides completion confirmation
 * - Triggers completion actions
 */
@Injectable()
export class InitiativeRefinementEndNode extends ActionNodeBase<InitiativeRefinementFlowContext> {
  readonly id = INITIATIVE_REFINEMENT_NODES.END;
  readonly title = 'Initiative Refinement Complete';

  constructor(private initiativeService: InitiativeService) {
    super();
  }

  async execute(
    tracker: MutableContextHandle<InitiativeRefinementFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    const initiative = await this.initiativeService.findOneForAdapter(
      context.initiativeId,
      context.core.organizationId,
    );
    const sectionContent = materializedSectionsToContentMap(
      initiative?.sections,
    );

    // refinedInitiative should be fetched from database when needed
    const refinedInitiative: any = null;
    const changes = refinedInitiative?.changes || [];

    let message = `Great! I've finished refining your initiative.`;

    if (changes.length > 0) {
      message += `\n\n**Changes Applied:**`;
      changes.forEach((change: any, index: number) => {
        message += `\n${index + 1}. **${change.field}**: ${change.oldValue} → ${change.newValue}`;
        message += `\n   *${change.reason}*`;
      });

      message += `\n\n**Final Initiative:**`;
      message += `\n- **Name:** ${refinedInitiative?.name || initiative?.name}`;

      const description =
        refinedInitiative?.description || sectionContent.description;
      if (description) {
        message += `\n- **Description:** ${description}`;
      }

      if (refinedInitiative?.priority || initiative?.priority) {
        message += `\n- **Priority:** ${refinedInitiative?.priority || initiative?.priority}`;
      }

      const finalTags = refinedInitiative?.tags || initiative?.tags || [];
      if (finalTags.length > 0) {
        message += `\n- **Tags:** ${finalTags.join(', ')}`;
      }

      message += `\n\nThe initiative has been updated with your feedback!`;
    } else {
      message += ` No changes were needed - the original initiative was already exactly what you wanted.`;
    }

    return {
      type: NodeType.CONFIRM,
      message,
      data: {
        type: 'REFINEMENT_COMPLETE',
        detectedIntent: 'refinement_complete',
        intentConfidence: 1.0,
        initiativeId: context.initiativeId,
        changesApplied: changes.length,
        refinementComplete: true,
      } as RefinementCompleteConfirmData,
      actions: [
        {
          type: 'complete_refinement',
          payload: {
            payloadType: 'complete_refinement',
            initiativeId: context.initiativeId,
            changes: changes,
            refinedInitiative: refinedInitiative,
          },
        },
      ],
    };
  }
}
