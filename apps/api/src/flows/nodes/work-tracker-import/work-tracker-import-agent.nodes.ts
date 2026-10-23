import { Injectable, Logger } from '@nestjs/common';
import { LocalPromptType } from 'src/generated/local';
import type {
  WorkTrackerConnectionCompletion,
  WorkTrackerImportSuccess,
} from '../../../generated';
import {
  ExternalAgentActionSchemas,
  ExternalAgentFlowData,
  ExternalAgentNodeBase,
  ExternalAgentTriggerMessage,
  FlowUserMessage,
  MutableContextHandle,
  WorkTrackerImportFlowContext,
} from '../../../types/flow-internal.types';
import { WORK_TRACKER_IMPORT_NODES } from '../../constants/node-ids';
import {
  buildWorkTrackerRequest,
  sourceLabel,
  WORK_TRACKER_ACTIONS,
  workTrackerConnectActions,
  workTrackerImportActions,
} from './work-tracker-import.contract';

function readCompletion(
  userMessage: FlowUserMessage,
  actions: ExternalAgentActionSchemas,
):
  | { action: string; payload: WorkTrackerConnectionCompletion }
  | { action: 'success'; payload: WorkTrackerImportSuccess }
  | undefined {
  const data = (userMessage.data ?? {}) as Partial<ExternalAgentFlowData>;
  if (typeof data.action !== 'string') return undefined;
  const parsed = actions[data.action]?.schema.safeParse(data.payload);
  if (!parsed?.success) return undefined;
  return { action: data.action, payload: parsed.data };
}

/**
 * Connect phase: the CLI checks whether the selected runtime already exposes
 * the source's tools and, if not, posts the runtime-specific install command.
 */
@Injectable()
export class WorkTrackerImportConnectNode extends ExternalAgentNodeBase<WorkTrackerImportFlowContext> {
  readonly id = WORK_TRACKER_IMPORT_NODES.CONNECT;
  readonly title = 'Check work-tracker access';
  readonly promptType = LocalPromptType.work_tracker_connect;
  readonly actions = workTrackerConnectActions;

  private readonly logger = new Logger(WorkTrackerImportConnectNode.name);

  async buildTriggerMessage(
    tracker: MutableContextHandle<WorkTrackerImportFlowContext>,
  ): Promise<ExternalAgentTriggerMessage> {
    const context = tracker.getContext();
    const payload = buildWorkTrackerRequest(
      context,
      'work_tracker_connect',
      this.id,
    );
    this.logger.log('Work-tracker connect trigger built', {
      conversationId: context.core.conversationId,
      source: payload.source,
      provider: payload.provider,
      machineId: payload.machineId,
      connectionConfirmed: payload.connectionConfirmed === true,
    });
    return {
      response: `Checking whether your paired CLI can reach ${sourceLabel(payload.source)}...`,
      uiElements: [],
      triggersAgent: {
        promptType: this.promptType,
        nodeId: this.id,
        payload,
      },
      data: {
        detectedIntent: 'work_tracker_connect_started',
        intentConfidence: 1,
        ragEnabled: false,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<WorkTrackerImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    const completion = readCompletion(userMessage, this.actions);
    if (!completion) return;
    tracker.mutate((draft) => {
      draft.workTrackerConnectionOutcome =
        completion.payload.outcome === 'success'
          ? undefined
          : completion.payload.outcome;
    });
    this.logger.log('Work-tracker connect completion captured', {
      conversationId: tracker.getContext().core.conversationId,
      outcome: completion.payload.outcome,
    });
  }

  async determineRoutingFromAgentCompletion(
    _context: Readonly<WorkTrackerImportFlowContext>,
    action: string,
  ): Promise<string | undefined> {
    return action === WORK_TRACKER_ACTIONS.CONNECTED
      ? WORK_TRACKER_IMPORT_NODES.START
      : WORK_TRACKER_IMPORT_NODES.CONNECT_CONFIRM;
  }
}

/**
 * Import phase: a distinct CLI handler, so the provider session starts fresh
 * and loads any MCP servers the user added during the connect phase.
 */
@Injectable()
export class WorkTrackerImportImportNode extends ExternalAgentNodeBase<WorkTrackerImportFlowContext> {
  readonly id = WORK_TRACKER_IMPORT_NODES.IMPORT;
  readonly title = 'Read work-tracker capabilities';
  readonly promptType = LocalPromptType.work_tracker_import;
  readonly actions = workTrackerImportActions;

  private readonly logger = new Logger(WorkTrackerImportImportNode.name);

  async buildTriggerMessage(
    tracker: MutableContextHandle<WorkTrackerImportFlowContext>,
  ): Promise<ExternalAgentTriggerMessage> {
    const context = tracker.getContext();
    const payload = buildWorkTrackerRequest(
      context,
      'work_tracker_import',
      this.id,
    );
    this.logger.log('Work-tracker import trigger built', {
      conversationId: context.core.conversationId,
      source: payload.source,
      provider: payload.provider,
      machineId: payload.machineId,
    });
    return {
      response: `Your paired CLI is reading ${sourceLabel(payload.source)}. The proposed Features will appear here for review.`,
      uiElements: [],
      triggersAgent: {
        promptType: this.promptType,
        nodeId: this.id,
        payload,
      },
      data: {
        detectedIntent: 'work_tracker_import_started',
        intentConfidence: 1,
        ragEnabled: false,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<WorkTrackerImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    const completion = readCompletion(userMessage, this.actions);
    if (!completion) return;
    const context = tracker.getContext();
    const payload = completion.payload;
    if (payload.source !== context.workTrackerImportConfiguration?.source) {
      this.logger.error('Work-tracker import completion source mismatch', {
        conversationId: context.core.conversationId,
        expected: context.workTrackerImportConfiguration?.source,
        received: payload.source,
      });
      return;
    }
    tracker.mutate((draft) => {
      if (payload.outcome === 'success') {
        draft.workTrackerImportAccepted = payload;
        draft.onboardingFeatureProposal = undefined;
      } else {
        // Tools were missing in the fresh session; require a new confirmation.
        draft.workTrackerConnectionConfirmed = undefined;
        draft.workTrackerConnectionOutcome = payload.outcome;
      }
    });
    this.logger.log('Work-tracker import completion captured', {
      conversationId: context.core.conversationId,
      outcome: payload.outcome,
    });
  }

  async determineRoutingFromAgentCompletion(
    context: Readonly<WorkTrackerImportFlowContext>,
    action: string,
  ): Promise<string | undefined> {
    if (
      action === WORK_TRACKER_ACTIONS.SUCCESS &&
      context.workTrackerImportAccepted
    ) {
      return WORK_TRACKER_IMPORT_NODES.GENERATE_FEATURES;
    }
    return WORK_TRACKER_IMPORT_NODES.CONNECT_CONFIRM;
  }
}
