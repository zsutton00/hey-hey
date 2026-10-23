import { Injectable } from '@nestjs/common';
import { SystemMessageResponseType, UIElement } from '../../../generated';
import { DesignDocService } from '../../../services/design-doc/design-doc.service';
import { getCurrentSectionFromStatus } from '../../../types/design-doc.types';
import {
  AdrRefinementFlowContext,
  NodeResult,
  NodeType,
  OpenerNodeBase,
} from '../../../types/flow-internal.types';
import { MutableContextHandle } from '../../../utils/mutable-context';
import { ADR_REFINEMENT_NODES } from '../../constants/node-ids';
import { uuid4 } from '@temporalio/workflow';

/**
 * ADR Refinement Welcome Node - Shows the ADR and asks for initial feedback
 */
@Injectable()
export class AdrRefinementWelcomeNode extends OpenerNodeBase<AdrRefinementFlowContext> {
  readonly id = ADR_REFINEMENT_NODES.WELCOME;
  readonly title = 'ADR Refinement Welcome';

  constructor(private designDocService: DesignDocService) {
    super();
  }

  async execute(
    tracker: MutableContextHandle<AdrRefinementFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    const designDoc = await this.designDocService.findOneForAdapter(
      context.designDocId,
      context.core.organizationId,
    );

    if (!designDoc) {
      return {
        type: NodeType.ERROR,
        message: 'Design document not found. Please try again.',
        data: {
          errorType: 'missing_data',
          context: 'design_doc_not_loaded',
          temporary: true,
          ragEnabled: false,
          detectedIntent: 'design_doc_missing',
          intentConfidence: 1,
        },
      };
    }

    const hasContent = (designDoc.sections ?? []).some(
      (s) => !!s.materializedMarkdown,
    );

    // No content path: Show simple message and route to starting agent
    if (!hasContent) {
      const uiElements: UIElement[] = [];
      if ((designDoc.summary?.length ?? 0) < 100) {
        uiElements.push({
          id: uuid4(),
          type: 'textarea',
          label: "Tell me what you're thinking about...",
          placeholder: 'Why is the decision necessary?',
          influences: [],
        });
      }
      return {
        type: NodeType.QUESTIONS,
        message:
          "Welcome! I'm gathering context to help you get started with this ADR...",
        uiElements,
        data: {
          detectedIntent: 'agent triggered',
          intentConfidence: 1.0,
          reasoning: 'ADR refinement session started',
        },
      };
    }

    // Content path: Show level-specific welcome message with UI elements
    const levelMessages = {
      context:
        "Let's review and refine the context of this Architecture Decision Record. This section should capture the background, problem, and forces influencing the decision.",
      decision:
        "Now let's work on documenting the decision itself. This section should clearly state what was decided and why.",
      consequences:
        "Finally, let's define the consequences of this decision. This section should capture both the positive outcomes and any trade-offs or risks.",
      review:
        "This ADR is ready for final review. Let's ensure all sections are complete and accurate.",
    };

    const currentLevel = getCurrentSectionFromStatus(
      designDoc.status,
    ) as keyof typeof levelMessages;

    const levelMessage = levelMessages[currentLevel];

    if (!levelMessage) {
      throw new Error(
        `Unknown currentLevel '${currentLevel}' derived from design doc status '${designDoc.status}' ` +
          `for design doc ${context.designDocId}. Expected: context, decision, consequences, or review.`,
      );
    }

    return {
      type: NodeType.QUESTIONS,
      message: levelMessage,
      uiElements: [
        {
          id: 'adr_feedback',
          type: 'textarea',
          label: 'What do you think?',
          placeholder:
            currentLevel === 'context'
              ? 'Share your thoughts on the background, problem statement, or forces that led to this decision...'
              : currentLevel === 'decision'
                ? 'Share your thoughts on the decision itself, the chosen approach, or the rationale...'
                : currentLevel === 'consequences'
                  ? 'Share your thoughts on the positive outcomes, trade-offs, risks, or follow-up actions...'
                  : 'Share your final thoughts on this ADR before approval...',
          required: false,
          influences: [],
        },
      ],
      actions: [],
      data: {
        detectedIntent: 'opener_displayed',
        intentConfidence: 1.0,
        reasoning: 'ADR refinement session started',
        ragEnabled: false,
      },
    };
  }

  /**
   * Route to starting agent if ADR has no content yet
   * Returns explicit node IDs based on content status
   */
  async determineRouting(
    context: AdrRefinementFlowContext,
  ): Promise<string | undefined> {
    // Fetch design doc to check content status
    const designDoc = await this.designDocService.findOneForAdapter(
      context.designDocId,
      context.core.organizationId,
    );

    const hasContent = (designDoc?.sections ?? []).some(
      (s) => !!s.materializedMarkdown,
    );

    // Route to starting agent if no content
    if (!hasContent) {
      return ADR_REFINEMENT_NODES.STARTING_AGENT as string;
    }

    return ADR_REFINEMENT_NODES.AGENT_ANALYSIS as string;
  }
}
