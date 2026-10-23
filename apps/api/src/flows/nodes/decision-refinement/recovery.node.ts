import { Injectable } from '@nestjs/common';
import {
  DecisionRefinementFlowContext,
  NodeResult,
  NodeType,
  OpenerNodeBase,
} from '../../../types/flow-internal.types';
import { MutableContextHandle } from '../../../utils/mutable-context';
import { DECISION_REFINEMENT_NODES } from '../../constants/node-ids';

@Injectable()
export class DecisionRefinementRecoveryNode extends OpenerNodeBase<DecisionRefinementFlowContext> {
  readonly id = DECISION_REFINEMENT_NODES.RECOVERY;
  readonly title = 'Decision Refinement Recovery';

  async execute(
    _tracker: MutableContextHandle<DecisionRefinementFlowContext>,
  ): Promise<NodeResult> {
    return {
      type: NodeType.QUESTIONS,
      message: '',
      uiElements: [
        {
          id: 'decision_recovery_feedback',
          type: 'textarea',
          label:
            'Something went wrong, but we can continue. What would you like to do with this decision?',
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
