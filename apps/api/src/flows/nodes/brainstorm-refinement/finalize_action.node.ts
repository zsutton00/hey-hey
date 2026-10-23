import { Injectable, Logger } from '@nestjs/common';
import {
  BrainstormRefinementFlowContext,
  FinalizeActionData,
  NodeResult,
  NodeType,
} from '../../../types/flow-internal.types';
import { MutableContextHandle } from '../../../utils/mutable-context';
import { DesignDocService } from '../../../services/design-doc/design-doc.service';
import { ActionNodeBase } from '../base/';
import { BRAINSTORM_REFINEMENT_NODES } from '../../constants/node-ids';

@Injectable()
export class BrainstormRefinementFinalizeNode extends ActionNodeBase<BrainstormRefinementFlowContext> {
  readonly id = BRAINSTORM_REFINEMENT_NODES.FINALIZE_ACTION;
  readonly title = 'Finalizing Brainstorm refinement';

  private readonly logger = new Logger(BrainstormRefinementFinalizeNode.name);

  constructor(private designDocService: DesignDocService) {
    super();
  }

  async execute(
    tracker: MutableContextHandle<BrainstormRefinementFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    try {
      this.logger.debug(`[finalize_action] starting brainstorm finalization`, {
        designDocId: context.designDocId,
      });

      await this.designDocService.updateForAdapter(
        context.designDocId,
        { status: 'READY' },
        context.core.organizationId,
      );

      const finalizeData: FinalizeActionData = {
        type: 'REFINEMENT_COMPLETE',
        finalizationResult: {
          designDocId: context.designDocId,
          status: 'READY',
        },
        conversationId: context.core.conversationId,
      };

      return {
        type: NodeType.ACTION,
        message: 'Great! Your brainstorm is ready for the next step.',
        data: finalizeData,
      };
    } catch (error) {
      this.logger.error(`[finalize_action] Error finalizing brainstorm`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        designDocId: context.designDocId,
      });

      return {
        type: NodeType.ERROR,
        message:
          'Sorry, there was an issue finalizing your brainstorm. Please try again.',
        data: {
          errorType: 'finalization_error',
          context: error instanceof Error ? error.message : 'Unknown error',
          temporary: false,
          detectedIntent: 'finalization_error',
          intentConfidence: 1,
        },
      };
    }
  }
}
