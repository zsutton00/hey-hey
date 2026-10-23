import { Injectable, Logger } from '@nestjs/common';
import {
  NodeResult,
  AdrRefinementFlowContext,
  NodeType,
  FinalizeActionData,
} from '../../../types/flow-internal.types';
import { MutableContextHandle } from '../../../utils/mutable-context';
import { DesignDocService } from '../../../services/design-doc/design-doc.service';
import { ActionNodeBase } from '../base/';
import { ADR_REFINEMENT_NODES } from '../../constants/node-ids';

/**
 * ADR Refinement Finalize Action Node
 *
 * Finalizes ADR refinement by setting status to APPROVED.
 */
@Injectable()
export class AdrRefinementFinalizeNode extends ActionNodeBase<AdrRefinementFlowContext> {
  readonly id = ADR_REFINEMENT_NODES.FINALIZE_ACTION;
  readonly title = 'Finalizing ADR refinement';

  private readonly logger = new Logger(AdrRefinementFinalizeNode.name);

  constructor(private designDocService: DesignDocService) {
    super();
  }

  async execute(
    tracker: MutableContextHandle<AdrRefinementFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    try {
      this.logger.debug(`[finalize_action] starting ADR finalization`, {
        designDocId: context.designDocId,
      });

      // Update design doc to APPROVED status (ready for use)
      await this.designDocService.updateForAdapter(
        context.designDocId,
        { status: 'APPROVED' },
        context.core.organizationId,
      );

      const finalizeData: FinalizeActionData = {
        type: 'REFINEMENT_COMPLETE',
        finalizationResult: {
          designDocId: context.designDocId,
          status: 'APPROVED',
        },
        conversationId: context.core.conversationId,
      };

      return {
        type: NodeType.ACTION,
        message:
          'Perfect! Your ADR refinement is now complete. The Architecture Decision Record is approved and ready for use.',
        data: finalizeData,
      };
    } catch (error) {
      this.logger.error(`[finalize_action] Error finalizing ADR`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        designDocId: context.designDocId,
      });

      return {
        type: NodeType.ERROR,
        message:
          'Sorry, there was an issue finalizing your ADR. Please try again.',
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
