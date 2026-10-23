import { Injectable } from '@nestjs/common';
import {
  InitiativeRefinementFlowContext,
  NodeResult,
  NodeType,
} from '../../../types/flow-internal.types';
import { initiativeRefinementFinalizeSchema } from '../../utils/shared-schemas';
import { GenerateNodeBase } from '../base/';
import { INITIATIVE_REFINEMENT_NODES } from '../../constants/node-ids';

/**
 * Initiative Refinement Finalize Node
 *
 * This node:
 * - Applies user feedback to create refined initiative version
 * - Documents exactly what changed and why
 * - Presents refined initiative for user confirmation
 * - Provides options to confirm, make more changes, or cancel
 */
@Injectable()
export class InitiativeRefinementFinalizeNode extends GenerateNodeBase<InitiativeRefinementFlowContext> {
  readonly id = INITIATIVE_REFINEMENT_NODES.FINALIZE_ACTION;
  readonly title = 'Finalize Initiative Changes';

  readonly promptConfig = {
    systemPromptTemplate: `You are finalizing changes to an initiative based on user feedback.

Your task:
1. Apply the user's feedback to create a refined version of the initiative
2. Document exactly what changed and why
3. Present the refined initiative for user confirmation
4. Provide options to confirm, make more changes, or cancel

Guidelines:
- Only change what the user specifically requested
- Preserve the original intent while incorporating feedback
- Be clear about what changed and why
- Make the changes summary easy to understand
- If no actual changes are needed, explain why

Respond with:
- detectedIntent: Based on user's likely next action
- response: Present the refined initiative and ask for confirmation
- refinedInitiative: The updated initiative with tracked changes
- changesSummary: Clear summary of what was modified
- uiElements: Confirmation options for the user`,

    nodeInstructions: `FINALIZE NODE INSTRUCTIONS:
- You MUST use type: "GENERATE" in your response
- Apply the user's feedback to create a refined version of the initiative
- Document exactly what changed and why with detailed change tracking
- Present the refined initiative for user confirmation
- Provide clear options to confirm, make more changes, or cancel
- Be honest about potential issues while remaining constructive
- Set detectedIntent based on user's likely next action`,

    responseSchema: initiativeRefinementFinalizeSchema,
    temperature: 0.3, // Lower temperature for more consistent refinements
  };
}
