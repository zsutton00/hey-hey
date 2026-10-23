import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import { taskMonitorExecutionDefinitionJsonSchema } from '../../generated/task-monitor-contract.schema';
import {
  AgentSessionConfigV2TypeEnum,
  AgentSessionConfigV2VersionEnum,
  ReportType,
  TaskMonitorReviewMode,
  type ReportPayload,
  type TaskMonitorExecutionDefinition,
} from '../../shared/api/generated/api';
import type {
  SessionMonitorSettledTurnEvidence,
  TaskMonitorPlanGuidance,
} from '../../shared/agent-bridge-contract/generated/api';
import { TaskMonitorPlanContext } from '../../server/task-monitor-plan-context';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import type { TaskMonitorCoordinationLocalState } from './task-monitor-coordination';

const sectionSchema = z.object({
  key: z.string(),
  materializedMarkdown: z.string(),
});

const workItemSchema = z
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

const agentSessionSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
    status: z.string().min(1),
    conversationId: z.string().uuid().nullable(),
    serviceIds: z.array(z.string().min(1)).optional(),
    launchServiceId: z.string().min(1).optional(),
    config: z
      .object({
        type: z.literal(AgentSessionConfigV2TypeEnum.CodingSession),
        version: z.literal(AgentSessionConfigV2VersionEnum.V2),
        taskMonitorId: z.string().uuid().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const reportPayloadSchema = z
  .object({
    reportType: z.string().min(1),
    summary: z.string().optional(),
  })
  .passthrough();

const reportSchema = z
  .object({
    id: z.string().uuid(),
    reportType: z.string().min(1),
    createdAt: z.string().min(1),
    sourceExecutionId: z.string().uuid().nullable().optional(),
    payload: reportPayloadSchema,
  })
  .passthrough();

const itemEnvelopeSchema = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({ data: schema }).passthrough();
const listEnvelopeSchema = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({ data: z.array(schema).optional() }).passthrough();

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
addFormats(ajv);
const validateDefinition: ValidateFunction<TaskMonitorExecutionDefinition> = ajv.compile(
  taskMonitorExecutionDefinitionJsonSchema,
);
const knownReportTypes: ReadonlySet<string> = new Set(Object.values(ReportType));

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

export interface TaskMonitorSessionEvidence {
  id: string;
  status: string;
  conversationId: string;
  serviceIds: readonly string[];
  launchServiceId: string;
}

export interface TaskMonitorReportEvidence {
  id: string;
  reportType: string;
  createdAt: string;
  sourceExecutionId: string | null;
  payload: ReportPayload;
}

export interface TaskMonitorCanonicalEvidence {
  monitor: {
    id: string;
    status: string;
    executionStatus: string;
    cursor: number;
    reviewMode: TaskMonitorReviewMode;
    launch: {
      method: string;
      provider: string;
      model: string;
      reasoningEffort: string;
      fastMode?: boolean;
    };
  };
  planGuidance: TaskMonitorPlanGuidance | null;
  selectedTask: TaskMonitorSelectedTaskEvidence;
  remainingWork: ReadonlyArray<TaskMonitorRemainingWorkEvidence>;
  selectedSession: TaskMonitorSessionEvidence | null;
  releasedTurn: SessionMonitorSettledTurnEvidence | null;
  reports: ReadonlyArray<TaskMonitorReportEvidence>;
  /** Local machine evidence is present when coordination was admitted by the machine. */
  coordination?: TaskMonitorCoordinationLocalState;
}

export interface LoadTaskMonitorEvidenceInput {
  organizationId: string;
  projectId: string;
  monitorId: string;
  accessToken: string;
  settledTurn?: SessionMonitorSettledTurnEvidence;
  coordination?: TaskMonitorCoordinationLocalState;
}

const encode = (value: string): string => encodeURIComponent(value);

const readValidated = async <T>(
  deps: Pick<PromptTypeHandlerDeps, 'apiBaseUrl' | 'fetchImpl' | 'logger'>,
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

const parseExecutionDefinition = (
  monitor: z.infer<typeof workItemSchema>,
): TaskMonitorExecutionDefinition => {
  const section = monitor.sections?.find(({ key }) => key === 'executionDefinition');
  if (!section) throw new Error('Task Monitor is missing its executionDefinition section.');

  let definition: unknown;
  try {
    definition = JSON.parse(section.materializedMarkdown);
  } catch {
    throw new Error('Task Monitor executionDefinition contains malformed JSON.');
  }
  if (!validateDefinition(definition)) {
    const issues = (validateDefinition.errors ?? []).map(
      ({ instancePath, keyword, message }) =>
        `${instancePath || '/'} ${keyword}${message ? `: ${message}` : ''}`,
    );
    throw new Error(
      `Task Monitor executionDefinition failed generated-contract validation: ${issues.join('; ')}`,
    );
  }
  return definition;
};

const isReportPayload = (
  payload: z.infer<typeof reportPayloadSchema>,
  reportType: string,
): payload is z.infer<typeof reportPayloadSchema> & ReportPayload =>
  knownReportTypes.has(reportType) && payload.reportType === reportType;

const toReportPayload = (
  payload: z.infer<typeof reportPayloadSchema>,
  reportType: string,
): ReportPayload => {
  if (isReportPayload(payload, reportType)) return payload;
  throw new Error('Canonical Report payload discriminator did not match reportType.');
};

const uniqueById = <T extends { id: string }>(items: readonly T[]): T[] => {
  const seen = new Set<string>();
  return items.filter(({ id }) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const assertOwnedWorkItem = (
  item: z.infer<typeof workItemSchema>,
  expectedId: string,
  label: string,
  organizationId: string,
  projectId: string,
): void => {
  if (
    item.id !== expectedId ||
    item.organizationId !== organizationId ||
    item.projectId !== projectId
  ) {
    throw new Error(`${label} identity or ownership did not match the requested scope.`);
  }
};

export const loadTaskMonitorCanonicalEvidence = async (
  deps: Pick<PromptTypeHandlerDeps, 'apiBaseUrl' | 'fetchImpl' | 'logger'>,
  input: LoadTaskMonitorEvidenceInput,
): Promise<TaskMonitorCanonicalEvidence> => {
  const projectBase =
    `${deps.apiBaseUrl}/organizations/${encode(input.organizationId)}` +
    `/projects/${encode(input.projectId)}`;
  const monitorEnvelope = await readValidated(
    deps,
    `${projectBase}/work-items/${encode(input.monitorId)}`,
    'Task Monitor read',
    itemEnvelopeSchema(workItemSchema),
    input.accessToken,
  );
  const monitor = monitorEnvelope.data;
  assertOwnedWorkItem(
    monitor,
    input.monitorId,
    'Task Monitor',
    input.organizationId,
    input.projectId,
  );
  if (monitor.type !== 'TASK_MONITOR') {
    throw new Error('Task Monitor read returned a different work-item type.');
  }
  const executionDefinition = parseExecutionDefinition(monitor);
  const currentNode = executionDefinition.executionPlan[executionDefinition.cursor];
  if (!currentNode) {
    throw new Error('Task Monitor cursor does not identify an execution node.');
  }

  const [selectedTaskEnvelope, selectedContextEnvelope, remainingTaskEnvelopes] = await Promise.all(
    [
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
        executionDefinition.executionPlan
          .map((node, executionIndex) => ({ node, executionIndex }))
          .filter(({ executionIndex }) => executionIndex > executionDefinition.cursor)
          .map(async ({ node, executionIndex }) => ({
            node,
            executionIndex,
            envelope: await readValidated(
              deps,
              `${projectBase}/work-items/${encode(node.taskId)}`,
              `Remaining Task ${String(executionIndex)} read`,
              itemEnvelopeSchema(workItemSchema),
              input.accessToken,
            ),
          })),
      ),
    ],
  );
  const selectedTask = selectedTaskEnvelope.data;
  const selectedContext = selectedContextEnvelope.data;
  assertOwnedWorkItem(
    selectedTask,
    currentNode.taskId,
    'Selected Task',
    input.organizationId,
    input.projectId,
  );
  if (selectedContext.entityId !== currentNode.taskId || selectedContext.entityType !== 'TASK') {
    throw new Error('Selected Task context identity did not match the execution cursor.');
  }
  for (const { node, envelope } of remainingTaskEnvelopes) {
    assertOwnedWorkItem(
      envelope.data,
      node.taskId,
      'Remaining Task',
      input.organizationId,
      input.projectId,
    );
  }
  const session = currentNode.agentSessionId
    ? (
        await readValidated(
          deps,
          `${projectBase}/agent-sessions/${encode(currentNode.agentSessionId)}`,
          'Selected Agent Session read',
          itemEnvelopeSchema(agentSessionSchema),
          input.accessToken,
        )
      ).data
      : null;
  if (
    session &&
    (session.id !== currentNode.agentSessionId ||
      session.organizationId !== input.organizationId ||
      session.projectId !== input.projectId)
  ) {
    throw new Error('Selected Agent Session identity or ownership did not match the execution plan.');
  }
  const serviceIds = session ? [...new Set(session.serviceIds ?? [])] : [];
  const selectedSession = (() => {
    if (!session) return null;
    const conversationId = session.conversationId;
    const launchServiceId = session.launchServiceId;
    if (!conversationId || !launchServiceId || !serviceIds.includes(launchServiceId)) {
      throw new Error('Selected Agent Session has no valid launch service scope.');
    }
    return {
      id: session.id,
      status: session.status,
      conversationId,
      serviceIds,
      launchServiceId,
    };
  })();

  const planGuidance = await new TaskMonitorPlanContext({
    apiBaseUrl: deps.apiBaseUrl,
    fetchImpl: deps.fetchImpl,
    logger: deps.logger,
  }).resolve({
    organizationId: input.organizationId,
    projectId: input.projectId,
    taskId: currentNode.taskId,
    accessToken: input.accessToken,
  });

  const reports = session
    ? await (async (): Promise<TaskMonitorReportEvidence[]> => {
        const params = new URLSearchParams({
          projectId: input.projectId,
          sourceExecutionId: session.id,
          sortBy: 'createdAt',
          sortOrder: 'ASC',
          limit: '100',
        });
        const reportList = await readValidated(
          deps,
          `${deps.apiBaseUrl}/organizations/${encode(input.organizationId)}/reports?${params.toString()}`,
          'Selected Agent Session Report list',
          listEnvelopeSchema(reportSchema),
          input.accessToken,
        );
        return (reportList.data ?? []).map(
          (report): TaskMonitorReportEvidence => ({
            id: report.id,
            reportType: report.reportType,
            createdAt: report.createdAt,
            sourceExecutionId: report.sourceExecutionId ?? null,
            payload: toReportPayload(report.payload, report.reportType),
          }),
        );
      })()
    : [];

  const featureHierarchy = uniqueById(
    (selectedContext.featureHierarchy ?? []).map(
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
    (selectedContext.relatedEntities ?? [])
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

  const result: TaskMonitorCanonicalEvidence = {
    monitor: {
      id: monitor.id,
      status: monitor.status,
      executionStatus: monitor.status,
      cursor: executionDefinition.cursor,
      reviewMode: executionDefinition.launchPolicy.terminalSupervision.mode,
      launch: {
        method: currentNode.launchConfiguration.method,
        provider: currentNode.launchConfiguration.provider,
        model: currentNode.launchConfiguration.model,
        reasoningEffort: currentNode.launchConfiguration.reasoningEffort,
        ...(currentNode.launchConfiguration.fastMode === undefined
          ? {}
          : { fastMode: currentNode.launchConfiguration.fastMode }),
      },
    },
    planGuidance,
    selectedTask: {
      executionIndex: executionDefinition.cursor,
      id: selectedTask.id,
      title: selectedTask.name,
      type: selectedTask.type,
      status: selectedTask.status,
      sections: selectedTask.sections ?? [],
      featureHierarchy,
      contracts,
    },
    remainingWork: remainingTaskEnvelopes.map(({ node, executionIndex, envelope }) => ({
      executionIndex,
      taskId: node.taskId,
      title: envelope.data.name,
      status: envelope.data.status,
      dependsOnTaskIds: node.dependsOnTaskIds,
      agentSessionId: node.agentSessionId ?? null,
    })),
    selectedSession,
    releasedTurn: input.settledTurn ?? null,
    reports,
    ...(input.coordination ? { coordination: input.coordination } : {}),
  };
  deps.logger.debug('task_monitor.coordinator.evidence.resolved', {
    monitorId: input.monitorId,
    currentTaskId: currentNode.taskId,
    remainingTaskCount: result.remainingWork.length,
    reportCount: result.reports.length,
    hasPlanGuidance: result.planGuidance != null,
    hasSelectedSession: result.selectedSession != null,
    turnId: result.releasedTurn?.turnId,
  });
  return result;
};
