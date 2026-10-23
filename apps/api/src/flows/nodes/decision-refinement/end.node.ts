import { Injectable } from '@nestjs/common';
import {
  DecisionRefinementFlowContext,
  FinalizeNodeBase,
  NodeResult,
  NodeType,
} from '../../../types/flow-internal.types';
import { DECISION_REFINEMENT_NODES } from '../../constants/node-ids';

@Injectable()
export class DecisionRefinementEndNode extends FinalizeNodeBase<DecisionRefinementFlowContext> {
  readonly id = DECISION_REFINEMENT_NODES.END;
  readonly title = 'Decision Refinement Complete';

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.FINALIZE,
      message:
        'Decision refinement complete. Your decision doc is ready for review!',
    };
  }
}
