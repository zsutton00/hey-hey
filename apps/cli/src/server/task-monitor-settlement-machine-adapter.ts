import type { RunStore } from '../run-store';
import type { TaskMonitorStateStore } from '../agents/task-monitor/state-machine/machine';
import type { TaskMonitorExecutionPhase } from '../agents/task-monitor/state-machine/events';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated';
import type { ServerLogger } from './logger';
import type { PlatformAuth } from './platform-auth-context';
import type { AgentSessionReader } from './monitors/agent-session-reader';
import type { CanonicalSettledTurnMonitorEvent } from './monitors/normalizer';
import type { TurnSupervisionDisposition, TurnSupervisor } from './monitors/turn-supervision-chain';
import type { TaskMonitorStateMachineInputAdapter } from './state-machine-input-adapter';

const executionPhase = (promptType: string): TaskMonitorExecutionPhase | null => {
  switch (promptType) {
    case LocalPromptType.Quick:
    case LocalPromptType.FreeForm:
    case LocalPromptType.CodingFreeform:
    case LocalPromptType.Implement:
      return 'IMPLEMENTATION';
    case LocalPromptType.CodeReview:
      return 'REVIEW';
    default:
      return null;
  }
};

/** Owns the released settled-Turn handoff into the addressed Task Monitor machine. */
export class TaskMonitorSettlementMachineAdapter implements TurnSupervisor {
  public readonly id = 'TASK_MONITOR' as const;

  public constructor(
    private readonly agentSessionReader: AgentSessionReader,
    private readonly runStore: RunStore,
    private readonly stateStore: TaskMonitorStateStore,
    private readonly inputAdapter: TaskMonitorStateMachineInputAdapter,
    private readonly logger: ServerLogger,
  ) {}

  public async invoke(
    event: CanonicalSettledTurnMonitorEvent,
    auth: PlatformAuth,
  ): Promise<TurnSupervisionDisposition> {
    void auth;
    const input = await this.releasedInputFrom(event);
    if (input === null) {
      return {
        status: 'RELEASED',
        supervisor: this.id,
        reason: 'TASK_MONITOR_NOT_APPLICABLE',
      };
    }

    try {
      const result = await this.inputAdapter.admitVerified(input);
      this.logger[result.status === 'rejected' ? 'warn' : 'info'](
        'task_monitor.settlement.admission.completed',
        {
          taskMonitorId: input.taskMonitorId,
          runId: input.runId,
          agentSessionId: input.agentSessionId,
          turnId: input.turnId,
          status: result.status,
          ...(result.status === 'rejected' ? { code: result.code, reason: result.reason } : {}),
        },
      );
      if (result.status === 'accepted' || result.status === 'replayed') {
        return { status: 'HANDLED', supervisor: this.id };
      }
      if (result.code === 'unsupported_initial_event' || result.code === 'transition_rejected') {
        return {
          status: 'RELEASED',
          supervisor: this.id,
          reason: 'TASK_MONITOR_INPUT_IRRELEVANT',
        };
      }
      return { status: 'FAILED', supervisor: this.id, reason: result.reason };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error('task_monitor.settlement.admission.failed', {
        agentSessionId: event.agentSessionId,
        turnId: event.turnId,
        error: reason,
      });
      return { status: 'FAILED', supervisor: this.id, reason };
    }
  }

  private async releasedInputFrom(event: CanonicalSettledTurnMonitorEvent) {
    const phase = executionPhase(event.promptType);
    if (phase === null) {
      this.logger.debug('task_monitor.settlement.prompt_type.inapplicable', {
        agentSessionId: event.agentSessionId,
        turnId: event.turnId,
        promptType: event.promptType,
      });
      return null;
    }

    const session = await this.agentSessionReader.readAgentSession(event.agentSessionId);
    const taskMonitorId =
      session?.config?.type === 'CODING_SESSION' && session.config.version === 'v2'
        ? session.config.taskMonitorId
        : undefined;
    if (!taskMonitorId) {
      this.logger.debug('task_monitor.settlement.owner.not_found', {
        agentSessionId: event.agentSessionId,
        turnId: event.turnId,
      });
      return null;
    }

    const instance = await this.stateStore.findByInstanceId(taskMonitorId);
    const activeRunAgentSessionId = instance?.snapshot.context.activeRunAgentSessionId ?? null;
    if (
      !instance ||
      instance.snapshot.identity.machineType !== 'TASK_MONITOR' ||
      activeRunAgentSessionId !== event.agentSessionId
    ) {
      this.logger.warn('task_monitor.settlement.owner.stale', {
        taskMonitorId,
        agentSessionId: event.agentSessionId,
        activeRunAgentSessionId,
        turnId: event.turnId,
      });
      return null;
    }

    const runId = this.runStore.lookupByAgentSessionId(event.agentSessionId);
    if (runId === null) {
      this.logger.warn('task_monitor.settlement.run.not_found', {
        taskMonitorId,
        agentSessionId: event.agentSessionId,
        turnId: event.turnId,
      });
      return null;
    }

    return {
      source: 'EXECUTION_TURN_RELEASED' as const,
      phase,
      identity: { machineType: 'TASK_MONITOR' as const, instanceId: taskMonitorId },
      ingressId: `settled-turn:${event.turnId}`,
      taskMonitorId,
      runId,
      agentSessionId: event.agentSessionId,
      turnId: event.turnId,
      settledAt: event.settledAt,
      terminalOutcome: event.terminalOutcome,
      completedAssistantMessageId: event.completedAssistantMessageId,
      reports: event.reports,
    };
  }
}
