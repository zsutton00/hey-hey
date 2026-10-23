import { Injectable } from '@nestjs/common';
import { UIElement } from '../../../generated';
import { DesignDocService } from '../../../services/design-doc/design-doc.service';
import { getCurrentSectionForTemplate } from '../../../types/design-doc.types';
import {
  BrainstormRefinementFlowContext,
  NodeResult,
  NodeType,
  OpenerNodeBase,
} from '../../../types/flow-internal.types';
import { MutableContextHandle } from '../../../utils/mutable-context';
import { BRAINSTORM_REFINEMENT_NODES } from '../../constants/node-ids';
import { uuid4 } from '@temporalio/workflow';

@Injectable()
export class BrainstormRefinementWelcomeNode extends OpenerNodeBase<BrainstormRefinementFlowContext> {
  readonly id = BRAINSTORM_REFINEMENT_NODES.WELCOME;
  readonly title = 'Brainstorm Refinement Welcome';

  constructor(private designDocService: DesignDocService) {
    super();
  }

  async execute(
    tracker: MutableContextHandle<BrainstormRefinementFlowContext>,
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

    if (!hasContent) {
      const uiElements: UIElement[] = [];
      if ((designDoc.summary?.length ?? 0) < 100) {
        uiElements.push({
          id: uuid4(),
          type: 'textarea',
          label: "Share the idea you're brainstorming",
          placeholder: 'What are you exploring or considering?',
          influences: [],
        });
      }
      return {
        type: NodeType.QUESTIONS,
        message:
          "Welcome! Let's capture the initial ideas for this brainstorm.",
        uiElements,
        data: {
          detectedIntent: 'agent triggered',
          intentConfidence: 1.0,
          reasoning: 'Brainstorm refinement session started',
        },
      };
    }

    const stageMessages = {
      content:
        "Let's brainstorm. Capture the ideas, options, and open questions you want to explore.",
      review:
        "This brainstorm session is in review. Let's make sure the key ideas are clear and complete.",
      ready:
        'This brainstorm session is marked ready. Any last tweaks before moving on?',
    };

    const currentStage = getCurrentSectionForTemplate(
      designDoc.template,
      designDoc.status,
    ) as keyof typeof stageMessages;

    const stageMessage = stageMessages[currentStage];

    if (!stageMessage) {
      throw new Error(
        `Unknown stage '${currentStage}' derived from design doc status '${designDoc.status}' ` +
          `for design doc ${context.designDocId}. Expected: content, review, or ready.`,
      );
    }

    return {
      type: NodeType.QUESTIONS,
      message: stageMessage,
      uiElements: [
        {
          id: 'brainstorm_feedback',
          type: 'textarea',
          label: 'What do you think?',
          placeholder:
            currentStage === 'content'
              ? 'Add ideas, alternatives, or open questions...'
              : 'Share any feedback or final changes...',
          required: false,
          influences: [],
        },
      ],
      actions: [],
      data: {
        detectedIntent: 'opener_displayed',
        intentConfidence: 1.0,
        reasoning: 'Brainstorm refinement session started',
        ragEnabled: false,
      },
    };
  }

  async determineRouting(
    _context: BrainstormRefinementFlowContext,
  ): Promise<string | undefined> {
    return BRAINSTORM_REFINEMENT_NODES.AGENT_ANALYSIS as string;
  }
}
