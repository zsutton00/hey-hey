import { Injectable } from '@nestjs/common';
import {
  BrainstormRefinementFlowContext,
  NodeResult,
  NodeType,
  OpenerNodeBase,
} from '../../../types/flow-internal.types';
import { MutableContextHandle } from '../../../utils/mutable-context';
import { BRAINSTORM_REFINEMENT_NODES } from '../../constants/node-ids';

@Injectable()
export class BrainstormRefinementRecoveryNode extends OpenerNodeBase<BrainstormRefinementFlowContext> {
  readonly id = BRAINSTORM_REFINEMENT_NODES.RECOVERY;
  readonly title = 'Brainstorm Refinement Recovery';

  async execute(
    _tracker: MutableContextHandle<BrainstormRefinementFlowContext>,
  ): Promise<NodeResult> {
    return {
      type: NodeType.QUESTIONS,
      message: '',
      uiElements: [
        {
          id: 'brainstorm_recovery_feedback',
          type: 'textarea',
          label:
            'Something went wrong, but we can continue. What would you like to do with this brainstorm?',
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
