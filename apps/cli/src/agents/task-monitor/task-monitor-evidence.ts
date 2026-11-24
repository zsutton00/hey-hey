import {
  TaskMonitorKind,
  resolveTaskMonitorKindConfiguration,
  type TaskMonitorKindConfiguration,
} from './kinds/task-monitor-kind';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import { taskMonitorExecutionDefinitionJsonSchema } from '@hey-hey/contracts/agent-bridge/custom/task-monitor-contract.schema';
import {
  AgentSessionConfigV2TypeEnum,
  AgentSessionConfigV2VersionEnum,
  ReportType,
  TaskMonitorReviewMode,
  type TaskMonitorRuntimeSelection,
  type ReportPayload,
  type TaskMonitorExecutionDefinition,
  type TaskMonitorOperationEvidence,
} from '@hey-hey/contracts/api/models';
import type {
  SessionMonitorSettledTurnEvidence,
  TaskMonitorPlanGuidance,
} from '@hey-hey/contracts/agent-bridge';
import {
  assertOwnedWorkItem,
  encode,
  itemEnvelopeSchema,
  readValidated,
  workItemSchema,
  type TaskMonitorContractEvidence,
  type TaskMonitorFeatureEvidence,
  type TaskMonitorRemainingWorkEvidence,
  type TaskMonitorSelectedTaskEvidence,
} from './kinds/task-monitor-task-coordinator-inputs';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import type { TaskMonitorCoordinationLocalState } from './task-monitor-coordination';
import { workItemTypeStatusesEnvelopeSchema, type TaskTypeStatus } from './task-finished-status';

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
    /** Saved runtime the Review sub-agent runs on; absent means the task session's runtime. */
    reviewRuntime?: TaskMonitorRuntimeSelection;
    launch: {
      method: string;
      provider: string;
      model: string;
      reasoningEffort: string;
      fastMode?: boolean;
    };
  };
  operationPolicy?: TaskMonitorKindConfiguration;
  operationEvidence?: TaskMonitorOperationEvidence | null;
  planGuidance: TaskMonitorPlanGuidance | null;
  selectedTask: TaskMonitorSelectedTaskEvidence & { typeStatuses: readonly TaskTypeStatus[] };
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
  assertOwnedWorkItem(monitor, input.monitorId, 'Task Monitor', input);
  if (monitor.type !== 'TASK_MONITOR') {
    throw new Error('Task Monitor read returned a different work-item type.');
  }
  const executionDefinition = parseExecutionDefinition(monitor);
  const currentNode = executionDefinition.executionPlan[executionDefinition.cursor];
  if (!currentNode) {
    throw new Error('Task Monitor cursor does not identify an execution node.');
  }

  const policy = await resolveTaskMonitorKindConfiguration(deps, {
    ...input,
    kindKey: executionDefinition.kind,
  });
  const coordinatorInputs = TaskMonitorKind.inputsFor(deps, policy);
  const nodeReads = await coordinatorInputs.readNodes({
    organizationId: input.organizationId,
    projectId: input.projectId,
    accessToken: input.accessToken,
    cursor: executionDefinition.cursor,
    executionPlan: executionDefinition.executionPlan,
  });
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
    throw new Error(
      'Selected Agent Session identity or ownership did not match the execution plan.',
    );
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

  const planGuidance = await coordinatorInputs.resolveGuidance(input, currentNode.taskId);

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

  const { selectedTask, remainingWork } = coordinatorInputs.project(
    nodeReads,
    executionDefinition.cursor,
  );

  const typeStatuses =
    policy.acceptance.type === 'COMPLETE_ITEM'
      ? (
          await readValidated(
            deps,
            `${projectBase}/work-item-types/${encode(selectedTask.type)}`,
            'Selected Task type read',
            workItemTypeStatusesEnvelopeSchema,
            input.accessToken,
          )
        ).data.definition.statuses
      : [];

  const result: TaskMonitorCanonicalEvidence = {
    operationPolicy: policy,
    operationEvidence: currentNode.operationEvidence ?? null,
    monitor: {
      id: monitor.id,
      status: monitor.status,
      executionStatus: monitor.status,
      cursor: executionDefinition.cursor,
      reviewMode: executionDefinition.launchPolicy.terminalSupervision.mode,
      ...(executionDefinition.launchPolicy.terminalSupervision.reviewRuntime
        ? { reviewRuntime: executionDefinition.launchPolicy.terminalSupervision.reviewRuntime }
        : {}),
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
    selectedTask: { ...selectedTask, typeStatuses },
    remainingWork,
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

export type {
  TaskMonitorContractEvidence,
  TaskMonitorFeatureEvidence,
  TaskMonitorRemainingWorkEvidence,
  TaskMonitorSelectedTaskEvidence,
};
