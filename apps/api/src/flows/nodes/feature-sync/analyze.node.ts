import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ExtendedUIFieldType, UIElement } from 'src/generated';
import { FeatureSyncAnalyzePromptPayload } from 'src/generated';
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
import { UserMessageExtractor } from 'src/utils/user-message-extractor';
import { FEATURE_SYNC_NODES } from '../../constants/node-ids';
import {
  FEATURE_SYNC_ACTIONS,
  featureSyncAnalyzeActions,
  parseImplementationReadinessPayload,
  parseDiscrepancyPayload,
} from './schemas';

/**
 * `analyze` EXTERNAL_AGENT node.
 *
 * On entry it emits a SYSTEM conversation message carrying a structured
 * `data.triggersAgent` marker (`promptType: FEATURE_SYNC_ANALYZE`) that
 * instructs the CLI agent to walk the feature tree for the session's
 * task, search cross-subtree for related features, consult task
 * provenance, and emit exactly one of two action messages:
 *
 * - `NO_DISCREPANCY` — no drift detected; the flow terminates.
 * - `DISCREPANCY { discrepancies: [...] }` — drift detected; the flow
 *   routes to the `iterate` EXTERNAL_AGENT node to resolve them.
 *
 * The trigger message travels the same MessageService path as POST
 * /message, so conversation.updated fan-out covers both directions
 * uniformly. The completion-message's payload is validated against
 * `featureSyncAnalyzeActions` by the engine before routing
 * (src/workflows/activities.ts:resolveExternalAgentRouting). On
 * DISCREPANCY we stash the discrepancies onto the flow context so
 * `iterate` can work from them without re-invoking analyze.
 */
@Injectable()
export class FeatureSyncAnalyzeNode extends ExternalAgentNodeBase<FeatureSyncFlowContext> {
  readonly id = FEATURE_SYNC_NODES.ANALYZE;
  readonly title = 'Feature Sync — Analyze';

  readonly promptType = LocalPromptType.feature_sync_analyze;

  readonly actions: ExternalAgentActionSchemas = featureSyncAnalyzeActions;

  private readonly logger = new Logger(FeatureSyncAnalyzeNode.name);

  async buildTriggerMessage(
    tracker: MutableContextHandle<FeatureSyncFlowContext>,
  ): Promise<ExternalAgentTriggerMessage> {
    const context = tracker.getContext();
    const pendingUserReply = context.featureSyncPendingUserReply?.trim() ?? '';
    const initialPrompt = context.featureSyncInitialPrompt?.trim() ?? '';
    const userMessage = pendingUserReply || initialPrompt;

    if (!context.taskId) {
      throw new Error(
        'feature_sync_analyze requires context.taskId — analyze cannot be triggered without an anchoring task',
      );
    }

    this.logger.debug('Feature sync analyze node entered', {
      conversationId: context.core.conversationId,
      projectId: context.core.projectId,
      taskId: context.taskId,
      initiativeId: context.initiativeId,
      hasInitialPrompt: initialPrompt.length > 0,
      hasPendingUserReply: pendingUserReply.length > 0,
    });

    const uiElements: UIElement[] = [
      {
        id: uuidv4(),
        type: ExtendedUIFieldType.AgentResponse,
        label: 'Feature Sync — Analyze',
        required: false,
        influences: [],
      },
    ];

    const triggerPayload: FeatureSyncAnalyzePromptPayload = {
      taskId: context.taskId,
    };
    if (userMessage) {
      triggerPayload.userMessage = userMessage;
    }
    if (pendingUserReply) {
      tracker.mutate((draft) => {
        draft.featureSyncPendingUserReply = undefined;
      });
    }

    this.logger.debug('Feature sync analyze trigger payload built', {
      conversationId: context.core.conversationId,
      fields: Object.keys(triggerPayload),
    });

    return {
      response: 'Getting started...',
      uiElements,
      triggersAgent: {
        promptType: this.promptType,
        nodeId: this.id,
        payload: triggerPayload,
      },
      data: {
        detectedIntent: 'feature_sync_analyze_started',
        intentConfidence: 1,
        reasoning:
          'External agent analyzing feature tree for drift before session startup.',
        ragEnabled: false,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<FeatureSyncFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    // processUserResponse runs BEFORE the engine's EXTERNAL_AGENT validator
    // (src/workflows/activities.ts:processNodeResponse), so guard context
    // mutation on exactly the two actions the engine will accept. Any other
    // value falls through untouched and the engine will throw below.
    const data = (userMessage.data ?? {}) as Partial<ExternalAgentFlowData>;

    if (data.action === undefined) {
      const reply = UserMessageExtractor.extractContentFromData(userMessage.data, '').trim();
      if (reply.length > 0) {
        tracker.mutate((draft) => {
          draft.featureSyncPendingUserReply = reply;
        });
        this.logger.debug('Feature sync analyze clarification captured', {
          conversationId: tracker.getContext().core.conversationId,
          replyLength: reply.length,
        });
      }
      return;
    }

    if (data.action === FEATURE_SYNC_ACTIONS.DISCREPANCY) {
      const discrepancies = parseDiscrepancyPayload(data.payload);
      if (!discrepancies) {
        return;
      }
      tracker.mutate((draft) => {
        draft.featureSyncDiscrepancies = discrepancies;
        draft.featureSyncResolved = false;
      });
      this.logger.debug('Feature sync analyze discrepancies captured', {
        conversationId: tracker.getContext().core.conversationId,
        discrepancyCount: discrepancies.length,
      });
      return;
    }

    if (data.action === FEATURE_SYNC_ACTIONS.NO_DISCREPANCY) {
      tracker.mutate((draft) => {
        draft.featureSyncDiscrepancies = undefined;
        draft.featureSyncResolved = true;
      });
      this.logger.debug('Feature sync analyze no discrepancies', {
        conversationId: tracker.getContext().core.conversationId,
      });
    }

    if (
      data.action === FEATURE_SYNC_ACTIONS.READINESS_CLEAR ||
      data.action === FEATURE_SYNC_ACTIONS.READINESS_REVIEW_REQUIRED
    ) {
      const disposition = parseImplementationReadinessPayload(data.payload);
      if (!disposition) {
        this.logger.warn('Feature sync analyze readiness payload rejected', {
          conversationId: tracker.getContext().core.conversationId,
          action: data.action,
        });
        return;
      }
      const expectedState =
        data.action === FEATURE_SYNC_ACTIONS.READINESS_CLEAR
          ? 'CLEAR'
          : 'REVIEW_REQUIRED';
      if (disposition.state !== expectedState) {
        this.logger.warn('Feature sync analyze readiness action/state mismatch', {
          conversationId: tracker.getContext().core.conversationId,
          action: data.action,
          state: disposition.state,
        });
        return;
      }
      tracker.mutate((draft) => {
        draft.implementationReadiness = disposition;
        draft.implementationReadinessSourceMessageId = userMessage.id;
      });
      this.logger.log('Feature sync analyze readiness captured', {
        conversationId: tracker.getContext().core.conversationId,
        action: data.action,
        state: disposition.state,
        sourceRevision: disposition.sourceSnapshot.sourceRevision,
      });
    }
  }

  async determineRoutingFromAgentCompletion(
    context: Readonly<FeatureSyncFlowContext>,
    action: string,
  ): Promise<string | undefined> {
    if (
      action === FEATURE_SYNC_ACTIONS.NO_DISCREPANCY &&
      !context.implementationReadiness
    ) {
      this.logger.warn('Feature sync analyze blocked structural fast-path without readiness', {
        conversationId: context.core.conversationId,
      });
      return FEATURE_SYNC_NODES.ANALYZE;
    }
    return undefined;
  }
}
