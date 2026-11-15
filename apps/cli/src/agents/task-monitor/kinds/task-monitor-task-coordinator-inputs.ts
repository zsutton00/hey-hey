import { z } from 'zod';
import type { TaskMonitorPlanGuidance } from '@hey-hey/contracts/agent-bridge';
import { TaskMonitorPlanContext } from '../../../server/task-monitor-plan-context';
import type { ServerLogger } from '../../../server/logger';

export interface TaskMonitorCoordinatorInputsDependencies {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  logger: ServerLogger;
}

const sectionSchema = z.object({
  key: z.string(),
  materializedMarkdown: z.string(),
});

export const workItemSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    type: z.string().min(1),
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
    status: z.string().min(1),
    sections: z.array(sectionSchema).optional(),
  })
  .passthrough();

const relatedEntitySchema = z
  .object({
    entityId: z.string().uuid(),
    entityType: z.string().min(1),
    displayName: z.string().min(1),
    status: z.string().optional(),
    relationship: z.string().min(1),
    reasoning: z.string().optional(),
    taskType: z.string().optional(),
  })
  .passthrough();

const featureHierarchySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    tag: z.string().optional(),
    relationshipType: z.string().min(1),
    relationship: z.string().optional(),
    direction: z.string().optional(),
    distance: z.number().int().positive().optional(),
    reasoning: z.string().optional(),
  })
  .passthrough();

const entityContextSchema = z
  .object({
    entityId: z.string().uuid(),
    entityType: z.string().min(1),
    displayName: z.string().min(1),
    relatedEntities: z.array(relatedEntitySchema).optional(),
    featureHierarchy: z.array(featureHierarchySchema).optional(),
  })
  .passthrough();

export const itemEnvelopeSchema = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({ data: schema }).passthrough();

export interface TaskMonitorFeatureEvidence {
  id: string;
  title: string;
  tag?: string;
  relationship: string;
  direction?: string;
  distance?: number;
  reasoning?: string;
}

export interface TaskMonitorContractEvidence {
  id: string;
  title: string;
  relationship: string;
  reasoning?: string;
}

export interface TaskMonitorSelectedTaskEvidence {
  executionIndex: number;
  id: string;
  title: string;
  type: string;
  status: string;
  sections: ReadonlyArray<{ key: string; materializedMarkdown: string }>;
  featureHierarchy: ReadonlyArray<TaskMonitorFeatureEvidence>;
  contracts: ReadonlyArray<TaskMonitorContractEvidence>;
}

export interface TaskMonitorRemainingWorkEvidence {
  executionIndex: number;
  taskId: string;
  title: string;
  status: string;
  dependsOnTaskIds: readonly string[];
  agentSessionId: string | null;
}

export const encode = (value: string): string => encodeURIComponent(value);

export const readValidated = async <T>(
  deps: TaskMonitorCoordinatorInputsDependencies,
  url: string,
  action: string,
  schema: z.ZodType<T>,
  accessToken: string,
): Promise<T> => {
  deps.logger.debug('task_monitor.coordinator.evidence.read_started', { action, url });
  const response = await deps.fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await response.text();
  if (!response.ok) {
    deps.logger.warn('task_monitor.coordinator.evidence.read_http_failed', {
      action,
      url,
      status: response.status,
    });
    throw new Error(`${action} failed (${String(response.status)}): ${text.slice(0, 500)}`);
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${action} returned malformed JSON.`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(({ code, path }) => `${path.join('.')} ${code}`);
    throw new Error(`${action} failed boundary validation: ${issues.join('; ')}`);
  }
  deps.logger.debug('task_monitor.coordinator.evidence.read_completed', { action, url });
  return parsed.data;
};

export interface TaskMonitorExecutionNodeRef {
  taskId: string;
  dependsOnTaskIds: readonly string[];
  agentSessionId?: string | null;
}

export interface TaskMonitorCoordinatorInputsRequest {
  organizationId: string;
  projectId: string;
  accessToken: string;
  cursor: number;
  executionPlan: ReadonlyArray<TaskMonitorExecutionNodeRef>;
}

export interface TaskMonitorCoordinatorNodeReads {
  selected: z.infer<typeof workItemSchema>;
  context: z.infer<typeof entityContextSchema>;
  remaining: ReadonlyArray<{
    node: TaskMonitorExecutionNodeRef;
    executionIndex: number;
    item: z.infer<typeof workItemSchema>;
  }>;
}

const uniqueById = <T extends { id: string }>(items: readonly T[]): T[] => {
  const seen = new Set<string>();
  return items.filter(({ id }) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

export const assertOwnedWorkItem = (
  item: z.infer<typeof workItemSchema>,
  expectedId: string,
  label: string,
  scope: { organizationId: string; projectId: string },
): void => {
  if (
    item.id !== expectedId ||
    item.organizationId !== scope.organizationId ||
    item.projectId !== scope.projectId
  ) {
    throw new Error(`${label} identity or ownership did not match the requested scope.`);
  }
};

/**
 * The Task kind's coordinator inputs: reads the selected Task, its context and the remaining
 * Tasks, and projects them into the evidence the coordinator prompt consumes.
 */
export class TaskMonitorTaskCoordinatorInputs {
  public constructor(private readonly deps: TaskMonitorCoordinatorInputsDependencies) {}

  public async readNodes(
    input: TaskMonitorCoordinatorInputsRequest,
  ): Promise<TaskMonitorCoordinatorNodeReads> {
    const { deps } = this;
    const currentNode = input.executionPlan[input.cursor];
    if (!currentNode) {
      throw new Error('Task Monitor cursor does not identify an execution node.');
    }
    const projectBase =
      `${deps.apiBaseUrl}/organizations/${encode(input.organizationId)}` +
      `/projects/${encode(input.projectId)}`;
    const [selectedEnvelope, contextEnvelope, remainingEnvelopes] = await Promise.all([
      readValidated(
        deps,
        `${projectBase}/work-items/${encode(currentNode.taskId)}?includeEdges=true`,
        'Selected Task read',
        itemEnvelopeSchema(workItemSchema),
        input.accessToken,
      ),
      readValidated(
        deps,
        `${projectBase}/entities/TASK/${encode(currentNode.taskId)}/context`,
        'Selected Task context read',
        itemEnvelopeSchema(entityContextSchema),
        input.accessToken,
      ),
      Promise.all(
        input.executionPlan
          .map((node, executionIndex) => ({ node, executionIndex }))
          .filter(({ executionIndex }) => executionIndex > input.cursor)
          .map(async ({ node, executionIndex }) => ({
            node,
            executionIndex,
            item: (
              await readValidated(
                deps,
                `${projectBase}/work-items/${encode(node.taskId)}`,
                `Remaining Task ${String(executionIndex)} read`,
                itemEnvelopeSchema(workItemSchema),
                input.accessToken,
              )
            ).data,
          })),
      ),
    ]);
    const selected = selectedEnvelope.data;
    const context = contextEnvelope.data;
    assertOwnedWorkItem(selected, currentNode.taskId, 'Selected Task', input);
    if (context.entityId !== currentNode.taskId || context.entityType !== 'TASK') {
      throw new Error('Selected Task context identity did not match the execution cursor.');
    }
    for (const { node, item } of remainingEnvelopes) {
      assertOwnedWorkItem(item, node.taskId, 'Remaining Task', input);
    }
    return { selected, context, remaining: remainingEnvelopes };
  }

  public resolveGuidance(
    input: Pick<
      TaskMonitorCoordinatorInputsRequest,
      'organizationId' | 'projectId' | 'accessToken'
    >,
    taskId: string,
  ): Promise<TaskMonitorPlanGuidance | null> {
    return new TaskMonitorPlanContext(this.deps).resolve({
      organizationId: input.organizationId,
      projectId: input.projectId,
      taskId,
      accessToken: input.accessToken,
    });
  }

  public project(reads: TaskMonitorCoordinatorNodeReads, cursor: number) {
    const { selected, context, remaining } = reads;
    const featureHierarchy = uniqueById(
      (context.featureHierarchy ?? []).map(
        (feature): TaskMonitorFeatureEvidence => ({
          id: feature.id,
          title: feature.name,
          ...(feature.tag ? { tag: feature.tag } : {}),
          relationship: feature.relationship ?? feature.relationshipType,
          ...(feature.direction ? { direction: feature.direction } : {}),
          ...(feature.distance ? { distance: feature.distance } : {}),
          ...(feature.reasoning ? { reasoning: feature.reasoning } : {}),
        }),
      ),
    );
    const contracts = uniqueById(
      (context.relatedEntities ?? [])
        .filter(({ entityType, taskType }) => entityType === 'CONTRACT' || taskType === 'CONTRACT')
        .map(
          (contract): TaskMonitorContractEvidence => ({
            id: contract.entityId,
            title: contract.displayName,
            relationship: contract.relationship,
            ...(contract.reasoning ? { reasoning: contract.reasoning } : {}),
          }),
        ),
    );
    const selectedTask: TaskMonitorSelectedTaskEvidence = {
      executionIndex: cursor,
      id: selected.id,
      title: selected.name,
      type: selected.type,
      status: selected.status,
      sections: selected.sections ?? [],
      featureHierarchy,
      contracts,
    };
    const remainingWork = remaining.map(
      ({ node, executionIndex, item }): TaskMonitorRemainingWorkEvidence => ({
        executionIndex,
        taskId: node.taskId,
        title: item.name,
        status: item.status,
        dependsOnTaskIds: node.dependsOnTaskIds,
        agentSessionId: node.agentSessionId ?? null,
      }),
    );
    return { selectedTask, remainingWork };
  }
}
