import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ExtendedUIFieldType, UIElement } from 'src/generated';
import {
  FeatureSyncFlowContext,
  FlowUserMessage,
  NodeResult,
  NodeType,
  QuestionsNodeBase,
} from 'src/types/flow-internal.types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { FEATURE_SYNC_NODES } from '../../constants/node-ids';

/**
 * `opener` gate node for the feature-sync flow.
 *
 * The agent setup page renders an initial prompt input BEFORE the
 * coding-session conversation UI is mounted. The workflow starts as
 * soon as the conversation is created, so the first node needs to
 * pause until the user submits on the setup page — otherwise the
 * analyze trigger would fire before the user has had a chance to
 * contribute free-text context.
 *
 * This node emits an empty QUESTIONS message with a single
 * `AgentHidden` uiElement (so the message has nothing to render) and
 * waits (`twoPhase = true` via `QuestionsNodeBase`). The emitted
 * SYSTEM message is filtered out of the rendered timeline on the UI
 * side so users never see this gate.
 *
 * When the user's first message arrives, `processUserResponse`
 * captures its `comment` text onto flow context as
 * `featureSyncInitialPrompt`. `analyze` folds that into its trigger
 * `data` so the CLI agent sees the user's guidance.
 */
@Injectable()
export class FeatureSyncOpenerNode extends QuestionsNodeBase<FeatureSyncFlowContext> {
  readonly id = FEATURE_SYNC_NODES.OPENER;
  readonly title = 'Feature Sync — Awaiting initial prompt';
  private readonly logger = new Logger(FeatureSyncOpenerNode.name);

  async execute(): Promise<NodeResult> {
    const uiElements: UIElement[] = [
      {
        id: uuidv4(),
        type: ExtendedUIFieldType.AgentHidden,
        label: 'Feature Sync — Opener',
        required: false,
        influences: [],
      },
    ];

    return {
      type: NodeType.QUESTIONS,
      message: '',
      uiElements,
      data: {
        detectedIntent: 'feature_sync_opener_waiting',
        intentConfidence: 1,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<FeatureSyncFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    const comment = extractComment(userMessage);

    tracker.mutate((draft) => {
      draft.featureSyncInitialPrompt = comment;
    });

    this.logger.debug('Feature sync opener captured initial prompt', {
      conversationId: tracker.getContext().core.conversationId,
      promptLength: comment.length,
    });
  }
}

function extractComment(userMessage: FlowUserMessage): string {
  const data = userMessage.data as { comment?: unknown; text?: unknown } | null;
  if (!data || typeof data !== 'object') {
    return '';
  }
  if (typeof data.comment === 'string') {
    return data.comment;
  }
  if (typeof data.text === 'string') {
    return data.text;
  }
  return '';
}
