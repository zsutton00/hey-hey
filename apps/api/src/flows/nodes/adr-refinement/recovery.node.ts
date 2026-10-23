import { Injectable } from '@nestjs/common';
import {
  NodeResult,
  NodeType,
  OpenerNodeBase,
  AdrRefinementFlowContext,
} from '../../../types/flow-internal.types';
import { MutableContextHandle } from '../../../utils/mutable-context';
import { ADR_REFINEMENT_NODES } from '../../constants/node-ids';

/**
 * ADR Refinement Recovery Node - Handles error recovery
 */
@Injectable()
export class AdrRefinementRecoveryNode extends OpenerNodeBase<AdrRefinementFlowContext> {
  readonly id = ADR_REFINEMENT_NODES.RECOVERY;
  readonly title = 'ADR Refinement Recovery';

  async execute(
    _tracker: MutableContextHandle<AdrRefinementFlowContext>,
  ): Promise<NodeResult> {
    return {
      type: NodeType.QUESTIONS,
      message: '',
      uiElements: [
        {
          id: 'adr_recovery_feedback',
          type: 'textarea',
          label:
            'Something went wrong, but we can continue. What would you like to do with this ADR?',
          placeholder: 'Share your feedback or continue refining...',
          required: false,
          influences: [],
        },
      ],
      actions: [],
      data: {
        detectedIntent: 'opener_displayed',
        intentConfidence: 1.0,
        ragEnabled: false,
      },
    };
  }
}
