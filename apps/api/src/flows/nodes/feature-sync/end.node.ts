import { Injectable, Logger } from '@nestjs/common';
import {
  FeatureSyncFlowContext,
  FinalizeNodeBase,
  NodeResult,
  NodeType,
} from 'src/types/flow-internal.types';
import { FEATURE_SYNC_NODES } from '../../constants/node-ids';

/**
 * Terminal node of the feature-sync flow.
 *
 * Entered when the user engages with `coding-plan` (either typing a
 * message or pressing the "Let's go" secondary action). Completes the
 * workflow so subsequent user messages have no active workflow/node —
 * `resolveNodePromptType` returns null and `usePromptSubmission`'s
 * `?? LocalPromptType.StartupSession` fallback takes over, dispatching
 * to the CLI's startup-session handler.
 *
 * Emits no user-facing message; the coding-plan node already showed
 * the confirmation UI, so re-rendering here would duplicate that.
 */
@Injectable()
export class FeatureSyncEndNode extends FinalizeNodeBase<FeatureSyncFlowContext> {
  readonly id = FEATURE_SYNC_NODES.END;
  readonly title = 'Feature Sync Complete';

  private readonly logger = new Logger(FeatureSyncEndNode.name);

  async execute(): Promise<NodeResult> {
    this.logger.debug('Feature sync flow terminating');

    return {
      type: NodeType.FINALIZE,
      message: '',
    };
  }
}
