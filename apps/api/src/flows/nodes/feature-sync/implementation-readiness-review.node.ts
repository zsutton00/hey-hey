import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  ExtendedUIFieldType,
  ImplementationReadinessPayload,
  ImplementationReadinessDismissActionPayload,
  ImplementationReadinessReplyActionPayload,
  SecondaryActionConfig,
  SecondaryActionHandler,
  SecondaryActionPayload,
  UIElement,
} from 'src/generated';
import {
  FlowUserMessage,
  NodeResult,
  NodeType,
  QuestionsActionValidationError,
  QuestionsNodeBase,
  FeatureSyncFlowContext,
  validateQuestionsAction,
} from 'src/types/flow-internal.types';
import type { ImplementationReadinessDisposition } from 'src/generated';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { UserMessageExtractor } from 'src/utils/user-message-extractor';
import { FEATURE_SYNC_NODES } from '../../constants/node-ids';
import {
  featureSyncReadinessReviewActions,
  IMPLEMENTATION_READINESS_REVIEW_ACTIONS,
  parseImplementationReadinessReviewActionPayload,
} from './schemas';

/**
 * Read-only review gate for a consequential implementation-readiness finding.
 * The standard composer remains the only prose input; the field actions only
 * focus that composer or record a run/source-bound disposition.
 */
@Injectable()
export class FeatureSyncImplementationReadinessReviewNode extends QuestionsNodeBase<FeatureSyncFlowContext> {
  readonly id = FEATURE_SYNC_NODES.IMPLEMENTATION_READINESS_REVIEW;
  readonly title = 'Feature Sync — Implementation Readiness Review';

  readonly actions = featureSyncReadinessReviewActions;

  private readonly logger = new Logger(
    FeatureSyncImplementationReadinessReviewNode.name,
  );

  async execute(
    tracker: MutableContextHandle<FeatureSyncFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    const disposition = context.implementationReadiness;
    if (
      !disposition ||
      disposition.state !== 'REVIEW_REQUIRED' ||
      !disposition.finding
    ) {
      throw new Error(
        'implementation-readiness-review requires a REVIEW_REQUIRED disposition with a finding',
      );
    }

    const fieldId = uuidv4();
    const payload: ImplementationReadinessPayload = {
      responseType: 'implementation_readiness_v1',
      disposition,
    };
    const uiElements: UIElement[] = [
      {
        id: fieldId,
        type: ExtendedUIFieldType.ImplementationReadiness,
        label: 'Implementation readiness review',
        required: false,
        influences: [],
        payload,
      },
    ];
    const { runId, sourceRevision } = disposition.sourceSnapshot;
    const replyPayload: ImplementationReadinessReplyActionPayload = {
      handlerType:
        SecondaryActionPayload.HandlerTypeEnum.ImplementationReadinessReply,
      runId,
      sourceRevision,
    };
    const dismissPayload: ImplementationReadinessDismissActionPayload = {
      handlerType:
        SecondaryActionPayload.HandlerTypeEnum.ImplementationReadinessDismiss,
      confirmed: true,
      runId,
      sourceRevision,
    };
    const secondaryActions: SecondaryActionConfig[] = [
      {
        id: uuidv4(),
        type: SecondaryActionConfig.TypeEnum.FieldAction,
        presentation: SecondaryActionConfig.PresentationEnum.Button,
        label: 'Clarify',
        handler: SecondaryActionHandler.ImplementationReadinessReply,
        fieldId,
        disabled: false,
        payload: replyPayload,
      },
      {
        id: uuidv4(),
        type: SecondaryActionConfig.TypeEnum.FieldAction,
        presentation: SecondaryActionConfig.PresentationEnum.Button,
        label: 'Dismiss',
        handler: SecondaryActionHandler.ImplementationReadinessDismiss,
        fieldId,
        disabled: false,
        payload: dismissPayload,
      },
    ];

    this.logger.debug('Implementation-readiness review gate entered', {
      conversationId: context.core.conversationId,
      runId,
      sourceRevision,
      evidenceCount: disposition.finding.boundedEvidence.length,
    });

    return {
      type: NodeType.QUESTIONS,
      message: '',
      uiElements,
      data: {
        type: 'QUESTIONS',
        detectedIntent: '',
        intentConfidence: 0,
        secondaryActions,
      },
    } as NodeResult;
  }

  async processUserResponse(
    tracker: MutableContextHandle<FeatureSyncFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    const data = (userMessage.data ?? {}) as { action?: unknown };
    if (data.action === undefined) {
      const reply = UserMessageExtractor.extractContentFromData(
        userMessage.data,
        '',
      ).trim();
      if (reply.length > 0) {
        tracker.mutate((draft) => {
          draft.featureSyncPendingUserReply = reply;
        });
        this.logger.debug('Implementation-readiness clarification captured', {
          conversationId: tracker.getContext().core.conversationId,
          replyLength: reply.length,
        });
      }
      return;
    }

    let validated: { action: string; payload: unknown };
    try {
      validated = validateQuestionsAction({
        nodeId: this.id,
        actions: featureSyncReadinessReviewActions,
        message: userMessage,
      });
    } catch (error) {
      if (error instanceof QuestionsActionValidationError) {
        this.logger.warn('Implementation-readiness action rejected', {
          conversationId: tracker.getContext().core.conversationId,
          reason: error.reason,
          action: error.action,
        });
        return;
      }
      throw error;
    }

    const current = tracker.getContext().implementationReadiness;
    const payload = parseImplementationReadinessReviewActionPayload(
      validated.payload,
    );
    if (
      !current ||
      current.state !== 'REVIEW_REQUIRED' ||
      current.sourceSnapshot.runId !== payload.runId ||
      current.sourceSnapshot.sourceRevision !== payload.sourceRevision
    ) {
      this.logger.warn('Implementation-readiness action rejected as stale', {
        conversationId: tracker.getContext().core.conversationId,
        action: validated.action,
        actionRunId: payload.runId,
        actionSourceRevision: payload.sourceRevision,
        currentRunId: current?.sourceSnapshot.runId ?? null,
        currentSourceRevision: current?.sourceSnapshot.sourceRevision ?? null,
      });
      throw new Error(
        'Implementation-readiness action is stale for the displayed finding.',
      );
    }

    if (validated.action === IMPLEMENTATION_READINESS_REVIEW_ACTIONS.DISMISS) {
      const next: ImplementationReadinessDisposition = {
        ...current,
        state: 'DISMISSED',
        resolution: {
          kind: 'DISMISSED',
          runId: payload.runId,
          sourceRevision: payload.sourceRevision,
          resolvedAt: new Date().toISOString(),
        },
      };
      tracker.mutate((draft) => {
        draft.implementationReadiness = next;
      });
      this.logger.log('Implementation-readiness disposition resolved', {
        conversationId: tracker.getContext().core.conversationId,
        action: validated.action,
        resolutionKind: 'DISMISSED',
      });
    }
  }

  async determineRoutingFromUserMessage(
    context: FeatureSyncFlowContext,
    userMessage: FlowUserMessage,
  ): Promise<string | undefined> {
    const action = (userMessage.data as { action?: unknown } | undefined)
      ?.action;
    if (action === undefined) {
      const reply = UserMessageExtractor.extractContentFromData(
        userMessage.data,
        '',
      ).trim();
      if (reply.length > 0) {
        return FEATURE_SYNC_NODES.ANALYZE;
      }
    }
    if (
      action === IMPLEMENTATION_READINESS_REVIEW_ACTIONS.DISMISS &&
      context.implementationReadiness?.state === 'DISMISSED'
    ) {
      return FEATURE_SYNC_NODES.CODING_PLAN;
    }
    return FEATURE_SYNC_NODES.IMPLEMENTATION_READINESS_REVIEW;
  }
}
