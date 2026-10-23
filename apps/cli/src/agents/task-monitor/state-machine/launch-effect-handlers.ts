import { z } from 'zod';
import type { ApiRuntime } from '@hey-hey/ui-common/clients';

import type {
  EffectExecutionIdentity,
  EffectHandler,
  EffectSettlement,
} from '../../../state-machine';
import {
  AgentSessionType,
  EntityType,
  MachineEffectHttpMethod,
  type SubmitTaskMonitorRunEffectRequestDto,
} from '../../../shared/api/generated/api';
import type { TaskMonitorPlanGuidance } from '../../../shared/agent-bridge-contract/generated/api';
import {
  buildTaskMonitorRunEffectPayload,
  taskMonitorConversationWorkflow,
  toCreateProvider,
  toTaskMonitorSessionConfig,
  toTaskPromptType,
  type TaskMonitorCodingSessionLaunchInput,
} from '../../../commands/agent-session-starter';
import { MachineEffectProofSigner } from '../../../auth/machine-effect-proof';
import type { KeyPairStore } from '../../../credentials';
import type { RunStore } from '../../../run-store';
import { SessionValidationError } from '../../../session/errors';
import type { ServerLogger } from '../../../server/logger';
import type { TaskMonitorLaunchDeclaration } from './context';
import type {
  CreateTaskMonitorAgentSessionEffect,
  CreateTaskMonitorConversationEffect,
  StartTaskMonitorRunEffect,
} from './effects';
import type { TaskMonitorMachineEffectOutcome } from './events';

const runEffectResponseSchema = z
  .object({
    success: z.boolean(),
    message: z.string().optional(),
    data: z.object({ dispatched: z.boolean() }).passthrough().optional(),
  })
  .passthrough();

const reasonFrom = (error: unknown): string =>
  error instanceof Error ? error.message : 'Task Monitor launch operation failed.';

const responseStatus = (error: unknown): number | null => {
  if (typeof error !== 'object' || error === null || !('response' in error)) return null;
  const response = error.response;
  if (typeof response !== 'object' || response === null || !('status' in response)) return null;
  return typeof response.status === 'number' ? response.status : null;
};

const isCancelled = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError');

const isSettledFailure = (error: unknown): boolean => {
  if (error instanceof SessionValidationError) return true;
  const status = responseStatus(error);
  return status !== null && status >= 400 && status < 500 && ![408, 409, 429].includes(status);
};

const toPlanGuidance = (
  guidance: TaskMonitorLaunchDeclaration['planGuidance'],
): TaskMonitorPlanGuidance | null => guidance;

export const taskMonitorLaunchInputFromDeclaration = (
  launch: TaskMonitorLaunchDeclaration,
): TaskMonitorCodingSessionLaunchInput => ({
  organizationId: launch.organizationId,
  projectId: launch.projectId,
  monitorId: launch.taskMonitorId,
  task: {
    id: launch.taskId,
    name: launch.taskTitle,
    type: launch.taskType,
    description: launch.taskDescription,
    acceptanceCriteria: launch.taskAcceptanceCriteria,
    serviceIds: launch.serviceIds,
  },
  planGuidance: toPlanGuidance(launch.planGuidance),
  launchConfig: {
    taskId: launch.taskId,
    method: launch.method,
    provider: launch.provider,
    model: launch.model,
    reasoningEffort: launch.reasoningEffort,
    ...(launch.fastMode === undefined ? {} : { fastMode: launch.fastMode }),
    ...(launch.worktree
      ? {
          worktree: {
            enabled: launch.worktree.enabled,
            ...(launch.worktree.branch ? { branch: launch.worktree.branch } : {}),
          },
        }
      : {}),
  },
  method: launch.method,
  userMessage: launch.userGuidance ?? '',
});

type LaunchOperation = 'AGENT_SESSION_CREATION' | 'CONVERSATION_CREATION' | 'RUN_START';

const failedSettlement = (
  launch: TaskMonitorLaunchDeclaration,
  operation: LaunchOperation,
  error: unknown,
): EffectSettlement<TaskMonitorMachineEffectOutcome> => ({
  status: isCancelled(error) ? 'cancelled' : isSettledFailure(error) ? 'failed' : 'uncertain',
  outcome: isCancelled(error)
    ? {
        type: 'LAUNCH_OPERATION_CANCELLED',
        taskMonitorId: launch.taskMonitorId,
        taskId: launch.taskId,
        operation,
        reason: reasonFrom(error),
      }
    : isSettledFailure(error)
      ? {
          type: 'LAUNCH_OPERATION_FAILED',
          taskMonitorId: launch.taskMonitorId,
          taskId: launch.taskId,
          operation,
          reason: reasonFrom(error),
        }
      : {
          type: 'LAUNCH_OPERATION_UNCERTAIN',
          taskMonitorId: launch.taskMonitorId,
          taskId: launch.taskId,
          cursor: launch.cursor,
          operation,
          agentSessionId: '',
          reason: reasonFrom(error),
        },
});

/** Owns the platform Agent Session create and exact-id reconciliation boundary. */
export class TaskMonitorAgentSessionEffectHandler implements EffectHandler<
  CreateTaskMonitorAgentSessionEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: (effect: CreateTaskMonitorAgentSessionEffect, execution: EffectExecutionIdentity) =>
      this.reconcile(effect, execution.effectId),
  };

  public constructor(
    private readonly apiRuntime: ApiRuntime,
    private readonly logger: ServerLogger,
  ) {}

  public async execute(
    effect: CreateTaskMonitorAgentSessionEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    const input = taskMonitorLaunchInputFromDeclaration(effect.launch);
    const operationId = execution.effectId;
    try {
      toTaskPromptType(input.task.type);
      const launchServiceId = input.task.serviceIds[0];
      if (!launchServiceId) {
        throw new SessionValidationError('Task Monitor task is missing its launch service.');
      }
      this.logger.debug('task_monitor.machine.agent_session.create.started', {
        monitorId: input.monitorId,
        taskId: input.task.id,
        operationId,
      });
      const response =
        await this.apiRuntime.clients.agentSessions.createAgentSession(
          {
            organizationId: input.organizationId,
            projectId: input.projectId,
            createAgentSessionDto: {
              projectId: input.projectId,
              sessionDate: new Date().toISOString(),
              title: input.task.name,
              entityType: EntityType.Task,
              entityId: input.task.id,
              serviceIds: [...input.task.serviceIds],
              launchServiceId,
              provider: toCreateProvider(input.launchConfig.provider),
              type: AgentSessionType.Coding,
              autoDecide: true,
              config: toTaskMonitorSessionConfig(input),
            },
          },
        );
      const createdId = response.data.data?.id;
      if (!createdId) {
        throw new Error('Platform did not return the created Coding Agent Session identity.');
      }
      return {
        status: 'succeeded',
        outcome: {
          type: 'AGENT_SESSION_CREATED',
          taskMonitorId: input.monitorId,
          taskId: input.task.id,
          agentSessionId: createdId,
        },
      };
    } catch (error) {
      const settlement = failedSettlement(effect.launch, 'AGENT_SESSION_CREATION', error);
      if (settlement.outcome.type === 'LAUNCH_OPERATION_UNCERTAIN') {
        return {
          ...settlement,
          outcome: { ...settlement.outcome, agentSessionId: operationId },
        };
      }
      return settlement;
    }
  }

  public async find(
    launch: TaskMonitorLaunchDeclaration,
    agentSessionId: string,
  ): Promise<boolean> {
    try {
      const response =
        await this.apiRuntime.clients.agentSessions.getAgentSession(
          {
            organizationId: launch.organizationId,
            projectId: launch.projectId,
            agentSessionId,
          },
        );
      return response.data.data?.id === agentSessionId;
    } catch (error) {
      if (responseStatus(error) === 404) return false;
      throw error;
    }
  }

  private async reconcile(
    effect: CreateTaskMonitorAgentSessionEffect,
    agentSessionId: string,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    try {
      if (await this.find(effect.launch, agentSessionId)) {
        return {
          status: 'succeeded',
          outcome: {
            type: 'AGENT_SESSION_CREATED',
            taskMonitorId: effect.launch.taskMonitorId,
            taskId: effect.launch.taskId,
            agentSessionId,
          },
        };
      }
      return {
        status: 'uncertain',
        outcome: {
          type: 'LAUNCH_OPERATION_UNCERTAIN',
          taskMonitorId: effect.launch.taskMonitorId,
          taskId: effect.launch.taskId,
          cursor: effect.launch.cursor,
          operation: 'AGENT_SESSION_CREATION',
          agentSessionId,
          reason: 'The committed Agent Session create was absent during recovery.',
        },
      };
    } catch (error) {
      return {
        status: 'uncertain',
        outcome: {
          type: 'LAUNCH_OPERATION_UNCERTAIN',
          taskMonitorId: effect.launch.taskMonitorId,
          taskId: effect.launch.taskId,
          cursor: effect.launch.cursor,
          operation: 'AGENT_SESSION_CREATION',
          agentSessionId,
          reason: reasonFrom(error),
        },
      };
    }
  }
}

/** Owns canonical Conversation discovery and creation on the Agent Session owner. */
export class TaskMonitorConversationEffectHandler implements EffectHandler<
  CreateTaskMonitorConversationEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: (effect: CreateTaskMonitorConversationEffect) => this.reconcile(effect),
  };

  public constructor(
    private readonly apiRuntime: ApiRuntime,
    private readonly logger: ServerLogger,
  ) {}

  public async execute(
    effect: CreateTaskMonitorConversationEffect,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    try {
      const existing = await this.find(effect.launch, effect.agentSessionId);
      if (existing) return this.succeeded(effect, existing);
      const input = taskMonitorLaunchInputFromDeclaration(effect.launch);
      this.logger.debug('task_monitor.machine.conversation.create.started', {
        monitorId: input.monitorId,
        taskId: input.task.id,
        agentSessionId: effect.agentSessionId,
      });
      const response =
        await this.apiRuntime.clients.agentSessions.createAgentSessionConversation(
          {
            organizationId: input.organizationId,
            projectId: input.projectId,
            agentSessionId: effect.agentSessionId,
            createAgentSessionConversationDto: {
              workflowType: taskMonitorConversationWorkflow(input.method),
              workflowAboutType: 'agent-session',
              workflowAboutId: effect.agentSessionId,
              entityType: 'task',
              entityId: input.task.id,
              title: input.task.name,
            },
          },
        );
      const conversationId = response.data.data?.conversation.id;
      if (!conversationId)
        throw new Error('Platform did not return the Coding Agent conversation.');
      return this.succeeded(effect, conversationId);
    } catch (error) {
      const settlement = failedSettlement(effect.launch, 'CONVERSATION_CREATION', error);
      if (settlement.outcome.type === 'LAUNCH_OPERATION_UNCERTAIN') {
        return {
          ...settlement,
          outcome: { ...settlement.outcome, agentSessionId: effect.agentSessionId },
        };
      }
      return settlement;
    }
  }

  public async find(
    launch: TaskMonitorLaunchDeclaration,
    agentSessionId: string,
  ): Promise<string | null> {
    try {
      const response =
        await this.apiRuntime.clients.agentSessions.getAgentSession(
          {
            organizationId: launch.organizationId,
            projectId: launch.projectId,
            agentSessionId,
          },
        );
      return response.data.data?.conversationId ?? null;
    } catch (error) {
      if (responseStatus(error) === 404) return null;
      throw error;
    }
  }

  private succeeded(
    effect: CreateTaskMonitorConversationEffect,
    conversationId: string,
  ): EffectSettlement<TaskMonitorMachineEffectOutcome> {
    return {
      status: 'succeeded',
      outcome: {
        type: 'CONVERSATION_CREATED',
        taskMonitorId: effect.launch.taskMonitorId,
        taskId: effect.launch.taskId,
        agentSessionId: effect.agentSessionId,
        conversationId,
      },
    };
  }

  private async reconcile(
    effect: CreateTaskMonitorConversationEffect,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    try {
      const conversationId = await this.find(effect.launch, effect.agentSessionId);
      if (conversationId) return this.succeeded(effect, conversationId);
      return {
        status: 'uncertain',
        outcome: {
          type: 'LAUNCH_OPERATION_UNCERTAIN',
          taskMonitorId: effect.launch.taskMonitorId,
          taskId: effect.launch.taskId,
          cursor: effect.launch.cursor,
          operation: 'CONVERSATION_CREATION',
          agentSessionId: effect.agentSessionId,
          reason: 'The canonical Agent Session has no Conversation.',
        },
      };
    } catch (error) {
      return {
        status: 'uncertain',
        outcome: {
          type: 'LAUNCH_OPERATION_UNCERTAIN',
          taskMonitorId: effect.launch.taskMonitorId,
          taskId: effect.launch.taskId,
          cursor: effect.launch.cursor,
          operation: 'CONVERSATION_CREATION',
          agentSessionId: effect.agentSessionId,
          reason: reasonFrom(error),
        },
      };
    }
  }
}

/** Owns start-run dispatch and reconciles against the host-owned Run index. */
export class TaskMonitorRunEffectHandler implements EffectHandler<
  StartTaskMonitorRunEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: (effect: StartTaskMonitorRunEffect) => this.reconcile(effect),
  };

  public constructor(
    private readonly apiRuntime: ApiRuntime,
    private readonly fetchImpl: typeof fetch,
    private readonly keyPairStore: KeyPairStore,
    private readonly runStore: RunStore,
    private readonly logger: ServerLogger,
  ) {}

  public async execute(
    effect: StartTaskMonitorRunEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    try {
      const machineId = await this.keyPairStore.loadCurrentMachineId();
      if (!machineId) {
        throw new SessionValidationError('Task Monitor cannot launch without a paired machine.');
      }
      const run = buildTaskMonitorRunEffectPayload(
        taskMonitorLaunchInputFromDeclaration(effect.launch),
        effect.agentSessionId,
        machineId,
        effect.conversationId,
        execution.effectId,
      );
      if (!effect.launch.authorityCommandId) {
        throw new SessionValidationError(
          'Task Monitor run effect is missing its admitted START command identity.',
        );
      }
      const route =
        `/organizations/${encodeURIComponent(effect.launch.organizationId)}` +
        `/projects/${encodeURIComponent(effect.launch.projectId)}` +
        `/machines/${encodeURIComponent(machineId)}` +
        `/task-monitors/${encodeURIComponent(effect.launch.taskMonitorId)}` +
        `/commands/${encodeURIComponent(effect.launch.authorityCommandId)}` +
        `/conversations/${encodeURIComponent(effect.conversationId)}/run-effects`;
      const payload = { run } satisfies Omit<SubmitTaskMonitorRunEffectRequestDto, 'proof'>;
      const signed = await new MachineEffectProofSigner(this.keyPairStore).sign({
        operationId: 'submitTaskMonitorRunEffect',
        method: MachineEffectHttpMethod.Post,
        path: new URL(`${this.apiRuntime.baseUrl.replace(/\/$/u, '')}${route}`).pathname,
        payload,
        organizationId: effect.launch.organizationId,
        effectId: execution.effectId,
      });
      const request = {
        ...payload,
        proof: signed.proof,
      } satisfies SubmitTaskMonitorRunEffectRequestDto;
      this.logger.debug('task_monitor.machine.run.start.started', {
        monitorId: effect.launch.taskMonitorId,
        taskId: effect.launch.taskId,
        agentSessionId: effect.agentSessionId,
        conversationId: effect.conversationId,
      });
      const response = await this.fetchImpl(
        `${this.apiRuntime.baseUrl.replace(/\/$/u, '')}${route}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${signed.machineCredential}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        },
      );
      if (!response.ok) {
        throw new Error(`Task Monitor run effect failed with status ${String(response.status)}.`);
      }
      const responseBody: unknown = await response.json();
      const responseData = runEffectResponseSchema.parse(responseBody);
      if (!responseData.success || !responseData.data?.dispatched) {
        throw new Error(
          responseData.message || 'Platform did not dispatch the Coding Agent Session.',
        );
      }
      return this.succeeded(effect);
    } catch (error) {
      const settlement = failedSettlement(effect.launch, 'RUN_START', error);
      if (settlement.outcome.type === 'LAUNCH_OPERATION_UNCERTAIN') {
        return {
          ...settlement,
          outcome: {
            ...settlement.outcome,
            agentSessionId: effect.agentSessionId,
            conversationId: effect.conversationId,
          },
        };
      }
      return settlement;
    }
  }

  public find(agentSessionId: string): boolean {
    return this.runStore.lookupByAgentSessionId(agentSessionId) !== null;
  }

  private succeeded(
    effect: StartTaskMonitorRunEffect,
  ): EffectSettlement<TaskMonitorMachineEffectOutcome> {
    return {
      status: 'succeeded',
      outcome: {
        type: 'RUN_STARTED',
        taskMonitorId: effect.launch.taskMonitorId,
        taskId: effect.launch.taskId,
        agentSessionId: effect.agentSessionId,
        conversationId: effect.conversationId,
      },
    };
  }

  private reconcile(
    effect: StartTaskMonitorRunEffect,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    return Promise.resolve(
      this.find(effect.agentSessionId)
        ? this.succeeded(effect)
        : {
            status: 'uncertain',
            outcome: {
              type: 'LAUNCH_OPERATION_UNCERTAIN',
              taskMonitorId: effect.launch.taskMonitorId,
              taskId: effect.launch.taskId,
              cursor: effect.launch.cursor,
              operation: 'RUN_START',
              agentSessionId: effect.agentSessionId,
              conversationId: effect.conversationId,
              reason: 'The host Run is absent for the canonical Agent Session.',
            },
          },
    );
  }
}
