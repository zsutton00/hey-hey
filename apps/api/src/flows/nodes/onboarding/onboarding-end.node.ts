import { Injectable } from '@nestjs/common';
import { FinalizeNodeBase } from '../base/';
import { ONBOARDING_NODES } from '../../constants/node-ids';
import {
  OnboardingFlowContext,
  NodeResult,
  NodeType,
} from '../../../types/flow-internal.types';

/**
 * Onboarding End Node - Terminal node in onboarding flow
 *
 * Emits a brief redirect acknowledgement after the user confirms the
 * finalize step. User-facing UI and the Complete Onboarding button live
 * on the finalize node; this node exists purely to terminate the flow.
 */
@Injectable()
export class OnboardingEndNode extends FinalizeNodeBase<OnboardingFlowContext> {
  readonly id = ONBOARDING_NODES.END;
  readonly title = 'Setup Complete';

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.FINALIZE,
      message: 'Redirecting…',
    };
  }
}
