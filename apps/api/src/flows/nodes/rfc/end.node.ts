import { Injectable } from '@nestjs/common';
import { FinalizeNodeBase } from '../base';
import {
  FlowContext,
  NodeResult,
  NodeType,
} from '../../../types/flow-internal.types';
import { RFC_NODES } from '../../constants/node-ids';

/**
 * RFC End Node - Completes RFC creation flow
 *
 * Simple finalization node that marks the RFC creation process as complete.
 */
@Injectable()
export class RfcEndNode extends FinalizeNodeBase<FlowContext> {
  readonly id = RFC_NODES.END;
  readonly title = 'RFC Creation Complete';

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.FINALIZE,
      message: 'Your Request for Comments has been created successfully!',
    };
  }
}
