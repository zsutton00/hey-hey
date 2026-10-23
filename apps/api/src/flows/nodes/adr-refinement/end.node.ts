import { Injectable } from '@nestjs/common';
import {
  NodeResult,
  NodeType,
  FinalizeNodeBase,
  AdrRefinementFlowContext,
} from '../../../types/flow-internal.types';
import { ADR_REFINEMENT_NODES } from '../../constants/node-ids';

/**
 * ADR Refinement End Node - Terminal node for completed refinement
 */
@Injectable()
export class AdrRefinementEndNode extends FinalizeNodeBase<AdrRefinementFlowContext> {
  readonly id = ADR_REFINEMENT_NODES.END;
  readonly title = 'ADR Refinement Complete';

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.FINALIZE,
      message:
        'ADR refinement complete. Your Architecture Decision Record has been finalized and is ready for review!',
    };
  }
}
