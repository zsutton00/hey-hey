import type { TaskMonitorMachineContext } from './context';
import type {
  TaskMonitorConversationDeliveryFailedEvent,
  TaskMonitorConversationMessageReceivedEvent,
  TaskMonitorConversationResponsePersistedEvent,
  TaskMonitorConversationTurnStartedEvent,
} from './events';

const conversationInputEffectIdentity = (messageId: string): string =>
  `task-monitor-conversation:${messageId}`;

export const appendConversationMessage = (
  context: TaskMonitorMachineContext,
  event: TaskMonitorConversationMessageReceivedEvent,
): TaskMonitorMachineContext['input'] => {
  if (
    context.input.active?.messageId === event.messageId ||
    context.input.queuedMessageIds.includes(event.messageId)
  ) {
    return context.input;
  }
  return {
    ...context.input,
    queuedMessageIds: [...context.input.queuedMessageIds, event.messageId],
  };
};

export const claimConversationMessage = (
  context: TaskMonitorMachineContext,
  messageId: string,
): TaskMonitorMachineContext['input'] => ({
  queuedMessageIds: context.input.queuedMessageIds.filter((candidate) => candidate !== messageId),
  active: {
    messageId,
    effectId: conversationInputEffectIdentity(messageId),
    runId: null,
    turnId: null,
    assistantMessageId: null,
  },
});

export const storeConversationTurn = (
  context: TaskMonitorMachineContext,
  event: TaskMonitorConversationTurnStartedEvent,
): TaskMonitorMachineContext['input'] =>
  context.input.active?.messageId === event.messageId
    ? {
        ...context.input,
        active: { ...context.input.active, runId: event.runId, turnId: event.turnId },
      }
    : context.input;

export const settleConversationMessage = (
  context: TaskMonitorMachineContext,
  event: TaskMonitorConversationResponsePersistedEvent | TaskMonitorConversationDeliveryFailedEvent,
): TaskMonitorMachineContext['input'] =>
  context.input.active?.messageId === event.messageId
    ? { ...context.input, active: null }
    : context.input;
