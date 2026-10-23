import type { LocalAgentService } from '../../../server/local-agent-service';
import type { ServerLogger } from '../../../server/logger';
import { LocalPromptType } from '../../../shared/agent-bridge-contract/generated/api';
import type { TaskMonitorConversationPromptPayload } from '../../../shared/agent-bridge-contract/contract';
import type {
  EffectExecutionIdentity,
  EffectHandler,
  EffectSettlement,
} from '../../../state-machine';
import type {
  DeliverTaskMonitorConversationMessageEffect,
  ReconcileTaskMonitorConversationResponseEffect,
} from './effects';
import type { TaskMonitorMachineEffectOutcome } from './events';
import type { TaskMonitorCoordinatorRunner } from '../../../server/monitors/runner';
import type { DurableRunEvent, DurableRunEventInput, RunStore } from '../../../run-store';

interface ConversationTurnSettlement {
  readonly turnId: string;
  readonly terminalOutcome: 'COMPLETED' | 'FAILED' | 'ABORTED';
  readonly completedAssistantMessageId: string | null;
}

interface ConversationTurnReceipt extends ConversationTurnSettlement {
  readonly sourceMessageId: string;
}

const readConversationTurnReceipt = (value: unknown): ConversationTurnReceipt | null => {
  if (!value || typeof value !== 'object') return null;
  const receipt = (value as { taskMonitorConversationReceipt?: unknown })
    .taskMonitorConversationReceipt;
  if (!receipt || typeof receipt !== 'object') return null;
  const candidate = receipt as Partial<ConversationTurnReceipt>;
  return typeof candidate.sourceMessageId === 'string' &&
    typeof candidate.turnId === 'string' &&
    (candidate.terminalOutcome === 'COMPLETED' ||
      candidate.terminalOutcome === 'FAILED' ||
      candidate.terminalOutcome === 'ABORTED') &&
    (typeof candidate.completedAssistantMessageId === 'string' ||
      candidate.completedAssistantMessageId === null)
    ? {
        sourceMessageId: candidate.sourceMessageId,
        turnId: candidate.turnId,
        terminalOutcome: candidate.terminalOutcome,
        completedAssistantMessageId: candidate.completedAssistantMessageId,
      }
    : null;
};

const readCanonicalConversationTurnReceipt = (
  event: DurableRunEvent,
): ConversationTurnReceipt | null => {
  if (event.payload.kind !== 'task_monitor_turn_settled') return null;
  const terminalOutcome =
    event.payload.terminalOutcome === 'succeeded'
      ? 'COMPLETED'
      : event.payload.terminalOutcome === 'failed'
        ? 'FAILED'
        : 'ABORTED';
  return {
    sourceMessageId: event.payload.sourceMessageId,
    turnId: event.payload.turnId,
    terminalOutcome,
    completedAssistantMessageId: event.payload.completedAssistantMessageId,
  };
};

const reasonFrom = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Owns ordinary-message delivery and the live Turn receipt used by the reconciliation effect. */
export class TaskMonitorConversationInputEffectHandler implements EffectHandler<
  DeliverTaskMonitorConversationMessageEffect | ReconcileTaskMonitorConversationResponseEffect,
  TaskMonitorMachineEffectOutcome
> {
  private readonly settlements = new Map<string, Promise<ConversationTurnSettlement>>();

  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: (
      effect:
        | DeliverTaskMonitorConversationMessageEffect
        | ReconcileTaskMonitorConversationResponseEffect,
      execution: EffectExecutionIdentity,
    ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> =>
      effect.type === 'RECONCILE_TASK_MONITOR_CONVERSATION_RESPONSE'
        ? this.reconcileResponse(effect, execution)
        : this.reconcileDelivery(effect, execution),
  };

  public constructor(
    private readonly agentService: LocalAgentService,
    private readonly coordinatorRunner: TaskMonitorCoordinatorRunner,
    private readonly runStore: RunStore,
    private readonly logger: ServerLogger,
  ) {}

  public async execute(
    effect:
      | DeliverTaskMonitorConversationMessageEffect
      | ReconcileTaskMonitorConversationResponseEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    return effect.type === 'DELIVER_TASK_MONITOR_CONVERSATION_MESSAGE'
      ? this.deliver(effect, execution)
      : this.reconcileResponse(effect, execution);
  }

  private async deliver(
    effect: DeliverTaskMonitorConversationMessageEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    this.logger.debug('task_monitor.conversation_input.delivery.started', {
      taskMonitorId: effect.taskMonitorId,
      messageId: effect.messageId,
      effectId: execution.effectId,
    });
    try {
      const message = await this.agentService.readUserMessage({
        organizationId: effect.organizationId,
        projectId: effect.projectId,
        conversationId: effect.conversationId,
        messageId: effect.messageId,
      });
      if (!message) throw new Error('Canonical Task Monitor USER Message is absent or invalid.');
      const identity = await this.coordinatorRunner.ensureTaskMonitorRun(
        { monitorId: effect.taskMonitorId },
        { organizationId: effect.organizationId, projectId: effect.projectId },
      );
      if (!identity) throw new Error('Task Monitor coordinator Run is unavailable.');

      let resolveStarted!: (turnId: string) => void;
      const started = new Promise<string>((resolve) => {
        resolveStarted = resolve;
      });
      let resolveSettled!: (outcome: ConversationTurnSettlement) => void;
      const settled = new Promise<ConversationTurnSettlement>((resolve) => {
        resolveSettled = resolve;
      });
      const payload: TaskMonitorConversationPromptPayload = {
        promptType: 'task_monitor',
        mode: 'CONVERSATION',
        taskMonitorId: effect.taskMonitorId,
        conversationId: effect.conversationId,
        sourceMessageId: effect.messageId,
        userMessage: message.content,
      };
      await this.agentService.sendSystemMessage(
        identity.runId,
        {
          promptType: LocalPromptType.TaskMonitor,
          payload,
          references: { resolved: [], unresolved: [] },
        },
        {
          sourceUserMessageId: effect.messageId,
          onTurnStarted: resolveStarted,
          onTurnSettled: (outcome) => {
            void this.persistReceipt(identity.runId, effect.messageId, outcome).then(
              () => resolveSettled(outcome),
              () => resolveSettled(outcome),
            );
          },
        },
      );
      const turnId = await started;
      this.settlements.set(turnId, settled);
      this.logger.info('task_monitor.conversation_input.delivery.scheduled', {
        taskMonitorId: effect.taskMonitorId,
        messageId: effect.messageId,
        runId: identity.runId,
        turnId,
        effectId: execution.effectId,
      });
      return {
        status: 'succeeded',
        outcome: {
          type: 'CONVERSATION_TURN_STARTED',
          taskMonitorId: effect.taskMonitorId,
          messageId: effect.messageId,
          runId: identity.runId,
          turnId,
        },
      };
    } catch (error) {
      const reason = reasonFrom(error);
      this.logger.error('task_monitor.conversation_input.delivery.failed', {
        taskMonitorId: effect.taskMonitorId,
        messageId: effect.messageId,
        effectId: execution.effectId,
        reason,
      });
      return this.failed(effect, reason);
    }
  }

  private async reconcileResponse(
    effect: ReconcileTaskMonitorConversationResponseEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    this.logger.debug('task_monitor.conversation_input.reconciliation.started', {
      taskMonitorId: effect.taskMonitorId,
      messageId: effect.messageId,
      runId: effect.runId,
      turnId: effect.turnId,
      effectId: execution.effectId,
    });
    const liveSettlement = this.settlements.get(effect.turnId);
    const outcome = liveSettlement
      ? await liveSettlement
      : await this.findReceipt(effect.runId, effect.messageId, effect.turnId);
    this.settlements.delete(effect.turnId);
    if (!outcome) {
      return this.failed(effect, 'Canonical Turn settlement is not available for reconciliation.');
    }
    if (outcome.terminalOutcome !== 'COMPLETED' || !outcome.completedAssistantMessageId) {
      return this.failed(
        effect,
        `Conversation Turn settled as ${outcome.terminalOutcome} without a durable assistant Message.`,
      );
    }
    const assistant = await this.agentService.readAssistantMessage({
      organizationId: effect.organizationId,
      projectId: effect.projectId,
      conversationId: effect.conversationId,
      messageId: outcome.completedAssistantMessageId,
    });
    if (!assistant)
      return this.failed(effect, 'Canonical assistant Message could not be reconciled.');
    this.logger.info('task_monitor.conversation_input.reconciliation.completed', {
      taskMonitorId: effect.taskMonitorId,
      messageId: effect.messageId,
      runId: effect.runId,
      turnId: effect.turnId,
      assistantMessageId: assistant.messageId,
      effectId: execution.effectId,
    });
    return {
      status: 'succeeded',
      outcome: {
        type: 'CONVERSATION_RESPONSE_PERSISTED',
        taskMonitorId: effect.taskMonitorId,
        messageId: effect.messageId,
        runId: effect.runId,
        turnId: effect.turnId,
        assistantMessageId: assistant.messageId,
      },
    };
  }

  private async reconcileDelivery(
    effect: DeliverTaskMonitorConversationMessageEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    const identity = await this.coordinatorRunner.ensureTaskMonitorRun(
      { monitorId: effect.taskMonitorId },
      { organizationId: effect.organizationId, projectId: effect.projectId },
    );
    const receipt = identity ? await this.findReceipt(identity.runId, effect.messageId) : null;
    if (!identity || !receipt) {
      this.logger.warn('task_monitor.conversation_input.delivery.recovery_unsettled', {
        taskMonitorId: effect.taskMonitorId,
        messageId: effect.messageId,
        effectId: execution.effectId,
        reason: 'canonical_turn_receipt_absent',
      });
      return this.failed(
        effect,
        'Interrupted delivery was not repeated because canonical Turn identity was not yet committed.',
      );
    }
    return {
      status: 'succeeded',
      outcome: {
        type: 'CONVERSATION_TURN_STARTED',
        taskMonitorId: effect.taskMonitorId,
        messageId: effect.messageId,
        runId: identity.runId,
        turnId: receipt.turnId,
      },
    };
  }

  private async persistReceipt(
    runId: string,
    sourceMessageId: string,
    outcome: ConversationTurnSettlement,
  ): Promise<void> {
    const canonicalInput: DurableRunEventInput = {
      run_id: runId,
      actor: 'system',
      event_type: 'post_processed',
      state_version: 0,
      payload: {
        kind: 'task_monitor_turn_settled',
        sourceMessageId,
        turnId: outcome.turnId,
        terminalOutcome:
          outcome.terminalOutcome === 'COMPLETED'
            ? 'succeeded'
            : outcome.terminalOutcome === 'FAILED'
              ? 'failed'
              : 'cancelled',
        completedAssistantMessageId: outcome.completedAssistantMessageId,
        reportIds: [],
      },
    };
    if (typeof this.runStore.appendDurableEvent === 'function') {
      await this.runStore.appendDurableEvent(runId, canonicalInput);
      return;
    }
    await this.runStore.appendEvent(runId, {
      run_id: runId,
      actor: 'system',
      event_type: 'post_processed',
      state_version: 0,
      payload: {
        summary: 'task-monitor-conversation-turn-receipt',
        taskMonitorConversationReceipt: { sourceMessageId, ...outcome },
      },
    });
  }

  private async findReceipt(
    runId: string,
    sourceMessageId: string,
    turnId?: string,
  ): Promise<ConversationTurnReceipt | null> {
    if (typeof this.runStore.readDurableRunEvents === 'function') {
      const events = await this.runStore.readDurableRunEvents(runId);
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (!event) continue;
        const receipt = readCanonicalConversationTurnReceipt(event);
        if (
          receipt?.sourceMessageId === sourceMessageId &&
          (turnId === undefined || receipt.turnId === turnId)
        ) {
          return receipt;
        }
      }
    }
    const events = await this.runStore.readRunEvents(runId);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (!event) continue;
      if (event.event_type !== 'post_processed') continue;
      const receipt = readConversationTurnReceipt(event.payload);
      if (
        receipt?.sourceMessageId === sourceMessageId &&
        (turnId === undefined || receipt.turnId === turnId)
      ) {
        return receipt;
      }
    }
    return null;
  }

  private failed(
    effect:
      | DeliverTaskMonitorConversationMessageEffect
      | ReconcileTaskMonitorConversationResponseEffect,
    reason: string,
  ): EffectSettlement<TaskMonitorMachineEffectOutcome> {
    return {
      status: 'failed',
      outcome: {
        type: 'CONVERSATION_DELIVERY_FAILED',
        taskMonitorId: effect.taskMonitorId,
        messageId: effect.messageId,
        reason,
      },
    };
  }
}
