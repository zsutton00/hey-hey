import { parseEffectiveWorkItemTypeDefinition } from '../../prompts/work-item-type-registry';
import { monitorOperationPolicyIssues } from '@hey-hey/contracts/monitor-kind-policy';
import { z } from 'zod';
import {
  WorkStatus,
  type TaskMonitorLaunchConfig,
  type TaskMonitorOperationEvidence,
  type WorkItemTypeMonitorKind,
  type WorkItemTypeMonitorKindSupervisionPolicy,
} from '@hey-hey/contracts/api/models';
import type { TaskMonitorPlanGuidance } from '@hey-hey/contracts/agent-bridge';
import { taskMonitorConversationWorkflow } from '../../../commands/agent-session-starter';
import { TaskMonitorTaskCoordinatorInputs } from './task-monitor-task-coordinator-inputs';
import type {
  TaskMonitorNodeResultReader,
  TaskMonitorNodeResultScope,
} from './task-monitor-node-result-reader';
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

/** A node plus the Agent Session its monitor recorded for it, if any. */
export interface TaskMonitorRecordedNode {
  readonly nodeId: string;
  readonly agentSessionId: string | null;
}

export interface TaskMonitorKindDependencies {
  readonly monitorId?: string;
  readonly runtime: TaskMonitorStartRuntime;
  readonly apiBaseUrl: string;
  readonly fetchImpl: typeof fetch;
  readonly logger: ServerLogger;
  readonly results: TaskMonitorNodeResultReader;
}

export type TaskMonitorAcceptanceResult =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: string };

/** What direct acceptance hands the monitor: accept the node, or fail it with a reason. */
export type TaskMonitorDirectVerdict =
  | { readonly accept: true }
  | { readonly accept: false; readonly reason: string };

/** A kind whose every policy is declared and whose policies form a supported combination. */
export type TaskMonitorKindConfiguration = Required<
  Pick<
    WorkItemTypeMonitorKind,
    'key' | 'allowedNodeTypes' | 'start' | 'done' | 'supervision' | 'acceptance'
  >
>;

/** A monitor's effective kind cannot run; the message names the kind, field, value and cause. */
export class TaskMonitorKindConfigurationError extends Error {
  public override readonly name = 'TaskMonitorKindConfigurationError';
}

/**
 * Checks the monitor's selected kind once, where it enters the runtime. The API
 * resolves legacy omissions centrally, so a policy still missing here is a
 * configuration fault, not a reason to assume Task behavior.
 */
export function taskMonitorKindConfiguration(
  kindKey: string,
  kind: WorkItemTypeMonitorKind | undefined,
): TaskMonitorKindConfiguration {
  if (kind === undefined) {
    throw new TaskMonitorKindConfigurationError(
      `Task Monitor selects the "${kindKey}" kind, which its project-effective TASK_MONITOR definition does not declare.`,
    );
  }

  const { key, start, done, supervision, acceptance } = kind;
  if (
    start === undefined ||
    done === undefined ||
    supervision === undefined ||
    acceptance === undefined
  ) {
    const missing = (['start', 'done', 'supervision', 'acceptance'] as const).filter(
      (field) => kind[field] === undefined,
    );
    throw new TaskMonitorKindConfigurationError(
      `"${key}" monitor kind has no ${missing.join(', ')} policy in its project-effective definition.`,
    );
  }

  const issues = monitorOperationPolicyIssues(kind);
  if (issues.length > 0) {
    throw new TaskMonitorKindConfigurationError(issues.join('; '));
  }
  return { key, allowedNodeTypes: kind.allowedNodeTypes, start, done, supervision, acceptance };
}

/** Reads current project policy without consumer defaults or policy pinning. */
export async function resolveTaskMonitorKindConfiguration(
  deps: { apiBaseUrl: string; fetchImpl: typeof fetch },
  scope: { organizationId: string; projectId: string; kindKey: string; accessToken: string },
): Promise<TaskMonitorKindConfiguration> {
  const response = await deps.fetchImpl(
    `${deps.apiBaseUrl.replace(/\/$/u, '')}/organizations/${encodeURIComponent(scope.organizationId)}/projects/${encodeURIComponent(scope.projectId)}/work-item-types/TASK_MONITOR`,
    { headers: { Authorization: `Bearer ${scope.accessToken}` } },
  );
  if (!response.ok) {
    throw new Error(`Task Monitor type definition read failed (${response.status}).`);
  }
  const definition = parseEffectiveWorkItemTypeDefinition(await response.json());
  return taskMonitorKindConfiguration(
    scope.kindKey,
    definition.capabilities?.monitorKinds?.find((kind) => kind.key === scope.kindKey),
  );
}

/**
 * A monitor's kind: everything a monitor does that depends on what its nodes are, interpreted
 * from the project-effective kind configuration. Handlers ask the kind to read, start, launch,
 * judge done and accept a node; reads and mutations go through the shared Work Items runtime.
 */
export class TaskMonitorKind {
  /**
   * The coordinator decision that accepts a settled node stays `ACCEPT_TASK`: it is a persisted,
   * generated decision name, so the kind owns what the decision does, not its name.
   */
  public readonly coordinatorInputs: TaskMonitorTaskCoordinatorInputs;

  private readonly baseUrl: string;

  public constructor(
    private readonly dependencies: TaskMonitorKindDependencies,
    private readonly configuration: TaskMonitorKindConfiguration,
  ) {
    this.baseUrl = dependencies.apiBaseUrl.replace(/\/$/u, '');
    this.coordinatorInputs = TaskMonitorKind.inputsFor(dependencies, configuration);
  }

  public static inputsFor(
    deps: { apiBaseUrl: string; fetchImpl: typeof fetch; logger: ServerLogger },
    configuration: TaskMonitorKindConfiguration,
  ): TaskMonitorTaskCoordinatorInputs {
    return new TaskMonitorTaskCoordinatorInputs(deps, configuration);
  }

  public get key(): string {
    return this.configuration.key;
  }

  /** `COORDINATOR_REVIEW` runs the coordinator under Review; `DIRECT_ACCEPTANCE` starts none. */
  public get supervision(): WorkItemTypeMonitorKindSupervisionPolicy['type'] {
    return this.configuration.supervision.type;
  }

  public async readNode(scope: TaskMonitorNodeScope): Promise<TaskMonitorStartTask> {
    const input = {
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      taskId: scope.nodeId,
    };
    const node =
      this.configuration.acceptance.type === 'COMPLETE_ITEM'
        ? await this.dependencies.runtime.readTask(input)
        : await this.dependencies.runtime.readNodeItem(input);
    if (!this.configuration.allowedNodeTypes.includes(node.type)) {
      throw new Error(
        `Selected work type "${node.type}" is not allowed by monitor kind "${this.key}".`,
      );
    }
    return node;
  }

  /**
   * True once starting the node has taken effect. A start that changes no status has nothing to
   * wait for, so launch reconciliation finds it started rather than retrying it.
   */
  public isStarted(node: Pick<TaskMonitorStartTask, 'status'>): boolean {
    const { start } = this.configuration;
    return start.type === 'NO_STATUS_CHANGE' || node.status === start.status;
  }

  public resolveGuidance(scope: TaskMonitorNodeScope): Promise<TaskMonitorPlanGuidance | null> {
    if (this.configuration.acceptance.type !== 'COMPLETE_ITEM') {
      return Promise.resolve(null);
    }
    return this.dependencies.runtime.resolvePlanContext({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      taskId: scope.nodeId,
    });
  }

  /** Starts the node by its declared status transition; an already started node is unchanged. */
  public async start(
    scope: Omit<TaskMonitorNodeScope, 'nodeId'>,
    node: TaskMonitorStartTask,
  ): Promise<TaskMonitorStartTask> {
    const { start } = this.configuration;
    if (start.type === 'NO_STATUS_CHANGE' || this.isStarted(node)) {
      return node;
    }
    return this.dependencies.runtime.persistTaskStatus({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      task: node,
      status: start.status,
    });
  }

  /** Maps the node to its launch conversation: Plan runs FeatureSync, others AgentSession. */
  public conversationTarget(method: TaskMonitorLaunchConfig['method'], nodeId: string) {
    return {
      entityType: 'task',
      entityId: nodeId,
      workflowType: taskMonitorConversationWorkflow(method),
    } as const;
  }

  /**
   * The kind's one done rule, used for selection, dependencies, launch revalidation, acceptance
   * confirmation and monitor completion. Item-status kinds judge the node as read; normalized
   * result kinds read the durable result of the node's recorded session.
   */
  public async isDone(
    scope: Omit<TaskMonitorNodeScope, 'nodeId'>,
    node: Pick<TaskMonitorStartTask, 'id' | 'status'>,
    agentSessionId: string | null,
  ): Promise<boolean> {
    const { done } = this.configuration;
    if (done.type === 'ITEM_STATUS') {
      return node.status === done.status;
    }
    return this.hasAcceptedResult({ ...scope, nodeId: node.id }, agentSessionId);
  }

  /** {@link isDone} through the authenticated platform session, for supervision. */
  public async readDone(auth: PlatformAuth, recorded: TaskMonitorRecordedNode): Promise<boolean> {
    const { done } = this.configuration;
    if (done.type === 'ITEM_STATUS') {
      return (await this.readStatus(auth, recorded.nodeId)) === done.status;
    }
    return this.hasAcceptedResult(
      { organizationId: auth.organizationId, projectId: auth.projectId, nodeId: recorded.nodeId },
      recorded.agentSessionId,
    );
  }

  /**
   * Direct acceptance's verdict on a node: its durable normalized result. At settlement, pass the
   * Turn's report IDs so only a result that Turn produced can settle it. A missing, failed or
   * malformed result fails the node.
   */
  public async judgeSettled(scope: TaskMonitorNodeResultScope): Promise<TaskMonitorDirectVerdict> {
    const result = await this.dependencies.results.read(scope);
    return result.outcome === 'ACCEPTED'
      ? { accept: true }
      : { accept: false, reason: result.reason };
  }

  /**
   * Accepts a settled node: first completes the node's Agent Session when requested, then
   * applies its explicit lifecycle effect through Work Items when required,
   * and confirms operation satisfaction from canonical evidence before reporting acceptance.
   */
  public async acceptSettled(
    auth: PlatformAuth,
    recorded: TaskMonitorRecordedNode,
    completeSession: (() => Promise<void>) | null,
  ): Promise<TaskMonitorAcceptanceResult> {
    if (completeSession) {
      await completeSession();
    }

    const { acceptance } = this.configuration;
    if (acceptance.type === 'NO_STATUS_CHANGE') {
      return (await this.readDone(auth, recorded))
        ? { accepted: true }
        : { accepted: false, reason: 'Selected node has no accepted normalized result.' };
    }

    if ((await this.readStatus(auth, recorded.nodeId)) !== WorkStatus.Completed) {
      await this.patchStatus(auth, recorded.nodeId, WorkStatus.Completed);
    }
    const settled = await this.readStatus(auth, recorded.nodeId);
    if (settled !== WorkStatus.Completed) {
      this.dependencies.logger.warn('task_monitor.kind.accept.not_settled', {
        kind: this.key,
        nodeId: recorded.nodeId,
        status: settled,
        expected: WorkStatus.Completed,
      });
      return {
        accepted: false,
        reason: `Selected Task did not settle ${WorkStatus.Completed.toLowerCase()} (${settled}).`,
      };
    }
    return { accepted: true };
  }

  private async operationEvidence(
    scope: TaskMonitorNodeScope,
    agentSessionId: string,
  ): Promise<TaskMonitorOperationEvidence | undefined> {
    const monitorId = this.dependencies.monitorId;
    if (!monitorId) {
      throw new Error('Coordinator result read has no monitor owner.');
    }
    const monitor = await this.dependencies.runtime.readMonitor({ ...scope, monitorId });
    const entry = monitor.definition.executionPlan.find((node) => node.taskId === scope.nodeId);
    if (
      entry?.agentSessionId !== agentSessionId ||
      entry.operationEvidence?.agentSessionId !== agentSessionId
    ) {
      return undefined;
    }
    return entry.operationEvidence;
  }

  /** Save released operation provenance before Review; Review never substitutes its own report. */
  public async retainOperationResult(
    scope: TaskMonitorNodeResultScope,
    turnId: string,
    isReview: boolean,
  ): Promise<void> {
    if (
      this.configuration.done.type !== 'NORMALIZED_RESULT' ||
      this.supervision !== 'COORDINATOR_REVIEW'
    ) {
      return;
    }
    if (isReview) {
      return;
    }
    const result = await this.dependencies.results.read(scope);
    await this.dependencies.runtime.persistOperationEvidence({
      ...scope,
      monitorId: this.dependencies.monitorId!,
      evidence:
        result.outcome === 'MISSING'
          ? null
          : { agentSessionId: scope.agentSessionId, turnId, reportId: result.reportId },
    });
  }

  /** Called only after coordinator/Review admission; pending child evidence alone never counts. */
  public async admitOperation(
    auth: PlatformAuth,
    recorded: TaskMonitorRecordedNode,
    coordinatorRunId: string,
  ): Promise<void> {
    if (
      this.configuration.done.type !== 'NORMALIZED_RESULT' ||
      this.supervision !== 'COORDINATOR_REVIEW'
    ) {
      return;
    }
    if (!recorded.agentSessionId) {
      throw new Error('Operation acceptance has no selected session.');
    }
    const scope = {
      organizationId: auth.organizationId,
      projectId: auth.projectId,
      nodeId: recorded.nodeId,
    };
    const evidence = await this.operationEvidence(scope, recorded.agentSessionId);
    if (!evidence) {
      throw new Error(
        'Operation acceptance has no valid MONITOR_NODE_RESULT in the released Turn for the selected node and session.',
      );
    }
    const result = await this.dependencies.results.read({
      ...scope,
      agentSessionId: recorded.agentSessionId,
      turnReportIds: [evidence.reportId],
    });
    if (result.outcome !== 'ACCEPTED') {
      throw new Error(result.reason);
    }
    await this.dependencies.runtime.persistOperationEvidence({
      ...scope,
      monitorId: this.dependencies.monitorId!,
      agentSessionId: recorded.agentSessionId,
      evidence: { ...evidence, coordinatorRunId },
    });
  }

  private async hasAcceptedResult(
    scope: TaskMonitorNodeScope,
    agentSessionId: string | null,
  ): Promise<boolean> {
    if (agentSessionId === null) {
      return false;
    }
    if (this.supervision === 'COORDINATOR_REVIEW') {
      const evidence = await this.operationEvidence(scope, agentSessionId);
      if (!evidence?.coordinatorRunId) {
        return false;
      }
      const verdict = await this.judgeSettled({
        ...scope,
        agentSessionId,
        turnReportIds: [evidence.reportId],
      });
      return verdict.accept;
    }
    const verdict = await this.judgeSettled({ ...scope, agentSessionId });
    return verdict.accept;
  }

  private urlFor(auth: PlatformAuth, nodeId: string): string {
    return (
      `${this.baseUrl}/organizations/${encodeURIComponent(auth.organizationId)}` +
      `/projects/${encodeURIComponent(auth.projectId)}/work-items/${encodeURIComponent(nodeId)}`
    );
  }

  private async patchStatus(auth: PlatformAuth, nodeId: string, status: WorkStatus): Promise<void> {
    const response = await this.dependencies.fetchImpl(this.urlFor(auth, nodeId), {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status,
        reason: 'Apply an accepted Task Monitor decision through Work Items.',
      }),
    });
    if (!response.ok) {
      const responseBody = (await response.text()).slice(0, 500);
      this.dependencies.logger.error('task_monitor.kind.accept.patch_failed', {
        kind: this.key,
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
      this.dependencies.logger.error('task_monitor.kind.read.failed', {
        kind: this.key,
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
    this.dependencies.logger.error('task_monitor.kind.read.invalid_response', {
      kind: this.key,
      nodeId,
    });
    throw new Error('Selected Task read returned an invalid response.');
  }
}
