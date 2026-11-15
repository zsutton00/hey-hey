import { z } from 'zod';
import { WorkStatus, type TaskMonitorLaunchConfig } from '@hey-hey/contracts/api/models';
import type { TaskMonitorPlanGuidance } from '@hey-hey/contracts/agent-bridge';
import { taskMonitorConversationWorkflow } from '../../../commands/agent-session-starter';
import { TaskMonitorTaskCoordinatorInputs } from './task-monitor-task-coordinator-inputs';
import type { PlatformAuth } from '../../../server/platform-auth-context';
import type { ServerLogger } from '../../../server/logger';
import type {
  TaskMonitorStartRuntime,
  TaskMonitorStartTask,
} from '../../../server/task-monitor-start';

const workItemStatusSchema = z.object({ status: z.nativeEnum(WorkStatus) }).passthrough();
const workItemStatusEnvelopeSchema = z.object({ data: workItemStatusSchema }).passthrough();

export interface TaskMonitorNodeScope {
  readonly organizationId: string;
  readonly projectId: string;
  readonly nodeId: string;
}

export interface TaskMonitorKindDependencies {
  readonly runtime: TaskMonitorStartRuntime;
  readonly apiBaseUrl: string;
  readonly fetchImpl: typeof fetch;
  readonly logger: ServerLogger;
}

export type TaskMonitorAcceptanceResult =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: string };

/**
 * The Task kind: everything a Task Monitor does that depends on its node being a Task. Handlers
 * ask the kind to read, start, launch, judge done and accept a node, and never touch Task status,
 * Plan/Open/Quick mapping or COMPLETED patches themselves.
 */
export class TaskMonitorTaskKind {
  /**
   * The coordinator decision that accepts a settled Task node stays `ACCEPT_TASK`: it is a
   * persisted, generated decision name, so this kind owns what the decision does, not its name.
   */
  public readonly coordinatorInputs: TaskMonitorTaskCoordinatorInputs;

  private readonly baseUrl: string;

  public constructor(private readonly dependencies: TaskMonitorKindDependencies) {
    this.baseUrl = dependencies.apiBaseUrl.replace(/\/$/u, '');
    this.coordinatorInputs = new TaskMonitorTaskCoordinatorInputs(dependencies);
  }

  public readNode(scope: TaskMonitorNodeScope): Promise<TaskMonitorStartTask> {
    return this.dependencies.runtime.readTask({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      taskId: scope.nodeId,
    });
  }

  /** The kind's done signal: a Task is done when its status is COMPLETED. */
  public isDone(node: Pick<TaskMonitorStartTask, 'status'>): boolean {
    return node.status === WorkStatus.Completed;
  }

  /** True once starting the node has taken effect. */
  public isStarted(node: Pick<TaskMonitorStartTask, 'status'>): boolean {
    return node.status === WorkStatus.Active;
  }

  public resolveGuidance(scope: TaskMonitorNodeScope): Promise<TaskMonitorPlanGuidance | null> {
    return this.dependencies.runtime.resolvePlanContext({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      taskId: scope.nodeId,
    });
  }

  /** Starting a Task sets it ACTIVE; an already started node is returned unchanged. */
  public async start(
    scope: Omit<TaskMonitorNodeScope, 'nodeId'>,
    node: TaskMonitorStartTask,
  ): Promise<TaskMonitorStartTask> {
    if (this.isStarted(node)) {
      return node;
    }
    return this.dependencies.runtime.persistTaskActive({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      task: node,
    });
  }

  /** Maps the node to its launch conversation: Task entity, Plan runs FeatureSync, others AgentSession. */
  public conversationTarget(method: TaskMonitorLaunchConfig['method'], nodeId: string) {
    return {
      entityType: 'task',
      entityId: nodeId,
      workflowType: taskMonitorConversationWorkflow(method),
    } as const;
  }

  /** Reads the node's canonical done state through the authenticated platform session. */
  public async readDone(auth: PlatformAuth, nodeId: string): Promise<boolean> {
    return this.isDone({ status: await this.readStatus(auth, nodeId) });
  }

  /**
   * Accepts a settled node: first completes the node's Agent Session when requested, then
   * completes the node unless already done, reads it back and reports whether it settled.
   */
  public async acceptSettled(
    auth: PlatformAuth,
    nodeId: string,
    completeSession: (() => Promise<void>) | null,
  ): Promise<TaskMonitorAcceptanceResult> {
    if (completeSession) {
      await completeSession();
    }
    return this.accept(auth, nodeId);
  }

  private async accept(auth: PlatformAuth, nodeId: string): Promise<TaskMonitorAcceptanceResult> {
    if (!this.isDone({ status: await this.readStatus(auth, nodeId) })) {
      await this.patchCompleted(auth, nodeId);
    }
    const settled = await this.readStatus(auth, nodeId);
    if (!this.isDone({ status: settled })) {
      const reason = `Selected Task did not settle completed (${settled}).`;
      this.dependencies.logger.warn('task_monitor.kind.task.accept.not_settled', {
        nodeId,
        status: settled,
      });
      return { accepted: false, reason };
    }
    return { accepted: true };
  }

  private urlFor(auth: PlatformAuth, nodeId: string): string {
    return (
      `${this.baseUrl}/organizations/${encodeURIComponent(auth.organizationId)}` +
      `/projects/${encodeURIComponent(auth.projectId)}/work-items/${encodeURIComponent(nodeId)}`
    );
  }

  private async patchCompleted(auth: PlatformAuth, nodeId: string): Promise<void> {
    const response = await this.dependencies.fetchImpl(this.urlFor(auth, nodeId), {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: WorkStatus.Completed,
        reason: 'Apply an accepted Task Monitor decision through Work Items.',
      }),
    });
    if (!response.ok) {
      const responseBody = (await response.text()).slice(0, 500);
      this.dependencies.logger.error('task_monitor.kind.task.accept.patch_failed', {
        nodeId,
        status: response.status,
      });
      throw new Error(
        `Task Monitor supervision mutation failed (${String(response.status)}): ${responseBody}`,
      );
    }
  }

  private async readStatus(auth: PlatformAuth, nodeId: string): Promise<WorkStatus> {
    const response = await this.dependencies.fetchImpl(this.urlFor(auth, nodeId), {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    if (!response.ok) {
      this.dependencies.logger.error('task_monitor.kind.task.read.failed', {
        nodeId,
        status: response.status,
      });
      throw new Error(`Selected Task read failed with status ${String(response.status)}.`);
    }
    const payload: unknown = await response.json();
    const envelope = workItemStatusEnvelopeSchema.safeParse(payload);
    if (envelope.success) {
      return envelope.data.data.status;
    }
    const direct = workItemStatusSchema.safeParse(payload);
    if (direct.success) {
      return direct.data.status;
    }
    this.dependencies.logger.error('task_monitor.kind.task.read.invalid_response', { nodeId });
    throw new Error('Selected Task read returned an invalid response.');
  }
}
