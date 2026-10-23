import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ExtendedUIFieldType, UIElement } from 'src/generated';
import { LocalPromptType } from 'src/generated/local';
import {
  ExternalAgentActionSchemas,
  ExternalAgentNodeBase,
  ExternalAgentTriggerMessage,
  FeatureSyncFlowContext,
} from 'src/types/flow-internal.types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { FEATURE_SYNC_NODES } from '../../constants/node-ids';
import { featureSyncImplementActions } from './schemas';
import { ImplementRuntimeService } from './implement-runtime.service';

/**
 * Terminal `implement` EXTERNAL_AGENT node.
 *
 * Entered from `coding_plan.APPROVED`. On entry the engine emits a
 * SYSTEM trigger message (`data.triggersAgent.promptType =
 * implement`) so the CLI dispatches the registered IMPLEMENT handler.
 * The node has no routing consequences — `DONE` self-loops, so the
 * conversation parks here while the implement agent runs. Modeling END
 * as another EXTERNAL_AGENT keeps the conversation-driven-dispatch
 * invariant uniform: `currentNodeId` is never `null` and the workflow
 * never exits while implement work is in flight.
 *
 * No `processUserResponse` override is needed: the action self-loops and
 * carries no payload, so there is no flow-context state to mutate. The
 * engine validates the `DONE` completion against `featureSyncImplementActions`
 * via `resolveExternalAgentRouting` before re-entering the node.
 */
@Injectable()
export class FeatureSyncImplementNode extends ExternalAgentNodeBase<FeatureSyncFlowContext> {
  readonly id = FEATURE_SYNC_NODES.IMPLEMENT;
  readonly title = 'Feature Sync — Implement';

  readonly promptType = LocalPromptType.implement;

  readonly actions: ExternalAgentActionSchemas = featureSyncImplementActions;

  private readonly logger = new Logger(FeatureSyncImplementNode.name);

  constructor(private readonly runtime: ImplementRuntimeService) {
    super();
  }

  async buildTriggerMessage(
    tracker: MutableContextHandle<FeatureSyncFlowContext>,
  ): Promise<ExternalAgentTriggerMessage> {
    const context = tracker.getContext();
    await this.runtime.prepare(context);

    this.logger.debug('Feature sync implement node entered', {
      conversationId: context.core.conversationId,
      projectId: context.core.projectId,
      taskId: context.taskId,
    });

    const uiElements: UIElement[] = [
      {
        id: uuidv4(),
        type: ExtendedUIFieldType.AgentHidden,
        label: 'Feature Sync — Implement',
        required: false,
        influences: [],
      },
    ];

    return {
      response: '',
      uiElements,
      triggersAgent: {
        promptType: this.promptType,
        nodeId: this.id,
        ...(context.implementRuntime
          ? { payload: { runtime: context.implementRuntime } }
          : {}),
      },
      data: {
        detectedIntent: 'feature_sync_implement_started',
        intentConfidence: 1,
        reasoning:
          'External agent implementing the approved plan; node self-loops on DONE.',
        ragEnabled: false,
      },
    };
  }
}
