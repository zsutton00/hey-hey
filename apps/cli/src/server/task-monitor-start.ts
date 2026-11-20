import type { TaskResponseDto } from '@hey-hey/contracts/api/models';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import { taskMonitorExecutionDefinitionJsonSchema } from '@hey-hey/contracts/agent-bridge/custom/task-monitor-contract.schema';
import {
  TaskSectionUpdateSource,
  UpdateTaskResultStatus,
  WorkStatus,
  type TaskMonitorExecutionDefinition,
  type TaskMonitorOperationEvidence,
} from '@hey-hey/contracts/api/models';
import type { ServerLogger } from './logger';
import type { PlatformAuthContext } from './platform-auth-context';
import { TaskMonitorPlanContext } from './task-monitor-plan-context';
import {
  TaskMonitorKind,
  TaskMonitorKindConfigurationError,
  resolveTaskMonitorKindConfiguration,
} from '../agents/task-monitor/kinds/task-monitor-kind';
import { TaskMonitorNodeResultReader } from '../agents/task-monitor/kinds/task-monitor-node-result-reader';
import type { TaskMonitorPlanGuidance } from '@hey-hey/contracts/agent-bridge';

const sectionSchema = z
  .object({
    key: z.string(),
    materializedMarkdown: z.string(),
  })
  .passthrough();

const serviceRelationSchema = z
  .object({
    serviceId: z.string().min(1),
  })
  .passthrough();

const workItemSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    type: z.string().min(1),
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
    status: z.string().min(1).optional(),
    sections: z.array(sectionSchema).optional(),
    serviceRelations: z.array(serviceRelationSchema).optional(),
  })
  .passthrough();

type WorkItem = z.infer<typeof workItemSchema>;

const taskMonitorMutationResponseSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal(UpdateTaskResultStatus.Applied),
      task: workItemSchema,
    })
    .passthrough(),
  z
    .object({
      status: z.literal(UpdateTaskResultStatus.Pending),
      task: workItemSchema,
    })
    .passthrough(),
]);

type TaskMonitorMutationResponse = z.infer<typeof taskMonitorMutationResponseSchema>;

export interface TaskMonitorStartTask {
  id: string;
  name: string;
  type: string;
  description: string;
  acceptanceCriteria: string | null;
  status?: string;
  serviceIds: readonly string[];
}

export interface TaskMonitorStartMonitor {
  id: string;
  name: string;
  organizationId: string;
  projectId: string;
  status: string;
  definition: TaskMonitorExecutionDefinition;
}

export interface TaskMonitorCompletionCommand {
  monitorId: string;
  organizationId: string;
  projectId: string;
}

export interface TaskMonitorCompletionResult {
  status: 'completed';
}

export interface TaskMonitorHaltCommand extends TaskMonitorCompletionCommand {
  failureContext: string;
}

export interface TaskMonitorHaltResult {
  status: 'halted';
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateDefinition: ValidateFunction<TaskMonitorExecutionDefinition> = ajv.compile(
  taskMonitorExecutionDefinitionJsonSchema,
);

const requireOk = async (response: Response, action: string): Promise<void> => {
  if (response.ok) return;
  const body = (await response.text()).slice(0, 500);
  throw new Error(
    body.trim() ? `${action} failed (${String(response.status)}): ${body}` : `${action} failed.`,
  );
};

const parseWorkItem = (text: string): WorkItem => {
  if (!text.trim()) throw new Error('Work Items returned an empty response.');
  const payload: unknown = JSON.parse(text);
  const envelope = z.object({ data: workItemSchema }).safeParse(payload);
  if (envelope.success) return envelope.data.data;
  const direct = workItemSchema.safeParse(payload);
  if (direct.success) return direct.data;
  throw new Error('Work Items response did not match the generated task boundary.');
};

const parseTaskMonitorMutationResponse = (text: string): TaskMonitorMutationResponse => {
  if (!text.trim()) throw new Error('Task Monitor mutation returned an empty response.');
  const payload: unknown = JSON.parse(text);
  const envelope = z.object({ data: taskMonitorMutationResponseSchema }).safeParse(payload);
  if (envelope.success) return envelope.data.data;
  const direct = taskMonitorMutationResponseSchema.safeParse(payload);
  if (direct.success) return direct.data;
  throw new Error('Task Monitor mutation response did not match the generated task boundary.');
};

const readSection = (task: WorkItem, keys: readonly string[]): string | null => {
  const normalized = new Set(keys.map((key) => key.toLowerCase().replace(/[^a-z0-9]/gu, '')));
  const section = task.sections?.find((candidate) =>
    normalized.has(candidate.key.toLowerCase().replace(/[^a-z0-9]/gu, '')),
  );
  const value = section?.materializedMarkdown.trim();
  return value ?? null;
};

const formatValidationIssue = (issue: ErrorObject): string => {
  const missingProperty =
    issue.keyword === 'required' && typeof issue.params['missingProperty'] === 'string'
      ? issue.params['missingProperty']
      : null;
  const path = missingProperty
    ? `${issue.instancePath}/${missingProperty}`
    : issue.instancePath || '/';
  return `${path} ${issue.message ?? 'is invalid'}`;
};

const definitionFromMonitor = (
  monitor: WorkItem,
  logger: ServerLogger,
): { definition: TaskMonitorExecutionDefinition; migratedLegacyReviewMode: boolean } => {
  const section = monitor.sections?.find((candidate) => candidate.key === 'executionDefinition');
  if (!section) throw new Error('Task Monitor is missing its executionDefinition section.');
  const parsed: unknown = JSON.parse(section.materializedMarkdown);
  const legacyDefinition = z
    .object({
      launchPolicy: z
        .object({
          terminalSupervision: z.object({ mode: z.literal('SKIP_REVIEW') }).passthrough(),
        })
        .passthrough(),
    })
    .passthrough()
    .safeParse(parsed);
  const normalized: unknown = legacyDefinition.success
    ? {
        ...legacyDefinition.data,
        launchPolicy: {
          ...legacyDefinition.data.launchPolicy,
          terminalSupervision: {
            ...legacyDefinition.data.launchPolicy.terminalSupervision,
            mode: 'AGENT_DECIDES',
          },
        },
      }
    : parsed;
  if (!validateDefinition(normalized)) {
    const issues = (validateDefinition.errors ?? []).map(formatValidationIssue);
    logger.error('task_monitor.start.monitor.definition.invalid', {
      monitorId: monitor.id,
      issues,
    });
    throw new Error(
      `Task Monitor executionDefinition failed generated-contract validation: ${issues.join('; ')}`,
    );
  }
  return { definition: normalized, migratedLegacyReviewMode: legacyDefinition.success };
};

export interface TaskMonitorStartRuntimeDependencies {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  authContext: PlatformAuthContext;
  logger: ServerLogger;
}

export class TaskMonitorStartRuntime {
  private readonly baseUrl: string;
  private readonly planContext: TaskMonitorPlanContext;
  private readonly nodeResults: TaskMonitorNodeResultReader;

  public constructor(private readonly dependencies: TaskMonitorStartRuntimeDependencies) {
    this.baseUrl = dependencies.apiBaseUrl.replace(/\/$/u, '');
    this.planContext = new TaskMonitorPlanContext(dependencies);
    this.nodeResults = new TaskMonitorNodeResultReader(dependencies);
  }

  /**
   * The kind a monitor runs: the entry of its project's effective TASK_MONITOR definition, as the
   * API resolves it, whose key the monitor recorded. Each call reads the definition afresh, so
   * monitors never share a kind by project, and a missing or unknown kind fails only its monitor.
   * State persisted before monitors recorded a key carries none (`kindKey: null`); the key is then
   * read from the monitor's own execution definition.
   */
  public async kindFor(scope: {
    organizationId: string;
    projectId: string;
    taskMonitorId: string;
    kindKey: string | null;
  }): Promise<TaskMonitorKind> {
    const kindKey =
      scope.kindKey ??
      (
        await this.readMonitor({
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          monitorId: scope.taskMonitorId,
        })
      ).definition.kind;
    if (scope.kindKey === null) {
      this.dependencies.logger.debug('task_monitor.kind.key_read_from_monitor', {
        monitorId: scope.taskMonitorId,
        projectId: scope.projectId,
        kind: kindKey,
      });
    }

    const token = await this.dependencies.authContext.getAccessToken();
    try {
      const configuration = await resolveTaskMonitorKindConfiguration(this.dependencies, {
        ...scope,
        kindKey,
        accessToken: token,
      });
      this.dependencies.logger.debug('task_monitor.kind.resolved', {
        monitorId: scope.taskMonitorId,
        projectId: scope.projectId,
        kind: configuration.key,
        start: configuration.start.type,
        done: configuration.done.type,
        supervision: configuration.supervision.type,
      });
      return new TaskMonitorKind(
        {
          runtime: this,
          authContext: this.dependencies.authContext,
          apiBaseUrl: this.dependencies.apiBaseUrl,
          fetchImpl: this.dependencies.fetchImpl,
          logger: this.dependencies.logger,
          results: this.nodeResults,
          monitorId: scope.taskMonitorId,
        },
        configuration,
      );
    } catch (error) {
      if (error instanceof TaskMonitorKindConfigurationError) {
        this.dependencies.logger.error('task_monitor.kind.configuration_invalid', {
          monitorId: scope.taskMonitorId,
          projectId: scope.projectId,
          kind: kindKey,
          reason: error.message,
        });
      }
      throw error;
    }
  }

  public async resolvePlanContext(input: {
    organizationId: string;
    projectId: string;
    taskId: string;
  }): Promise<TaskMonitorPlanGuidance | null> {
    const accessToken = await this.dependencies.authContext.getAccessToken();
    return this.planContext.resolve({ ...input, accessToken });
  }

  public async completeMonitor(
    command: TaskMonitorCompletionCommand,
  ): Promise<TaskMonitorCompletionResult> {
    const monitor = await this.readMonitor(command);
    if (monitor.status !== WorkStatus.Completed) await this.persistCompletion({ monitor });
    this.dependencies.logger.info('task_monitor.completion.completed', {
      monitorId: command.monitorId,
      status: WorkStatus.Completed,
    });
    return { status: 'completed' };
  }

  public async haltMonitor(command: TaskMonitorHaltCommand): Promise<TaskMonitorHaltResult> {
    const monitor = await this.readMonitor(command);
    if (monitor.status !== WorkStatus.Completed) {
      await this.persistHalt({ monitor, failureContext: command.failureContext });
    }
    this.dependencies.logger.info('task_monitor.halt.completed', {
      monitorId: command.monitorId,
      status: WorkStatus.OnHold,
    });
    return { status: 'halted' };
  }

  private buildUrl(organizationId: string, projectId: string, taskId: string): string {
    return (
      `${this.baseUrl}/organizations/${encodeURIComponent(organizationId)}` +
      `/projects/${encodeURIComponent(projectId)}/work-items/${encodeURIComponent(taskId)}`
    );
  }

  /*
   * SECURITY/PRODUCT BOUNDARY: Task Monitor runtime mutations must be auto-applied by the API's
   * user-source TASK_MONITOR governance rule. The runtime must never approve a returned proposal,
   * expose proposal approval to an agent, or accept an agent-selected proposal ID.
   *
   * Creating a Task Monitor is the user's authorization for its runtime to maintain that exact
   * monitor and its selected Tasks. A PENDING result means API policy did not recognize that
   * authorization and is a hard integration failure; it is not permission for the CLI to bypass
   * governance. Keep this check private to Task Monitor owner mutations.
   */
  private requireAppliedTaskMonitorMutation(
    organizationId: string,
    projectId: string,
    targetEntityId: string,
    mutation: TaskMonitorMutationResponse,
  ): void {
    if (
      mutation.task.id !== targetEntityId ||
      mutation.task.organizationId !== organizationId ||
      mutation.task.projectId !== projectId
    ) {
      throw new Error('Task Monitor mutation response did not match the authorized target scope.');
    }
    if (mutation.status === UpdateTaskResultStatus.Pending) {
      this.dependencies.logger.error('task_monitor.internal_mutation.unexpected_pending', {
        organizationId,
        projectId,
        targetEntityId,
      });
      throw new Error(
        'Task Monitor mutation remained pending instead of auto-applying under API governance.',
      );
    }
    this.dependencies.logger.debug('task_monitor.internal_mutation.applied', {
      targetEntityId,
    });
  }

  private async readWorkItem(
    organizationId: string,
    projectId: string,
    taskId: string,
  ): Promise<WorkItem> {
    const token = await this.dependencies.authContext.getAccessToken();
    const response = await this.dependencies.fetchImpl(
      `${this.buildUrl(organizationId, projectId, taskId)}?includeServiceRelations=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    await requireOk(response, 'Work item read');
    const workItem = parseWorkItem(await response.text());
    if (
      workItem.id !== taskId ||
      workItem.organizationId !== organizationId ||
      workItem.projectId !== projectId
    ) {
      throw new Error('Work item identity or ownership did not match the command context.');
    }
    return workItem;
  }

  public async readMonitor(input: {
    organizationId: string;
    projectId: string;
    monitorId: string;
  }): Promise<TaskMonitorStartMonitor> {
    this.dependencies.logger.debug('task_monitor.start.monitor.read.started', input);
    const monitor = await this.readWorkItem(input.organizationId, input.projectId, input.monitorId);
    if (monitor.type !== 'TASK_MONITOR') throw new Error('Command target is not a Task Monitor.');
    if (monitor.status === undefined) {
      throw new Error('Task Monitor is missing its canonical status.');
    }
    const parsedDefinition = definitionFromMonitor(monitor, this.dependencies.logger);
    let result: TaskMonitorStartMonitor = {
      id: monitor.id,
      name: monitor.name,
      organizationId: monitor.organizationId,
      projectId: monitor.projectId,
      status: monitor.status,
      definition: parsedDefinition.definition,
    };
    if (parsedDefinition.migratedLegacyReviewMode) {
      this.dependencies.logger.info('task_monitor.start.monitor.review_mode.migration.started', {
        monitorId: result.id,
        from: 'SKIP_REVIEW',
        to: 'AGENT_DECIDES',
      });
      result = await this.persistDefinition(
        result,
        result.definition,
        'Migrate legacy Task Monitor Review mode to Agent decides before continuing.',
      );
      this.dependencies.logger.info('task_monitor.start.monitor.review_mode.migration.completed', {
        monitorId: result.id,
        mode: result.definition.launchPolicy.terminalSupervision.mode,
      });
    }
    this.dependencies.logger.debug('task_monitor.start.monitor.read.completed', {
      monitorId: result.id,
      cursor: result.definition.cursor,
      status: result.status,
      executionPlanLength: result.definition.executionPlan.length,
    });
    return result;
  }

  public async readNodeItem(input: {
    organizationId: string;
    projectId: string;
    taskId: string;
    taskProjection?: boolean;
  }): Promise<TaskMonitorStartTask> {
    const task = await this.readWorkItem(input.organizationId, input.projectId, input.taskId);
    const taskDescription = readSection(task, ['description']);
    if (input.taskProjection && !taskDescription) {
      throw new Error(`Selected task "${task.name}" is missing its description.`);
    }
    const description = input.taskProjection
      ? taskDescription
      : (task.sections ?? [])
          .map((section) => `## ${section.key}\n${section.materializedMarkdown}`)
          .join('\n\n');

    return {
      id: task.id,
      name: task.name,
      type: task.type,
      description: description ?? '',
      acceptanceCriteria: readSection(task, ['acceptanceCriteria', 'acceptance_criteria']),
      ...(task.status === undefined ? {} : { status: task.status }),
      serviceIds: [...new Set((task.serviceRelations ?? []).map((relation) => relation.serviceId))],
    };
  }

  public async readTask(input: {
    organizationId: string;
    projectId: string;
    taskId: string;
  }): Promise<TaskMonitorStartTask> {
    const task = await this.readNodeItem({ ...input, taskProjection: true });
    if (!task.description) {
      throw new Error(`Selected task "${task.name}" is missing its description.`);
    }
    return task;
  }

  public async persistOperationEvidence(input: {
    organizationId: string;
    projectId: string;
    monitorId: string;
    nodeId: string;
    agentSessionId: string;
    evidence: TaskMonitorOperationEvidence | null;
  }): Promise<void> {
    const monitor = await this.readMonitor(input);
    const entry = monitor.definition.executionPlan[monitor.definition.cursor];
    if (entry?.taskId !== input.nodeId || entry.agentSessionId !== input.agentSessionId) {
      throw new Error('Operation result no longer matches the canonical cursor and session.');
    }
    await this.persistDefinition(
      monitor,
      {
        ...monitor.definition,
        executionPlan: monitor.definition.executionPlan.map((node, index) =>
          index === monitor.definition.cursor
            ? (() => {
                const { operationEvidence: _prior, ...current } = node;
                return input.evidence ? { ...current, operationEvidence: input.evidence } : current;
              })()
            : node,
        ),
      },
      'Record scoped Task Monitor operation evidence and coordinator admission.',
    );
  }

  public async persistTaskStatus({
    organizationId,
    projectId,
    task,
    status,
  }: {
    organizationId: string;
    projectId: string;
    task: TaskMonitorStartTask;
    status: WorkStatus;
  }): Promise<TaskMonitorStartTask> {
    const token = await this.dependencies.authContext.getAccessToken();
    const response = await this.dependencies.fetchImpl(
      this.buildUrl(organizationId, projectId, task.id),
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status,
          reason: 'Start selected Task Monitor work for coding-session launch.',
        }),
      },
    );
    await requireOk(response, `Task Monitor selected-task ${status} update`);
    const mutation = parseTaskMonitorMutationResponse(await response.text());
    this.requireAppliedTaskMonitorMutation(organizationId, projectId, task.id, mutation);
    return { ...task, status };
  }

  public async persistMonitorActive({
    monitor,
  }: {
    monitor: TaskMonitorStartMonitor;
  }): Promise<TaskMonitorStartMonitor> {
    return this.persistMonitorStatus({
      monitor,
      status: WorkStatus.Active,
      reason: 'Activate Task Monitor work item for its first selected-work launch.',
    });
  }

  public async persistMonitorStatus({
    monitor,
    status,
    reason,
  }: {
    monitor: TaskMonitorStartMonitor;
    status: TaskResponseDto['status'];
    reason: string;
  }): Promise<TaskMonitorStartMonitor> {
    const token = await this.dependencies.authContext.getAccessToken();
    const response = await this.dependencies.fetchImpl(
      this.buildUrl(monitor.organizationId, monitor.projectId, monitor.id),
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status,
          reason,
        }),
      },
    );
    await requireOk(response, `Task Monitor work-item ${status} update`);
    const mutation = parseTaskMonitorMutationResponse(await response.text());
    this.requireAppliedTaskMonitorMutation(
      monitor.organizationId,
      monitor.projectId,
      monitor.id,
      mutation,
    );
    return { ...monitor, status };
  }

  private async persistDefinition(
    monitor: TaskMonitorStartMonitor,
    definition: TaskMonitorExecutionDefinition,
    reason: string,
  ): Promise<TaskMonitorStartMonitor> {
    if (!validateDefinition(definition)) {
      throw new Error('Refusing to persist an invalid Task Monitor execution definition.');
    }
    const token = await this.dependencies.authContext.getAccessToken();
    const response = await this.dependencies.fetchImpl(
      this.buildUrl(monitor.organizationId, monitor.projectId, monitor.id),
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sections: [{ key: 'executionDefinition', content: definition }],
          sectionUpdateSource: TaskSectionUpdateSource.AgentSuggested,
          reason,
        }),
      },
    );
    await requireOk(response, 'Task Monitor execution-definition update');
    const mutation = parseTaskMonitorMutationResponse(await response.text());
    this.requireAppliedTaskMonitorMutation(
      monitor.organizationId,
      monitor.projectId,
      monitor.id,
      mutation,
    );
    return { ...monitor, definition };
  }

  public async persistCursor({
    monitor,
    cursor,
  }: {
    monitor: TaskMonitorStartMonitor;
    cursor: number;
  }): Promise<TaskMonitorStartMonitor> {
    const definition: TaskMonitorExecutionDefinition = {
      ...monitor.definition,
      cursor,
    };
    const persisted = await this.persistDefinition(
      monitor,
      definition,
      'Advance Task Monitor cursor past a satisfied operation.',
    );
    this.dependencies.logger.info('task_monitor.start.cursor.advance.completed', {
      monitorId: monitor.id,
      cursor,
    });
    return persisted;
  }

  public async persistLaunch({
    monitor,
    planIndex,
    agentSessionId,
  }: {
    monitor: TaskMonitorStartMonitor;
    planIndex: number;
    agentSessionId: string;
  }): Promise<TaskMonitorStartMonitor> {
    const executionPlan = monitor.definition.executionPlan.map((entry, index) =>
      index === planIndex
        ? (() => {
            const { operationEvidence: _prior, ...fresh } = entry;
            return { ...fresh, agentSessionId };
          })()
        : entry,
    );
    return this.persistDefinition(
      monitor,
      {
        ...monitor.definition,
        executionPlan,
      },
      'Record the Coding Agent Session launched for the current Task Monitor entry.',
    );
  }

  public persistCompletion({
    monitor,
  }: {
    monitor: TaskMonitorStartMonitor;
  }): Promise<TaskMonitorStartMonitor> {
    return this.persistMonitorStatus({
      monitor,
      status: WorkStatus.Completed,
      reason: 'Complete Task Monitor after every selected operation is satisfied.',
    });
  }

  public persistHalt({
    monitor,
    failureContext,
  }: {
    monitor: TaskMonitorStartMonitor;
    failureContext: string;
  }): Promise<TaskMonitorStartMonitor> {
    return this.persistMonitorStatus({
      monitor,
      status: WorkStatus.OnHold,
      reason: `Halt Task Monitor supervision: ${failureContext}`,
    });
  }
}
