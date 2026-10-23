import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ExtendedUIFieldType, UIElement } from 'src/generated';
import { FeatureSyncIteratePromptPayload } from 'src/generated';
import { LocalPromptType } from 'src/generated/local';
import {
  ExternalAgentActionSchemas,
  ExternalAgentFlowData,
  ExternalAgentNodeBase,
  ExternalAgentTriggerMessage,
  FeatureSyncFlowContext,
  FlowUserMessage,
} from 'src/types/flow-internal.types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { FEATURE_SYNC_NODES } from '../../constants/node-ids';
import {
  FEATURE_SYNC_ACTIONS,
  featureSyncIterateActions,
  parseDiscrepancyPayload,
} from './schemas';

/**
 * `iterate` EXTERNAL_AGENT node.
 *
 * Entered from `analyze.DISCREPANCY` with the discrepancies already
 * stashed on the flow context. On entry it emits a SYSTEM trigger
 * message (`data.triggersAgent.promptType = FEATURE_SYNC_ITERATE`);
 * the CLI agent reasons over the stashed discrepancies (and any user
 * guidance carried with the turn) and emits exactly one of:
 *
 * - `RESOLVED` — outstanding discrepancies have been addressed; the
 *   flow terminates.
 * - `REVISED { discrepancies: [...] }` — the agent produced a fresh set
 *   of discrepancies; the flow self-loops for another iteration.
 *
 * The rationale for splitting `iterate` out from `analyze` (rather than
 * looping a single EXTERNAL_AGENT node) is that each re-entry scopes the
 * agent's system prompt to this narrow job. The prompt does not swell
 * across turns, and the agent cannot drift back into re-analyzing the
 * entire feature tree.
 */
@Injectable()
export class FeatureSyncIterateNode extends ExternalAgentNodeBase<FeatureSyncFlowContext> {
  readonly id = FEATURE_SYNC_NODES.ITERATE;
  readonly title = 'Feature Sync — Iterate';

  readonly promptType = LocalPromptType.feature_sync_iterate;

  readonly actions: ExternalAgentActionSchemas = featureSyncIterateActions;

  private readonly logger = new Logger(FeatureSyncIterateNode.name);

  async buildTriggerMessage(
    tracker: MutableContextHandle<FeatureSyncFlowContext>,
  ): Promise<ExternalAgentTriggerMessage> {
    const context = tracker.getContext();
    const discrepancies = context.featureSyncDiscrepancies ?? [];

    if (discrepancies.length === 0) {
      throw new Error(
        'feature_sync_iterate requires context.featureSyncDiscrepancies — iterate cannot run with no outstanding items',
      );
    }

    this.logger.debug('Feature sync iterate node entered', {
      conversationId: context.core.conversationId,
      outstandingDiscrepancies: discrepancies.length,
    });

    const uiElements: UIElement[] = [
      {
        id: uuidv4(),
        type: ExtendedUIFieldType.AgentHidden,
        label: 'Feature Sync — Iterate',
        required: false,
        influences: [],
      },
    ];

    // The flow-context FeatureSyncDiscrepancy uses a string-literal entityType
    // union while the generated wire type expects the corresponding enum. The
    // string values are identical, so cast at the wire boundary.
    const triggerPayload: FeatureSyncIteratePromptPayload = {
      discrepancies:
        discrepancies as FeatureSyncIteratePromptPayload['discrepancies'],
    };

    this.logger.debug('Feature sync iterate trigger payload built', {
      conversationId: context.core.conversationId,
      fields: Object.keys(triggerPayload),
    });

    return {
      response:
        'Working through the surfaced discrepancies. Will either resolve them or surface a revised set for another pass.',
      uiElements,
      triggersAgent: {
        promptType: this.promptType,
        nodeId: this.id,
        payload: triggerPayload,
      },
      data: {
        detectedIntent: 'feature_sync_iterate_started',
        intentConfidence: 1,
        reasoning: 'External agent iterating on feature-sync discrepancies.',
        ragEnabled: false,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<FeatureSyncFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    // processUserResponse runs BEFORE engine-side validation; only mutate
    // context on the two actions the engine's Zod schemas accept.
    const data = (userMessage.data ?? {}) as Partial<ExternalAgentFlowData>;

    if (data.action === FEATURE_SYNC_ACTIONS.RESOLVED) {
      tracker.mutate((draft) => {
        draft.featureSyncDiscrepancies = undefined;
        draft.featureSyncResolved = true;
      });
      this.logger.debug('Feature sync iterate resolved', {
        conversationId: tracker.getContext().core.conversationId,
      });
      return;
    }

    if (data.action === FEATURE_SYNC_ACTIONS.REVISED) {
      const revised = parseDiscrepancyPayload(data.payload);
      if (!revised) {
        return;
      }
      tracker.mutate((draft) => {
        draft.featureSyncDiscrepancies = revised;
        draft.featureSyncResolved = false;
      });
      this.logger.debug('Feature sync iterate revised discrepancies', {
        conversationId: tracker.getContext().core.conversationId,
        discrepancyCount: revised.length,
      });
    }
  }
}
