import { Injectable } from '@nestjs/common';
import {
  BrainstormRefinementFlowContext,
  FinalizeNodeBase,
  NodeResult,
  NodeType,
} from '../../../types/flow-internal.types';
import { BRAINSTORM_REFINEMENT_NODES } from '../../constants/node-ids';

@Injectable()
export class BrainstormRefinementEndNode extends FinalizeNodeBase<BrainstormRefinementFlowContext> {
  readonly id = BRAINSTORM_REFINEMENT_NODES.END;
  readonly title = 'Brainstorm Refinement Complete';

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.FINALIZE,
      message:
        'Brainstorm refinement complete. Your brainstorm is ready for review!',
    };
  }
}
