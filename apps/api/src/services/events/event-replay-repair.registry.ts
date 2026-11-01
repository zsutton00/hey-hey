import {
  EntityType,
  ReportRelatedEntityType,
  ReportType,
} from '../../generated';
/**
 * API-owned event payload registry and repair routines.
 *
 * The CLI imports this module's behavior through EventReplayRepairService; it
 * remains here as a compatibility entry point for existing operators.
 */
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { MessageContentExtractor } from '../../utils/message-content-extractor';
import { getContentFromMessageData } from '../../utils/message-content.util';
import {
  inputSectionsToContentMap,
  materializedSectionsToContentMap,
} from '../../utils/work-item-section.util';
import {
  buildTaskEventContentSnapshot,
  toTaskSnapshot,
} from '../../utils/task-event.util';
import {
  buildInitiativeEventContentSnapshot,
  buildInitiativeEventSnapshot,
  buildInitiativeEventUpdateSnapshot,
} from '../../utils/initiative-event.util';
import { buildDesignDocEventDoc } from '../../utils/design-doc-event.util';
import type {
  MaterializedWorkItemSection,
  TaskEventTaskSnapshot,
  UpdateInitiativeDto,
} from '../../generated';
import type { DesignDocWithSectionsRecord } from '../../types/design-doc.types';
// Regex to detect JSON-like content (used for shouldProcess logic)
const IS_PROBABLY_JSON = /^(\[.*\]|\{.*\})$/;

const REPORT_TITLE_BY_TYPE = {
  CODING_RESEARCH: 'Coding Research',
  SNAPSHOT: 'Snapshot',
} as const;

/*
VALID EVENTS
artifact.archived
artifact.created
coding_prompt.created
coding_prompt.updated
implementation_hint.created
implementation_hint.updated
implementation_hint.deleted
agent_session.created
agent_session.deleted
agent_session.status_changed
conversation.created
conversation.deleted
conversation.updated
design_doc.archived
design_doc.created
design_doc.updated
initiative.archived
initiative.created
initiative.status_changed
initiative.updated
message.created
message.deleted
message.updated
message_processor.error
proposal.approved
report.created
service.created
service.updated
service.archived
summary.created
summary.deleted
summary.updated
task.archived
task.assigned
task.created
task.status_changed
task.updated
*/

// --- Zod Schemas ---

// Shared Enum Schemas (source: /src/generated/embeddings/model/)
const MessageTypeEnum = z.enum(['USER', 'SYSTEM']);

const MessageStatusEnum = z.enum([
  'system_processing',
  'streaming_ready',
  'open',
  'completed',
  'failed',
]);

const WorkStatusEnum = z.enum([
  'GENERATED',
  'BACKLOG',
  'REFINING_DESCRIPTION',
  'REFINING_DETAILS',
  'REFINING_ACCEPTANCE_CRITERIA',
  'GENERATING_DESCRIPTION',
  'GENERATING_DETAILS',
  'GENERATING_DESCRIPTION_AND_DETAILS',
  'GENERATING_ACCEPTANCE_CRITERIA',
  'GENERATING_ALL',
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
  'VERIFYING',
]);

const TaskPriorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const TaskTypeSchema = z.string() satisfies z.ZodType<
  TaskEventTaskSnapshot['type']
>;
const FeatureTagEnum = z.enum([
  'product',
  'frontend',
  'backend',
  'infra',
  'design',
  'AI',
]);

const ArtifactStatusEnum = z.enum([
  'ACTIVE',
  'ARCHIVED',
  'DELETED',
  'DRAFT',
  'DEPRECATED',
]);

const PriorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

const MessageIntentEnum = z.enum([
  'initiative_feedback',
  'content_update',
  'review_request',
  'approval',
  'rejection',
  'general',
]);

const InitiativeLevelEnum = z.enum([
  'description',
  'details',
  'acceptanceCriteria',
]);

const InitiativeActionEnum = z.enum([
  'refine',
  'update',
  'review',
  'approve',
  'reject',
]);

const UserMessageDataTypeEnum = z.enum(['CONTROL']);

const SystemMessageResponseTypeEnum = z.enum([
  'QUESTIONS',
  'ANALYSIS',
  'GENERATION',
  'TASKS',
  'TASK_PRIORITY',
  'TASK_STUB',
  'GENERIC_CONFIRM',
  'REFINEMENT_COMPLETE',
  'ERROR',
  'NOOP',
  'CODING_PROMPT',
  'CODING_PROMPTS',
  'INTEGRATIONS',
]);

const ImplementationHintSourceTypeEnum = z.enum(['USER', 'SYSTEM']);
const ImplementationHintExtractedFromEnum = z.enum(['AGENT', 'USER']);

// Helper Schemas for nested types
const UserMessageDataSchema = z
  .object({
    type: UserMessageDataTypeEnum.optional(),
    comment: z.string().optional(),
  })
  .passthrough(); // Dynamic key-value structure for user form responses

// UIHints schema - proper structure based on generated types
const UIHintSchema = z.object({
  type: z.enum(['input', 'select', 'checkbox', 'textarea', 'button']),
  label: z.string().optional(),
  placeholder: z.string().optional(),
});

const UIHintsSchema = z
  .object({
    expectedElements: z.array(UIHintSchema),
    estimatedCount: z.number(),
    estimatedDelayMs: z.number().optional(),
    layoutHint: z.enum(['form', 'grid', 'list', 'inline']).optional(),
  })
  .strict();

// Influence schema
const InfluenceEntityTypeEnum = z.nativeEnum(EntityType);

const InfluenceSchema = z
  .object({
    entityId: z.string().uuid(),
    entityType: InfluenceEntityTypeEnum,
    entityTitle: z.string().nullable().optional(),
    reasoning: z.string(),
    reasonType: z.string(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

// UIElement schema
const UIElementSchema = z
  .object({
    type: z.string(),
    id: z.string(),
    label: z.string().optional(),
    placeholder: z.string().optional(),
    required: z.boolean().optional(),
    options: z.array(z.any()).optional(),
    validation: z.any().optional(),
    influences: z.array(InfluenceSchema).optional(),
  })
  .passthrough(); // Some flexibility for different UI element types

// Action schema
const ActionSchema = z
  .object({
    type: z.string(),
    label: z.string().optional(),
    value: z.any().optional(),
  })
  .passthrough();

// Base fields from SystemMessageData that can appear on any subtype
const ActionHintEnum = z.enum([
  'task_complete',
  'permission_requested',
  'design_proposed',
  'review_requested',
]);
const systemMessageDataBaseFields = {
  triggerNotification: z.boolean().optional(),
  actionHint: ActionHintEnum.optional(),
  providerSessionId: z.string().optional(),
  promptHandler: z.string().optional(),
};

// SystemMessageData discriminated union based on type field
const QuestionsSystemMessageDataSchema = z
  .object({
    type: z.literal('QUESTIONS'),
    flowId: z.string().optional(),
    nodeId: z.string().optional(),
    response: z.string(),
    title: z.string().optional(),
    detectedIntent: z.string(),
    ragEnabled: z.boolean().optional(),
    intentConfidence: z.number(),
    reasoning: z.string().optional(),
    skippable: z.boolean().optional(),
    secondaryActions: z.array(z.any()).optional(),
    uiHints: UIHintsSchema.optional(),
    uiElements: z.array(UIElementSchema),
    actions: z.array(ActionSchema).optional(),
    ...systemMessageDataBaseFields,
  })
  .strict();

const AnalysisSystemMessageDataSchema = z
  .object({
    type: z.literal('ANALYSIS'),
    flowId: z.string().optional(),
    nodeId: z.string().optional(),
    response: z.string(),
    analysis: z.any(),
    uiElements: z.array(UIElementSchema).optional().default([]),
    actions: z.array(ActionSchema).optional(),
    ...systemMessageDataBaseFields,
  })
  .strict();

const GenerationSystemMessageDataSchema = z
  .object({
    type: z.literal('GENERATION'),
    flowId: z.string().optional(),
    nodeId: z.string().optional(),
    response: z.string(),
    summary: z.any().optional(),
    uiElements: z.array(UIElementSchema).optional().default([]),
    actions: z.array(ActionSchema).optional(),
    ...systemMessageDataBaseFields,
  })
  .strict();

const ErrorSystemMessageDataSchema = z
  .object({
    type: z.literal('ERROR'),
    flowId: z.string().optional(),
    nodeId: z.string().optional(),
    response: z.string(),
    title: z.string().optional(),
    error: z.string().optional(),
    retryable: z.boolean().optional(),
    detectedIntent: z.string().optional(),
    intentConfidence: z.number().optional(),
    uiElements: z.array(UIElementSchema).optional().default([]),
    actions: z.array(ActionSchema).optional(),
    ...systemMessageDataBaseFields,
  })
  .strict();

const NoopSystemMessageDataSchema = z
  .object({
    type: z.literal('NOOP'),
    flowId: z.string().optional(),
    nodeId: z.string().optional(),
    response: z.string(),
    uiElements: z.array(UIElementSchema).optional().default([]),
    actions: z.array(ActionSchema).optional(),
    ...systemMessageDataBaseFields,
  })
  .strict();

const TasksSystemMessageDataSchema = z
  .object({
    type: z.literal('TASKS'),
    flowId: z.string().optional(),
    nodeId: z.string().optional(),
    response: z.string(),
    tasks: z.array(z.any()),
    uiElements: z.array(UIElementSchema).optional().default([]),
    actions: z.array(ActionSchema).optional(),
    ...systemMessageDataBaseFields,
  })
  .strict();

const TaskPrioritySystemMessageDataSchema = z
  .object({
    type: z.literal('TASK_PRIORITY'),
    flowId: z.string().optional(),
    nodeId: z.string().optional(),
    response: z.string(),
    priorityQueue: z.array(z.any()),
    uiElements: z.array(UIElementSchema).optional().default([]),
    actions: z.array(ActionSchema).optional(),
    ...systemMessageDataBaseFields,
  })
  .strict();

const TaskStubSystemMessageDataSchema = z
  .object({
    type: z.enum(['TASK_STUB', 'TASK_STUBS']),
    flowId: z.string().optional(),
    nodeId: z.string().optional(),
    response: z.string(),
    taskStubs: z.array(z.any()),
    uiElements: z.array(UIElementSchema).optional().default([]),
    actions: z.array(ActionSchema).optional(),
    ...systemMessageDataBaseFields,
  })
  .strict();

const GenericConfirmSystemMessageDataSchema = z
  .object({
    type: z.literal('GENERIC_CONFIRM'),
    detectedIntent: z.string(),
    intentConfidence: z.number(),
    response: z.string().optional(),
  })
  .passthrough();

const RefinementCompleteSystemMessageDataSchema = z
  .object({
    type: z.literal('REFINEMENT_COMPLETE'),
    detectedIntent: z.string(),
    intentConfidence: z.number(),
    initiativeId: z.string(),
    changesApplied: z.number(),
    refinementComplete: z.boolean(),
    response: z.string().optional(),
  })
  .passthrough();

const CodingPromptSystemMessageDataSchema = z
  .object({
    type: z.enum(['CODING_PROMPT', 'CODING_PROMPTS']),
    flowId: z.string().optional(),
    nodeId: z.string().optional(),
    response: z.string(),
    prompt: z.string(),
    uiElements: z.array(UIElementSchema).optional().default([]),
    actions: z.array(ActionSchema).optional(),
    ...systemMessageDataBaseFields,
  })
  .strict();

const IntegrationsSystemMessageDataSchema = z
  .object({
    type: z.literal('INTEGRATIONS'),
    flowId: z.string().optional(),
    nodeId: z.string().optional(),
    response: z.string(),
    integrations: z.array(z.any()),
    uiElements: z.array(UIElementSchema).optional().default([]),
    actions: z.array(ActionSchema).optional(),
    ...systemMessageDataBaseFields,
  })
  .strict();

const AgentSystemMessageDataSchema = z
  .object({
    type: z.literal('AGENT'),
    flowId: z.string().optional(),
    nodeId: z.string().optional(),
    ragEnabled: z.boolean().optional(),
    title: z.string().optional(),
    response: z.string().optional(),
    detectedIntent: z.string(),
    intentConfidence: z.number(),
    reasoning: z.string().optional(),
    skippable: z.boolean().optional(),
    uiHints: UIHintsSchema.optional(),
    uiElements: z.array(UIElementSchema).optional().default([]),
    actions: z.array(ActionSchema).optional(),
    ...systemMessageDataBaseFields,
  })
  .strict();

const RoutingSystemMessageDataSchema = z
  .object({
    type: z.literal('ROUTING'),
    flowId: z.string().optional(),
    nodeId: z.string().optional(),
    ragEnabled: z.boolean().optional(),
    title: z.string().optional(),
    response: z.string().optional(),
    detectedIntent: z.string(),
    intentConfidence: z.number(),
    reasoning: z.string().optional(),
    uiHints: UIHintsSchema.optional(),
    uiElements: z.array(UIElementSchema).optional().default([]),
    actions: z.array(ActionSchema).optional(),
    ...systemMessageDataBaseFields,
  })
  .strict();

const InitiativesSystemMessageDataSchema = z
  .object({
    type: z.literal('INITIATIVES'),
    flowId: z.string().optional(),
    nodeId: z.string().optional(),
    response: z.string(),
    uiElements: z.array(UIElementSchema).optional().default([]),
    actions: z.array(ActionSchema).optional(),
  })
  .passthrough();

const ArtifactsGenerationSystemMessageDataSchema = z
  .object({
    type: z.literal('ARTIFACTS_GENERATION'),
    flowId: z.string().optional(),
    nodeId: z.string().optional(),
    response: z.string(),
    uiElements: z.array(UIElementSchema).optional().default([]),
    actions: z.array(ActionSchema).optional(),
  })
  .passthrough();

// Discriminated union for all system message data types
const SystemMessageDataSchema = z.discriminatedUnion('type', [
  QuestionsSystemMessageDataSchema,
  AnalysisSystemMessageDataSchema,
  GenerationSystemMessageDataSchema,
  ErrorSystemMessageDataSchema,
  NoopSystemMessageDataSchema,
  TasksSystemMessageDataSchema,
  TaskPrioritySystemMessageDataSchema,
  TaskStubSystemMessageDataSchema,
  GenericConfirmSystemMessageDataSchema,
  RefinementCompleteSystemMessageDataSchema,
  CodingPromptSystemMessageDataSchema,
  IntegrationsSystemMessageDataSchema,
  AgentSystemMessageDataSchema,
  RoutingSystemMessageDataSchema,
  InitiativesSystemMessageDataSchema,
  ArtifactsGenerationSystemMessageDataSchema,
]);

const MessageClassificationResultMetadataSchema = z
  .object({
    // Allow arbitrary metadata
  })
  .passthrough();

const MessageClassificationResultSchema = z
  .object({
    intent: MessageIntentEnum,
    confidence: z.number().min(0).max(1),
    targetInitiativeId: z.string().optional(),
    targetLevel: InitiativeLevelEnum.optional(),
    suggestedAction: InitiativeActionEnum.optional(),
    reasoning: z.string(),
    metadata: MessageClassificationResultMetadataSchema.optional(),
  })
  .passthrough();

const MessageResponseDtoSchema = z.unknown(); // Placeholder, can tighten if needed
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isTaskType(value: unknown): value is TaskEventTaskSnapshot['type'] {
  return TaskTypeSchema.safeParse(value).success;
}

function extractParentMessageContent(
  message: { type?: string; data?: unknown } | null | undefined,
): string | null {
  const type = message?.type;
  if (type !== 'USER' && type !== 'SYSTEM') {
    return null;
  }

  const data =
    message?.data && typeof message.data === 'object'
      ? (message.data as Record<string, unknown>)
      : undefined;
  return getContentFromMessageData(type, data);
}

export async function enrichMessageCreatedParentMessage(
  prisma: any,
  event: { aggregateId: string },
  payload: Record<string, any>,
): Promise<{ payload: Record<string, any> } | { reason: string }> {
  const message = payload?.message;
  if (!message || typeof message !== 'object') {
    return { reason: 'missing_message' };
  }

  if (message.id && message.id !== event.aggregateId) {
    return { reason: 'message_id_mismatch' };
  }

  if (message.type !== 'USER') {
    return { reason: 'non_user_message' };
  }

  if (
    message.parentMessage &&
    typeof message.parentMessage.content === 'string'
  ) {
    return { reason: 'already_has_parent_message' };
  }

  const parentMessageId = message.parentMessageId;
  if (typeof parentMessageId !== 'string' || !isUuid(parentMessageId)) {
    return { reason: 'missing_parent_message_id' };
  }

  const parent = await prisma.message.findUnique({
    where: { id: parentMessageId },
    select: { id: true, type: true, data: true },
  });
  if (!parent) {
    return { reason: 'parent_not_found' };
  }

  const parentContent = extractParentMessageContent(parent);
  if (!parentContent) {
    return { reason: 'parent_missing_content' };
  }

  const fixed = JSON.parse(JSON.stringify(payload));
  fixed.message.parentMessage = {
    id: parentMessageId,
    content: parentContent,
  };
  return { payload: fixed };
}

async function loadAgentSessionFixContext(
  prisma: any,
  codingSessionId: string,
) {
  return prisma.agentSession.findUnique({
    where: { id: codingSessionId },
    select: {
      id: true,
      organizationId: true,
      userId: true,
      status: true,
      type: true,
      sessionDate: true,
      title: true,
      conversationId: true,
      projectId: true,
      entityType: true,
      entityId: true,
      serviceId: true,
      provider: true,
      providerAgentSessionId: true,
      createdAt: true,
      updatedAt: true,
      conversation: {
        select: {
          id: true,
          projectId: true,
        },
      },
    },
  });
}

async function loadReportFixContext(prisma: any, reportId: string) {
  return prisma.report.findUnique({
    where: { id: reportId },
    include: { reportEntities: true },
  });
}

async function loadImplementationHintFixContext(prisma: any, hintId: string) {
  return prisma.implementationHint.findUnique({
    where: { id: hintId },
    select: {
      id: true,
      serviceId: true,
      agentSessionId: true,
      featureName: true,
      description: true,
      sourceType: true,
      hint: true,
      context: true,
      extractedFrom: true,
      confidence: true,
      version: true,
      createdAt: true,
      updatedAt: true,
      codingPromptRelations: {
        select: { codingPromptId: true },
      },
      fileReferences: {
        select: {
          id: true,
          hintId: true,
          filePath: true,
          startLine: true,
          endLine: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      versions: {
        select: {
          id: true,
          hintId: true,
          version: true,
          hint: true,
          context: true,
          extractedFrom: true,
          confidence: true,
          createdAt: true,
        },
        orderBy: { version: 'desc' },
      },
      service: {
        select: {
          organizationId: true,
          projectId: true,
        },
      },
    },
  });
}

function reportTitleForType(reportType: string): string {
  return (
    REPORT_TITLE_BY_TYPE[reportType as keyof typeof REPORT_TITLE_BY_TYPE] ??
    reportType
  );
}

function buildReportEventDto(
  report: Awaited<ReturnType<typeof loadReportFixContext>>,
): Record<string, unknown> | null {
  if (!report) {
    return null;
  }

  return {
    id: report.id,
    ragEnabled: report.ragEnabled,
    organizationId: report.organizationId,
    projectId: report.projectId ?? null,
    reportType: report.reportType,
    audience: report.audience,
    title: reportTitleForType(report.reportType),
    payload: report.payload,
    version: report.version,
    schemaVersion: report.schemaVersion,
    sourceExecutionId: report.sourceExecutionId ?? null,
    parentReportId: report.parentReportId ?? null,
    createdAt: report.createdAt.toISOString(),
    expiresAt: report.expiresAt?.toISOString() ?? null,
    entities: report.reportEntities.map((entity: any) => ({
      entityType: entity.entityType,
      entityId: entity.entityId,
      relation: entity.relation,
      createdAt: entity.createdAt.toISOString(),
    })),
  };
}

function buildImplementationHintEventDto(
  hint: Awaited<ReturnType<typeof loadImplementationHintFixContext>>,
): Record<string, unknown> | null {
  if (!hint) {
    return null;
  }

  const mapFileReference = (fileReference: {
    id: string;
    hintId: string;
    filePath: string;
    startLine: number | null;
    endLine: number | null;
    createdAt: Date;
  }) => ({
    id: fileReference.id,
    hintId: fileReference.hintId,
    filePath: fileReference.filePath,
    ...(fileReference.startLine !== null
      ? { startLine: fileReference.startLine }
      : {}),
    ...(fileReference.endLine !== null
      ? { endLine: fileReference.endLine }
      : {}),
    createdAt: fileReference.createdAt.toISOString(),
  });

  const mapVersion = (version: {
    id: string;
    hintId: string;
    version: number;
    hint: string;
    context: Prisma.JsonValue | null;
    extractedFrom: string;
    confidence: number | null;
    createdAt: Date;
  }) => ({
    id: version.id,
    hintId: version.hintId,
    version: version.version,
    hint: version.hint,
    ...(version.context !== null ? { context: version.context } : {}),
    extractedFrom: version.extractedFrom,
    ...(version.confidence !== null ? { confidence: version.confidence } : {}),
    createdAt: version.createdAt.toISOString(),
  });

  const latestVersion = hint.versions[0];

  return {
    id: hint.id,
    serviceId: hint.serviceId,
    agentSessionId: hint.agentSessionId,
    featureName: hint.featureName,
    description: hint.description,
    sourceType: hint.sourceType,
    ...(hint.hint !== null ? { hint: hint.hint } : {}),
    ...(hint.context !== null ? { context: hint.context } : {}),
    ...(hint.extractedFrom !== null
      ? { extractedFrom: hint.extractedFrom }
      : {}),
    ...(hint.confidence !== null ? { confidence: hint.confidence } : {}),
    version: hint.version,
    codingPromptIds: hint.codingPromptRelations.map(
      (relation: any) => relation.codingPromptId,
    ),
    fileReferences: hint.fileReferences.map(mapFileReference),
    versions: hint.versions.map(mapVersion),
    ...(latestVersion ? { latestVersion: mapVersion(latestVersion) } : {}),
    createdAt: hint.createdAt.toISOString(),
    updatedAt: hint.updatedAt.toISOString(),
  };
}

function hasMissingAgentSessionSnapshotFields(
  snapshot: Record<string, unknown> | null | undefined,
): boolean {
  return (
    !snapshot ||
    typeof snapshot.id !== 'string' ||
    typeof snapshot.organizationId !== 'string' ||
    typeof snapshot.userId !== 'string' ||
    typeof snapshot.status !== 'string' ||
    typeof snapshot.sessionDate !== 'string' ||
    typeof snapshot.title !== 'string'
  );
}

function buildAgentSessionSnapshot(
  codingSession: Awaited<ReturnType<typeof loadAgentSessionFixContext>>,
): Record<string, unknown> | null {
  if (!codingSession) {
    return null;
  }

  return {
    id: codingSession.id,
    organizationId: codingSession.organizationId,
    userId: codingSession.userId,
    status: codingSession.status,
    sessionDate: codingSession.sessionDate.toISOString(),
    title: codingSession.title,
    ...(codingSession.conversationId
      ? { conversationId: codingSession.conversationId }
      : {}),
    ...(codingSession.entityType === 'INITIATIVE' && codingSession.entityId
      ? { initiativeId: codingSession.entityId }
      : {}),
    ...(codingSession.entityType === 'TASK' && codingSession.entityId
      ? { taskId: codingSession.entityId }
      : {}),
    ...(codingSession.entityType === 'DESIGN_DOC' && codingSession.entityId
      ? { designDocId: codingSession.entityId }
      : {}),
    ...(codingSession.serviceId ? { serviceId: codingSession.serviceId } : {}),
    ...(codingSession.provider ? { provider: codingSession.provider } : {}),
    ...(codingSession.providerAgentSessionId
      ? { providerAgentSessionId: codingSession.providerAgentSessionId }
      : {}),
    createdAt: codingSession.createdAt.toISOString(),
    updatedAt: codingSession.updatedAt.toISOString(),
  };
}

function normalizeAgentSessionSnapshot(
  snapshot: Record<string, unknown>,
): boolean {
  let modified = false;

  const nullableOptionalKeys = [
    'conversationId',
    'initiativeId',
    'taskId',
    'designDocId',
    'serviceId',
    'service',
    'provider',
    'agentSessionId',
    'createdAt',
    'updatedAt',
  ];
  for (const key of nullableOptionalKeys) {
    if (snapshot[key] === null) {
      delete snapshot[key];
      modified = true;
    }
  }

  if (snapshot.sessionDate instanceof Date) {
    snapshot.sessionDate = snapshot.sessionDate.toISOString();
    modified = true;
  }
  if (snapshot.createdAt instanceof Date) {
    snapshot.createdAt = snapshot.createdAt.toISOString();
    modified = true;
  }
  if (snapshot.updatedAt instanceof Date) {
    snapshot.updatedAt = snapshot.updatedAt.toISOString();
    modified = true;
  }

  const dateKeys = ['sessionDate', 'createdAt', 'updatedAt'];
  for (const key of dateKeys) {
    if (typeof snapshot[key] !== 'string') {
      continue;
    }

    const parsed = new Date(snapshot[key] as string);
    if (Number.isNaN(parsed.getTime())) {
      continue;
    }

    const normalized = parsed.toISOString();
    if (snapshot[key] !== normalized) {
      snapshot[key] = normalized;
      modified = true;
    }
  }

  return modified;
}

const FlowUserMessageSchema = z
  .object({
    id: z.string().uuid(),
    workflowId: z.string(),
    projectId: z.string(),
    type: z.literal('USER'),
    userId: z.string().optional(),
    status: MessageStatusEnum,
    data: UserMessageDataSchema,
    conversationId: z.string().uuid(),
    parentMessageId: z.string().optional(),
    responses: z.array(MessageResponseDtoSchema).optional(),
    parentMessage: MessageResponseDtoSchema.optional(),
    createdAt: z.string(),
    nodeId: z.string().optional(),
    timestamp: z.string(),
    classification: MessageClassificationResultSchema.optional(),
  })
  .passthrough(); // Workflow-internal type, allow evolution

const ExecutionContext = z
  .object({
    payloadType: z.string(),
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
    requestId: z.string().optional(),
    workflowId: z.string().optional(),
    nodeId: z.string().optional(),
    conversationId: z.string().uuid().optional(),
    userId: z.string().optional(),
    messageId: z.string().optional(),
    userMessage: FlowUserMessageSchema.optional(), // ✓ No more z.any()
    correlationId: z.string().optional(),
    causationId: z.string().optional(),
    timestamp: z.string().datetime().optional(),
  })
  .strict();

// Shared Snapshot Schemas for Event Payloads
const SummaryCategoryEnum = z.enum([
  'technology',
  'product',
  'process',
  'people',
]);

const EntityTypeEnum = z.enum([
  'ARTIFACT',
  'INITIATIVE',
  'PROJECT',
  'TASK',
  'MESSAGE',
  'CONVERSATION',
  'DESIGN_DOC',
  'CODING_SESSION',
  'CODING_PROMPT',
  'SERVICE',
]);

const InitiativeEventSnapshotSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    details: z.string(),
    acceptanceCriteria: z.string(),
    organizationId: z.string(),
    originatingProjectId: z.string().optional(),
    linkedProjectIds: z.array(z.string()).optional(),
    status: WorkStatusEnum,
    priority: z.string().optional(),
    dueDate: z.string().optional(),
    tags: z.array(z.string()),
  })
  .strict();

const InitiativeEventUpdateSnapshotSchema = z
  .object({
    name: z.string().optional(),
    description: z.string(),
    details: z.string(),
    acceptanceCriteria: z.string(),
    assigneeId: z.string().optional(),
    reasoning: z.string().optional(),
    status: WorkStatusEnum.optional(),
    priority: z.string().optional(),
    creatorType: z.string().optional(),
    dueDate: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict();

const TaskEventTaskSnapshotSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    type: TaskTypeSchema,
    tag: FeatureTagEnum.optional(),
    details: z.string().optional(),
    acceptanceCriteria: z.string().optional(),
    requirements: z.string().optional(),
    projectId: z.string(),
    sections: z
      .array(
        z.object({
          key: z.string().min(1),
          order: z.number().int(),
          materializedMarkdown: z.unknown(),
        }),
      )
      .optional(),
    initiativeId: z.string().optional(),
    status: WorkStatusEnum.optional(),
    priority: TaskPriorityEnum.optional(),
    dueDate: z.string().optional(),
    assigneeId: z.string().optional(),
    parentTaskId: z.string().nullable(),
    id: z.string(),
    organizationId: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

const TaskEventUpdateSnapshotSchema = z
  .object({
    name: z.string().optional(),
    type: TaskTypeSchema.optional(),
    tag: FeatureTagEnum.optional(),
    description: z.string(),
    details: z.string().optional(),
    acceptanceCriteria: z.string().optional(),
    requirements: z.string().optional(),
    status: WorkStatusEnum.optional(),
    priority: TaskPriorityEnum.optional(),
    dueDate: z.string().optional(),
    assigneeId: z.string().optional(),
    parentTaskId: z.string().optional(),
  })
  .strict();

const DesignDocResponseDtoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    template: z.unknown(), // DesignDocTemplate - complex nested type
    status: z.string(),
    organizationId: z.string(),
    projectId: z.string().nullable().optional(),
    tags: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
    sections: z.array(z.unknown()), // Array<MaterializedDesignDocSection>
    summary: z.string().optional(),
  })
  .strict();

const CodingPromptSnapshotSchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    codingSessionId: z.string().optional(),
    agentSessionId: z.string().optional(),
    name: z.string().nullable().optional(),
    text: z.string(),
    type: z.string().nullable().optional(),
    feedback: z.string().nullable().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .strict()
  .refine((d) => d.codingSessionId || d.agentSessionId, {
    message: 'Either codingSessionId or agentSessionId is required',
  });

const AgentSessionStatusEnum = z.enum([
  'NOT_STARTED',
  'IN_PROGRESS',
  'COMPLETED',
  'ERRORED',
]);

const AgentSessionTypeEnum = z.enum([
  'CODING',
  'DAILY_SESSION',
  'TASK_REFINING',
  'ENTITY_CONVERSATION',
  'PROJECT_CONVERSATION',
  'DESIGN_DOC_REFINING',
]);

const AgentSessionServiceSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .strict();

const AgentSessionSnapshotSchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    userId: z.string(),
    status: AgentSessionStatusEnum,
    conversationId: z.string().optional(),
    initiativeId: z.string().optional(),
    taskId: z.string().optional(),
    designDocId: z.string().optional(),
    serviceId: z.string().optional(),
    service: AgentSessionServiceSummarySchema.optional(),
    provider: z.enum(['claude', 'codex']).optional(),
    agentSessionId: z.string().optional(),
    sessionDate: z.string().datetime(),
    title: z.string(),
    lastSyncedAt: z.string().datetime().nullable().optional(),
    hasUnsyncedChanges: z.boolean().optional(),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .strict();

const ReportTypeEnum = z.nativeEnum(ReportType);

const ReportAudienceEnum = z.enum([
  'WORKFLOW_ONLY',
  'PROJECT_VISIBLE',
  'ORGANIZATION_VISIBLE',
]);

const ReportEntityRelationEnum = z.enum(['PRIMARY', 'CONTEXT']);

const ReportRelatedEntityTypeEnum = z.nativeEnum(ReportRelatedEntityType);

const ReportEntitySchema = z
  .object({
    entityType: ReportRelatedEntityTypeEnum,
    entityId: z.string(),
    relation: ReportEntityRelationEnum,
    createdAt: z.string(),
  })
  .strict();

const ReportPayloadSchema = z
  .object({
    nextSteps: z.array(z.unknown()).optional(),
    verificationTasks: z.array(z.unknown()).optional(),
    recommendedUpdates: z.array(z.unknown()).optional(),
  })
  .catchall(z.unknown());

const ReportDtoSchema = z
  .object({
    id: z.string(),
    ragEnabled: z.boolean().optional(),
    organizationId: z.string(),
    projectId: z.string().nullable().optional(),
    reportType: ReportTypeEnum,
    audience: ReportAudienceEnum,
    title: z.string(),
    payload: ReportPayloadSchema,
    version: z.number(),
    schemaVersion: z.number(),
    sourceExecutionId: z.string().nullable().optional(),
    parentReportId: z.string().nullable().optional(),
    createdAt: z.string(),
    expiresAt: z.string().nullable(),
    entities: z.array(ReportEntitySchema),
  })
  .strict();

const SummaryPayloadSchema = z
  .object({
    summary: z.string(),
    category: SummaryCategoryEnum,
    subfacets: z.array(z.string()),
  })
  .strict();

const ServiceRepositoryTypeEnum = z.enum([
  'github',
  'gitlab',
  'bitbucket',
  'other',
]);

const ServiceTypeEnum = z.enum([
  'backend',
  'ui',
  'database',
  'worker',
  'mobile',
  'desktop',
  'library',
  'other',
]);

const ServiceStatusEnum = z.enum(['ACTIVE', 'ARCHIVED', 'DEPRECATED']);

const ServiceChildCountsSchema = z
  .object({
    tasks: z.number().optional(),
    initiatives: z.number().optional(),
    designDocs: z.number().optional(),
    codingSessions: z.number().optional(),
    implementationHints: z.number().optional(),
  })
  .strict();

const ServiceDtoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    organizationId: z.string(),
    projectId: z.string().optional(),
    repositoryUrl: z.string().optional(),
    repositoryType: ServiceRepositoryTypeEnum.optional(),
    repositoryId: z.string().optional(),
    serviceType: ServiceTypeEnum.optional(),
    language: z.string().optional(),
    framework: z.string().optional(),
    tags: z.array(z.string()).optional(),
    status: ServiceStatusEnum,
    childCounts: ServiceChildCountsSchema.optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    archivedAt: z.string().optional(),
  })
  .strict();

// Artifact Schemas
const BaseArtifactDataSchema = z.object({
  type: z.string(), // Enum validated by parent discriminator
  nodeId: z.string().optional(),
});

// Specific Artifact Data Schemas
const QAPairDataSchema = BaseArtifactDataSchema.extend({
  question: z.string(),
  answer: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  systemMessageId: z.string(),
  userMessageId: z.string(),
  questionField: z.string().optional(),
}).strict();

const DecisionDataSchema = BaseArtifactDataSchema.extend({
  title: z.string(),
  rationale: z.string(),
  alternatives: z.array(z.string()),
  outcome: z.string(),
  stakeholders: z.array(z.string()).optional(),
  relatedArtifactIds: z.array(z.string()).optional(),
  sourceConversationId: z.string().optional(),
}).strict();

const RequirementDataSchema = BaseArtifactDataSchema.extend({
  title: z.string(),
  description: z.string(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  status: z.enum(['DRAFT', 'APPROVED', 'IMPLEMENTED', 'DEPRECATED']),
  acceptanceCriteria: z.array(z.string()).optional(),
  sourceMessageId: z.string().optional(),
  relatedRequirements: z.array(z.string()).optional(),
}).strict();

const DocumentDataSchema = BaseArtifactDataSchema.extend({
  title: z.string(),
  content: z.string(),
  sections: z
    .array(
      z.object({
        title: z.string(),
        content: z.string(),
        order: z.number().int(),
      }),
    )
    .optional(),
  sourceDocumentId: z.string().optional(),
  relatedDocuments: z.array(z.string()).optional(),
}).strict();

const NoteDataSchema = BaseArtifactDataSchema.extend({
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()).optional(),
  sourceMessageId: z.string().optional(),
  relatedNotes: z.array(z.string()).optional(),
}).strict();

const TaskOriginalDataSchema = BaseArtifactDataSchema.extend({
  name: z.string(),
  description: z.string(),
  details: z.string().optional(),
  acceptanceCriteria: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  estimatedEffort: z.enum(['small', 'medium', 'large']).optional(),
  tags: z.array(z.string()).optional(),
  reasoning: z.string().optional(),
}).strict();

const TaskDataSchema = BaseArtifactDataSchema.extend({
  title: z.string(),
  description: z.string(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  assignee: z.string().optional(),
  dueDate: z.string().datetime().optional(),
  sourceMessageId: z.string().optional(),
  relatedTasks: z.array(z.string()).optional(),
}).strict();

const IssueDataSchema = BaseArtifactDataSchema.extend({
  title: z.string(),
  description: z.string(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  assignee: z.string().optional(),
  sourceSystemId: z.string().optional(),
  relatedIssues: z.array(z.string()).optional(),
}).strict();

const BugDataSchema = BaseArtifactDataSchema.extend({
  title: z.string(),
  description: z.string(),
  reproductionSteps: z.array(z.string()),
  expectedBehavior: z.string(),
  actualBehavior: z.string(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'FIXED', 'CLOSED']),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  sourceCommitId: z.string().optional(),
  relatedBugs: z.array(z.string()).optional(),
}).strict();

const CommentDataSchema = BaseArtifactDataSchema.extend({
  content: z.string(),
  author: z.string().optional(),
  timestamp: z.string().datetime().optional(),
  parentArtifactId: z.string().optional(),
  sourceMessageId: z.string().optional(),
}).strict();

const InitiativeArtifactDataSchema = BaseArtifactDataSchema.extend({
  content: z.string(), // JSON string
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
}).strict();

const InsightDataSchema = BaseArtifactDataSchema.extend({
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  content: z.string(),
}).strict();

// Generic fallback for other types not explicitly detailed but valid
const GenericArtifactDataSchema = BaseArtifactDataSchema.passthrough();

const ArtifactDataUnion = z.union([
  QAPairDataSchema,
  DecisionDataSchema,
  RequirementDataSchema,
  DocumentDataSchema,
  NoteDataSchema,
  TaskOriginalDataSchema,
  TaskDataSchema,
  IssueDataSchema,
  BugDataSchema,
  CommentDataSchema,
  InitiativeArtifactDataSchema,
  InsightDataSchema,
  GenericArtifactDataSchema,
]);

const CreateArtifactDtoSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    organizationId: z.string().uuid(),
    type: z.enum([
      'QA_PAIR',
      'DOCUMENT',
      'DOCUMENT_SECTION',
      'COMMENT',
      'TASK_ORIGINAL',
      'WORKSTREAM',
      'INSIGHT',
      'REFERENCE',
      'NOTE',
      'DECISION',
      'PULL_REQUEST',
      'ISSUE',
      'BUG',
      'REQUIREMENT',
      'INITIATIVE_ORIGINAL',
      'INITIATIVE_REFINED',
    ]),
    title: z.string().optional().nullable(),
    data: ArtifactDataUnion,
    parentId: z.string().uuid().optional().nullable(),
    sourceType: z.enum([
      'CONVERSATION',
      'INTEGRATION',
      'GITHUB_README',
      'GITHUB_DOCS',
      'GITHUB_ISSUE',
      'GITHUB_PULL_REQUEST',
      'INITIATIVE',
      'SYSTEM',
      'TASK',
      'ADR',
      'RFC',
      'MESSAGE',
    ]),
    sourceId: z.string(),
    tags: z.array(z.string()).optional(),
    category: z.string().optional().nullable(),
    priority: z
      .enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
      .optional()
      .nullable(),
    status: z
      .enum(['ACTIVE', 'ARCHIVED', 'DELETED', 'DRAFT', 'DEPRECATED'])
      .optional(),
    isPublic: z.boolean().optional(),
    generateEmbedding: z.boolean().optional(),
    influences: z.array(InfluenceSchema).optional(),
  })
  .strict();

const ArtifactCreatedSchema = ExecutionContext.extend({
  payloadType: z.literal('artifact.created'),
  artifact: CreateArtifactDtoSchema,
}).strict();

// Message Schemas
const MessageMentionSchema = z
  .object({
    entityId: z.string(),
    entityType: z.enum([
      'ARTIFACT',
      'INITIATIVE',
      'PROJECT',
      'TASK',
      'MESSAGE',
      'CONVERSATION',
      'DESIGN_DOC',
      'CODING_SESSION',
      'CODING_PROMPT',
      'SERVICE',
    ]),
  })
  .strict();

const CreateSystemMessageSchema = z
  .object({
    type: z.literal('SYSTEM'),
    workflowId: z.string().optional().nullable(),
    projectId: z.string(),
    status: z
      .enum([
        'open',
        'completed',
        'failed',
        'Open',
        'Completed',
        'Failed',
        'system_processing',
        'streaming_ready',
      ])
      .optional(),
    userId: z.string(),
    conversationId: z.string(),
    parentMessageId: z.string().optional().nullable(),
    createdAt: z.string().optional(),
    shouldProcess: z.boolean(), // Required for embedding service
    userMessage: z.string().optional(),
    systemMessage: z.string().optional(),
    id: z.string().optional(),
  })
  .strict();

const CreateUserMessageSchema = z
  .object({
    type: z.literal('USER'),
    workflowId: z.string().optional().nullable(),
    projectId: z.string(),
    status: z
      .enum([
        'open',
        'completed',
        'failed',
        'Open',
        'Completed',
        'Failed',
        'system_processing',
        'streaming_ready',
      ])
      .optional(),
    userId: z.string(),
    conversationId: z.string(),
    parentMessageId: z.string().optional().nullable(),
    parentMessage: z
      .object({
        id: z.string().uuid(),
        content: z.string(),
      })
      .optional()
      .nullable(),
    createdAt: z.string().optional(),
    shouldProcess: z.boolean(), // Required for embedding service
    userMessage: z.string().optional(),
    systemMessage: z.string().optional(),
    id: z.string().optional(),
  })
  .strict();

const MessageCreatedSchema = ExecutionContext.extend({
  payloadType: z.literal('message.created'),
  conversationId: z.string().uuid(), // Override to make it required for message.created
  message: z.union([CreateSystemMessageSchema, CreateUserMessageSchema]),
  messageDataType: z.string().optional(),
  mentions: z.array(MessageMentionSchema).optional(),
  sequenceNumber: z.number().int().optional(),
}).passthrough(); // message.created carries elevated fields from message.data (triggersAgent, completesExternalAgentNode, triggerNotification, etc.)

const ConversationCreatedSchema = ExecutionContext.extend({
  payloadType: z.literal('conversation.created'),
  workflowAboutId: z.string().optional(),
  workflowAboutType: z.string().optional(),
  workflowName: z.string(),
  conversationTitle: z.string().optional(),
  initiatedBy: z.enum(['SYSTEM', 'USER', 'system', 'user']),
  status: z.string(),
  version: z.number().int().min(0).optional(),
}).strict();

// Initiative Event Schemas
const InitiativeCreatedSchema = ExecutionContext.extend({
  payloadType: z.literal('initiative.created'),
  initiative: InitiativeEventSnapshotSchema,
}).strict();

const InitiativeArchivedSchema = ExecutionContext.extend({
  payloadType: z.literal('initiative.archived'),
  archivedAt: z.string(),
}).strict();

const InitiativeUpdatedSchema = ExecutionContext.extend({
  payloadType: z.literal('initiative.updated'),
  update: InitiativeEventUpdateSnapshotSchema,
  linkedProjectIds: z.array(z.string()).optional(),
  originatingProjectId: z.string().optional(),
  changes: z.array(z.unknown()).optional(), // Array<FieldChangeDto>
  changedBy: z.unknown().optional(), // ChangedByDto
  totalFieldsChanged: z.number().optional(),
  changeMetadata: z.unknown().optional(), // InitiativeChangeMetadata
}).strict();

const InitiativeStatusChangedSchema = ExecutionContext.extend({
  payloadType: z.literal('initiative.status_changed'),
  previousStatus: WorkStatusEnum,
  newStatus: WorkStatusEnum,
  originatingProjectId: z.string().optional(),
}).strict();

// Task Event Schemas
const TaskCreatedSchema = ExecutionContext.extend({
  payloadType: z.literal('task.created'),
  task: TaskEventTaskSnapshotSchema,
  initiativeId: z.string().optional(),
  summaryPayload: SummaryPayloadSchema.optional(),
}).strict();

const TaskArchivedSchema = ExecutionContext.extend({
  payloadType: z.literal('task.archived'),
  archivedAt: z.string(),
  initiativeId: z.string().optional(),
}).strict();

const TaskAssignedSchema = ExecutionContext.extend({
  payloadType: z.literal('task.assigned'),
  assigneeId: z.string(),
  previousAssigneeId: z.string().optional(),
  initiativeId: z.string().optional(),
}).strict();

const TaskStatusChangedSchema = ExecutionContext.extend({
  payloadType: z.literal('task.status_changed'),
  previousStatus: WorkStatusEnum,
  newStatus: WorkStatusEnum,
  initiativeId: z.string().optional(),
  originatingProjectId: z.string().optional(),
}).strict();

const TaskUpdatedSchema = ExecutionContext.extend({
  payloadType: z.literal('task.updated'),
  update: TaskEventUpdateSnapshotSchema,
  previousData: z.record(z.unknown()).optional(),
  initiativeId: z.string().optional(),
}).strict();

// Design Doc Event Schemas
const DesignDocCreatedSchema = ExecutionContext.extend({
  payloadType: z.literal('design_doc.created'),
  designDoc: DesignDocResponseDtoSchema,
}).strict();

const DesignDocArchivedSchema = ExecutionContext.extend({
  payloadType: z.literal('design_doc.archived'),
  designDoc: DesignDocResponseDtoSchema,
}).strict();

const DesignDocUpdatedSchema = ExecutionContext.extend({
  payloadType: z.literal('design_doc.updated'),
  designDoc: DesignDocResponseDtoSchema,
}).strict();

// Coding Prompt Event Schemas
const CodingPromptCreatedSchema = ExecutionContext.extend({
  payloadType: z.literal('coding_prompt.created'),
  codingPrompt: CodingPromptSnapshotSchema,
}).strict();

const CodingPromptUpdatedSchema = ExecutionContext.extend({
  payloadType: z.literal('coding_prompt.updated'),
  codingPrompt: CodingPromptSnapshotSchema,
  changes: z.record(z.unknown()).optional(),
}).strict();

const ImplementationHintFileReferenceDtoSchema = z
  .object({
    id: z.string().uuid(),
    hintId: z.string().uuid(),
    filePath: z.string(),
    startLine: z.number().int().optional(),
    endLine: z.number().int().optional(),
    createdAt: z.string(),
  })
  .strict();

const ImplementationHintVersionDtoSchema = z
  .object({
    id: z.string().uuid(),
    hintId: z.string().uuid(),
    version: z.number(),
    hint: z.string(),
    context: z.record(z.unknown()).optional(),
    extractedFrom: ImplementationHintExtractedFromEnum,
    confidence: z.number().optional(),
    createdAt: z.string(),
  })
  .strict();

const ImplementationHintSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    serviceId: z.string().uuid(),
    codingSessionId: z.string().uuid().optional(),
    agentSessionId: z.string().uuid().optional(),
    featureName: z.string(),
    description: z.string(),
    sourceType: ImplementationHintSourceTypeEnum,
    hint: z.string().optional(),
    context: z.record(z.unknown()).optional(),
    extractedFrom: ImplementationHintExtractedFromEnum.optional(),
    confidence: z.number().optional(),
    version: z.number().optional(),
    codingPromptIds: z.array(z.string().uuid()).optional(),
    fileReferences: z
      .array(ImplementationHintFileReferenceDtoSchema)
      .optional(),
    versions: z.array(ImplementationHintVersionDtoSchema).optional(),
    latestVersion: ImplementationHintVersionDtoSchema.optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()
  .refine((d) => d.codingSessionId || d.agentSessionId, {
    message: 'Either codingSessionId or agentSessionId is required',
  });

const ImplementationHintCreatedSchema = ExecutionContext.extend({
  payloadType: z.literal('implementation_hint.created'),
  implementationHint: ImplementationHintSnapshotSchema,
}).strict();

const ImplementationHintUpdatedSchema = ExecutionContext.extend({
  payloadType: z.literal('implementation_hint.updated'),
  implementationHint: ImplementationHintSnapshotSchema,
  changes: z.record(z.unknown()).optional(),
}).strict();

const ImplementationHintDeletedSchema = ExecutionContext.extend({
  payloadType: z.literal('implementation_hint.deleted'),
  implementationHintId: z.string().uuid(),
}).strict();

const AgentSessionCreatedSchema = ExecutionContext.extend({
  payloadType: z.literal('agent_session.created'),
  conversationId: z.string().uuid(),
  taskId: z.string().optional(),
  planId: z.string().optional(),
  serviceId: z.string().optional(),
  codingSession: AgentSessionSnapshotSchema,
  type: AgentSessionTypeEnum.optional(),
}).strict();

const AgentSessionStatusChangedSchema = ExecutionContext.extend({
  payloadType: z.literal('agent_session.status_changed'),
  codingSession: AgentSessionSnapshotSchema,
  previousStatus: AgentSessionStatusEnum,
  newStatus: AgentSessionStatusEnum,
  type: AgentSessionTypeEnum.optional(),
}).strict();

const AgentSessionDeletedSchema = ExecutionContext.extend({
  payloadType: z.literal('agent_session.deleted'),
  codingSession: AgentSessionSnapshotSchema,
}).strict();

const ReportCreatedSchema = z
  .object({
    payloadType: z.literal('report.created'),
    shouldProcess: z.boolean(),
    organizationId: z.string(),
    projectId: z.string().optional(),
    requestId: z.string().optional(),
    workflowId: z.string().optional(),
    nodeId: z.string().optional(),
    conversationId: z.string().optional(),
    userId: z.string().optional(),
    messageId: z.string().optional(),
    userMessage: FlowUserMessageSchema.optional(),
    correlationId: z.string().optional(),
    causationId: z.string().optional(),
    timestamp: z.string().optional(),
    report: ReportDtoSchema,
  })
  .strict();

// Summary Event Schemas
const SummaryCreatedSchema = ExecutionContext.extend({
  payloadType: z.literal('summary.created'),
  entityId: z.string(),
  entityType: z.string(),
  summary: SummaryPayloadSchema,
  category: SummaryCategoryEnum,
  subfacets: z.array(z.string()),
}).strict();

const SummaryUpdatedSchema = ExecutionContext.extend({
  payloadType: z.literal('summary.updated'),
  entityId: z.string(),
  entityType: z.string(),
  summary: SummaryPayloadSchema,
  category: SummaryCategoryEnum,
  subfacets: z.array(z.string()),
}).strict();

const SummaryDeletedSchema = ExecutionContext.extend({
  payloadType: z.literal('summary.deleted'),
  entityId: z.string(),
  entityType: z.string(),
  category: SummaryCategoryEnum,
  subfacets: z.array(z.string()),
}).strict();

// Message Event Schemas (additional ones, message.created already exists)
const MessageDeletedSchema = ExecutionContext.extend({
  payloadType: z.literal('message.deleted'),
  conversationId: z.string().uuid(), // Override to make it required for message.deleted
  deletedBy: z.string(),
}).strict();

const MessageUpdatedSchema = ExecutionContext.extend({
  payloadType: z.literal('message.updated'),
  conversationId: z.string().uuid(), // Override to make it required for message.updated
  update: z
    .object({
      status: z.string().optional(),
      parentMessageId: z.string().optional().nullable(),
      systemMessage: z.string().optional(),
      shouldProcess: z.boolean(),
    })
    .strict(),
  messageDataType: z.string().optional(),
}).passthrough(); // message.updated carries elevated fields from message.data (triggersAgent, completesExternalAgentNode, etc.)

// Conversation Event Schemas (additional ones, conversation.created already exists)
const ConversationDeletedSchema = ExecutionContext.extend({
  payloadType: z.literal('conversation.deleted'),
  conversation: z.unknown(), // ConversationDeletedPayloadAllOfConversation
  workflowTerminated: z.boolean().optional(),
  hardDelete: z.boolean().optional(),
  deletedBy: z.string().optional(),
  reason: z.string().optional(),
}).strict();

const ConversationUpdatedSchema = ExecutionContext.extend({
  payloadType: z.literal('conversation.updated'),
  update: z
    .object({
      expectedVersion: z.number().min(1),
    })
    .passthrough(), // ConversationUpdateEventData
  previousVersion: z.number().optional(),
  newVersion: z.number().optional(),
  changeType: z.string().optional(),
  lastModifiedBy: z.string().optional(),
}).passthrough(); // conversation.updated carries elevated fields (triggersAgent, latestMessageId, etc.)

// Artifact Event Schemas (additional ones, artifact.created already exists)
const ArtifactArchivedSchema = ExecutionContext.extend({
  payloadType: z.literal('artifact.archived'),
  artifactId: z.string(),
  sourceType: z.string(),
  sourceId: z.string().optional(),
  archivedAt: z.string(),
}).strict();

// Message Processor Error Schema
const MessageProcessorErrorSchema = ExecutionContext.extend({
  payloadType: z.literal('message_processor.error'),
  error: z.string(),
  errorStack: z.string().optional(),
  errorName: z.string().optional(),
  operation: z.string(),
}).strict();

// Service Event Schemas
const ServiceCreatedSchema = ExecutionContext.extend({
  payloadType: z.literal('service.created'),
  service: ServiceDtoSchema,
}).strict();

const ServiceUpdatedSchema = ExecutionContext.extend({
  payloadType: z.literal('service.updated'),
  service: ServiceDtoSchema,
}).strict();

const ServiceArchivedSchema = ExecutionContext.extend({
  payloadType: z.literal('service.archived'),
  service: ServiceDtoSchema,
}).strict();

// Proposal Event Schemas
const ProposalApprovedSchema = ExecutionContext.extend({
  payloadType: z.literal('proposal.approved'),
  proposalId: z.string(),
  targetEntityId: z.string(),
  targetEntityType: z.string(),
  action: z.string(),
  requestorId: z.string(),
  requestorContext: z.record(z.unknown()).optional(),
  influences: z.array(InfluenceSchema).optional(),
  generatedWithVersion: z.string().optional(),
  resultingEntityId: z.string().optional(),
  createdAt: z.string(),
}).strict();

// Map event types to schemas
export const SCHEMAS: Record<string, z.ZodType<any>> = {
  'artifact.created': ArtifactCreatedSchema,
  'artifact.archived': ArtifactArchivedSchema,
  'coding_prompt.created': CodingPromptCreatedSchema,
  'coding_prompt.updated': CodingPromptUpdatedSchema,
  'implementation_hint.created': ImplementationHintCreatedSchema,
  'implementation_hint.updated': ImplementationHintUpdatedSchema,
  'implementation_hint.deleted': ImplementationHintDeletedSchema,
  'agent_session.created': AgentSessionCreatedSchema,
  'agent_session.deleted': AgentSessionDeletedSchema,
  'agent_session.status_changed': AgentSessionStatusChangedSchema,
  'conversation.created': ConversationCreatedSchema,
  'conversation.deleted': ConversationDeletedSchema,
  'conversation.updated': ConversationUpdatedSchema,
  'design_doc.archived': DesignDocArchivedSchema,
  'design_doc.created': DesignDocCreatedSchema,
  'design_doc.updated': DesignDocUpdatedSchema,
  'initiative.archived': InitiativeArchivedSchema,
  'initiative.created': InitiativeCreatedSchema,
  'initiative.status_changed': InitiativeStatusChangedSchema,
  'initiative.updated': InitiativeUpdatedSchema,
  'message.created': MessageCreatedSchema,
  'message.deleted': MessageDeletedSchema,
  'message.updated': MessageUpdatedSchema,
  'message_processor.error': MessageProcessorErrorSchema,
  'proposal.approved': ProposalApprovedSchema,
  'report.created': ReportCreatedSchema,
  'service.created': ServiceCreatedSchema,
  'service.updated': ServiceUpdatedSchema,
  'service.archived': ServiceArchivedSchema,
  'summary.created': SummaryCreatedSchema,
  'summary.deleted': SummaryDeletedSchema,
  'summary.updated': SummaryUpdatedSchema,
  'task.archived': TaskArchivedSchema,
  'task.assigned': TaskAssignedSchema,
  'task.created': TaskCreatedSchema,
  'task.status_changed': TaskStatusChangedSchema,
  'task.updated': TaskUpdatedSchema,
};

// --- Script Logic ---
export async function attemptFix(
  prisma: any,
  event: any,
  payload: any,
  _error: z.ZodError,
): Promise<any | null> {
  const hasMissingContentFields = (
    record: Record<string, unknown> | null | undefined,
  ) =>
    !record ||
    typeof record.description !== 'string' ||
    typeof record.details !== 'string' ||
    typeof record.acceptanceCriteria !== 'string';
  const hasMissingTaskSnapshotFields = (
    record: Record<string, unknown> | null | undefined,
  ) =>
    hasMissingContentFields(record) ||
    !record ||
    !isTaskType(record.type) ||
    !Object.prototype.hasOwnProperty.call(record, 'parentTaskId');

  let fixed = JSON.parse(JSON.stringify(payload));
  let modified = false;

  // 1. Fix missing payloadType
  if (!fixed.payloadType) {
    fixed.payloadType = event.eventType;
    modified = true;
  }

  // 2. Fix missing IDs from event columns
  if (!fixed.organizationId && event.organizationId) {
    fixed.organizationId = event.organizationId;
    modified = true;
  }
  if (!fixed.projectId && event.projectId) {
    fixed.projectId = event.projectId;
    modified = true;
  }
  if (fixed.projectId && !isUuid(fixed.projectId)) {
    if (isUuid(event.projectId)) {
      fixed.projectId = event.projectId;
      modified = true;
    }
  }
  if (!fixed.conversationId && event.conversationId) {
    fixed.conversationId = event.conversationId;
    modified = true;
  }
  if (!fixed.workflowId && event.workflowId) {
    fixed.workflowId = event.workflowId;
    modified = true;
  }

  // General cleanup: Convert null to undefined for optional fields (match TypeScript types)
  if (fixed.workflowId === null) {
    delete fixed.workflowId;
    modified = true;
  }

  // Cleanup unknown root keys for Artifacts (strict ExecutionContext)
  if (event.eventType === 'artifact.created') {
    if (fixed.sourceId !== undefined) {
      delete fixed.sourceId;
      modified = true;
    }
    if (fixed.sourceType !== undefined) {
      delete fixed.sourceType;
      modified = true;
    }
  }

  // Cleanup for coding_prompt events
  if (event.eventType === 'coding_prompt.created') {
    // Remove extra codingPromptId field (it's already in codingPrompt.id)
    if (fixed.codingPromptId !== undefined) {
      delete fixed.codingPromptId;
      modified = true;
    }
    // Fix incorrect payloadType (should match eventType)
    if (fixed.payloadType !== 'coding_prompt.created') {
      fixed.payloadType = 'coding_prompt.created';
      modified = true;
    }
  }

  if (event.eventType === 'coding_prompt.updated') {
    if (fixed.codingPromptId !== undefined) {
      delete fixed.codingPromptId;
      modified = true;
    }
  }

  if (event.eventType === 'implementation_hint.created') {
    if (fixed.implementationHintId !== undefined) {
      delete fixed.implementationHintId;
      modified = true;
    }
    if (fixed.payloadType !== 'implementation_hint.created') {
      fixed.payloadType = 'implementation_hint.created';
      modified = true;
    }
  }

  if (event.eventType === 'implementation_hint.updated') {
    if (fixed.implementationHintId !== undefined) {
      delete fixed.implementationHintId;
      modified = true;
    }
    if (fixed.payloadType !== 'implementation_hint.updated') {
      fixed.payloadType = 'implementation_hint.updated';
      modified = true;
    }
  }

  if (event.eventType === 'implementation_hint.deleted') {
    if (fixed.payloadType !== 'implementation_hint.deleted') {
      fixed.payloadType = 'implementation_hint.deleted';
      modified = true;
    }
    if (!fixed.implementationHintId && isUuid(event.aggregateId)) {
      fixed.implementationHintId = event.aggregateId;
      modified = true;
    }
    if (fixed.implementationHint !== undefined) {
      delete fixed.implementationHint;
      modified = true;
    }
    if (fixed.changes !== undefined) {
      delete fixed.changes;
      modified = true;
    }
  }

  if (event.eventType === 'conversation.updated') {
    if (
      !fixed.update ||
      typeof fixed.update !== 'object' ||
      Array.isArray(fixed.update)
    ) {
      fixed.update = { expectedVersion: 1 };
      modified = true;
    } else if (typeof fixed.update.expectedVersion !== 'number') {
      fixed.update.expectedVersion = 1;
      modified = true;
    } else if (fixed.update.expectedVersion === 0) {
      fixed.update.expectedVersion = 1;
      modified = true;
    }
  }

  // Strip null initiativeId from task events — schema expects absent, not null
  if (event.eventType.startsWith('task.') && fixed.initiativeId === null) {
    delete fixed.initiativeId;
    modified = true;
  }

  // Cleanup for initiative events - remove duplicate fields that exist in initiative object
  if (event.eventType === 'initiative.created') {
    if (fixed.initiativeId !== undefined) {
      delete fixed.initiativeId;
      modified = true;
    }
    if (fixed.linkedProjectIds !== undefined) {
      delete fixed.linkedProjectIds;
      modified = true;
    }
    if (fixed.originatingProjectId !== undefined) {
      delete fixed.originatingProjectId;
      modified = true;
    }
    // Convert Date objects to ISO strings
    if (fixed.initiative && fixed.initiative.dueDate instanceof Date) {
      fixed.initiative.dueDate = fixed.initiative.dueDate.toISOString();
      modified = true;
    }
  }

  if (event.eventType === 'initiative.updated') {
    if (
      fixed.update &&
      typeof fixed.update === 'object' &&
      !Array.isArray(fixed.update)
    ) {
      const update = fixed.update as Record<string, unknown>;
      const allowedKeys = new Set([
        'name',
        'description',
        'details',
        'acceptanceCriteria',
        'assigneeId',
        'reasoning',
        'status',
        'priority',
        'creatorType',
        'dueDate',
        'tags',
      ]);
      for (const key of Object.keys(update)) {
        if (!allowedKeys.has(key)) {
          delete update[key];
          modified = true;
        }
      }
      for (const key of Object.keys(update)) {
        if (update[key] === null) {
          delete update[key];
          modified = true;
        }
      }
    }
  }

  // Remove 'initiative' field from non-created initiative events (they don't need snapshots)
  if (
    event.eventType.startsWith('initiative.') &&
    event.eventType !== 'initiative.created'
  ) {
    if (fixed.initiative !== undefined) {
      delete fixed.initiative;
      modified = true;
    }
  }

  // Remove 'task' field from non-created task events (they don't need snapshots)
  if (
    event.eventType.startsWith('task.') &&
    event.eventType !== 'task.created'
  ) {
    if (fixed.task !== undefined) {
      delete fixed.task;
      modified = true;
    }
  }

  // Convert null to undefined for task optional fields (match TypeScript types)
  if (event.eventType === 'task.created' && fixed.task) {
    if (fixed.task.description === null) {
      delete fixed.task.description;
      modified = true;
    }
    if (fixed.task.details === null) {
      delete fixed.task.details;
      modified = true;
    }
    if (fixed.task.acceptanceCriteria === null) {
      delete fixed.task.acceptanceCriteria;
      modified = true;
    }
    if (fixed.task.dueDate === null) {
      delete fixed.task.dueDate;
      modified = true;
    } else if (fixed.task.dueDate instanceof Date) {
      fixed.task.dueDate = fixed.task.dueDate.toISOString();
      modified = true;
    }
    if (fixed.task.assigneeId === null) {
      delete fixed.task.assigneeId;
      modified = true;
    }
  }

  // Provide default name for coding prompts (name is required per spec)
  if (event.eventType === 'coding_prompt.created' && fixed.codingPrompt) {
    if (
      fixed.codingPrompt.name === null ||
      fixed.codingPrompt.name === undefined ||
      fixed.codingPrompt.name === ''
    ) {
      fixed.codingPrompt.name = 'Untitled Coding Prompt';
      modified = true;
    }
  }

  // 3. Rehydrate/Fix missing entities
  if (event.eventType === 'artifact.created') {
    // If artifact is missing entirely, try to fetch
    if (!fixed.artifact || Object.keys(fixed.artifact).length === 0) {
      const artifact = await prisma.artifact.findUnique({
        where: { id: event.aggregateId },
      });

      if (artifact) {
        fixed.artifact = JSON.parse(JSON.stringify(artifact));
        // Ensure organizationId matches if missing
        if (!fixed.organizationId)
          fixed.organizationId = artifact.organizationId;
        if (!fixed.projectId && artifact.projectId)
          fixed.projectId = artifact.projectId;

        modified = true;
      }
    }

    // Cleanup artifact fields not allowed in CreateArtifactDto
    if (fixed.artifact) {
      if (fixed.artifact.id !== undefined) {
        delete fixed.artifact.id;
        modified = true;
      }
      if (fixed.artifact.contentHash !== undefined) {
        delete fixed.artifact.contentHash;
        modified = true;
      }
      if (fixed.artifact.createdAt !== undefined) {
        delete fixed.artifact.createdAt;
        modified = true;
      }
      if (fixed.artifact.updatedAt !== undefined) {
        delete fixed.artifact.updatedAt;
        modified = true;
      }

      // Fix Influences structure if needed
      if (
        Array.isArray(fixed.artifact.influences) &&
        fixed.artifact.influences[0]?.artifactId
      ) {
        fixed.artifact.influences = fixed.artifact.influences.map(
          (i: Record<string, string>) => ({
            reasoning: i.reasoning,
            entityId: i.artifactId,
            confidence: i.confidence,
            reasonType: i.reasonType,
          }),
        );
        modified = true;
      }
    }
  }

  if (event.eventType === 'message.created') {
    const payloadMessage =
      fixed.message && typeof fixed.message === 'object'
        ? JSON.parse(JSON.stringify(fixed.message))
        : undefined;

    // Try to load the message from the database, but use payload if not found
    const message = await prisma.message.findUnique({
      where: { id: event.aggregateId },
    });

    if (message) {
      // Use database version
      fixed.message = JSON.parse(JSON.stringify(message));
    } else if (fixed.message) {
      // Use payload version if message not in DB (old events before message was saved)
    }

    if (fixed.message) {
      const messageData =
        fixed.message.data && typeof fixed.message.data === 'object'
          ? (fixed.message.data as Record<string, unknown>)
          : undefined;
      const payloadData =
        payloadMessage?.data && typeof payloadMessage.data === 'object'
          ? (payloadMessage.data as Record<string, unknown>)
          : undefined;

      if (
        fixed.message.type === 'SYSTEM' &&
        messageData &&
        payloadData &&
        messageData.type === 'QUESTIONS'
      ) {
        if (messageData.detectedIntent === undefined) {
          if (payloadData.detectedIntent !== undefined) {
            messageData.detectedIntent = payloadData.detectedIntent;
            modified = true;
          }
        }
        if (messageData.intentConfidence === undefined) {
          if (payloadData.intentConfidence !== undefined) {
            messageData.intentConfidence = payloadData.intentConfidence;
            modified = true;
          }
        }
      }

      if (messageData && Array.isArray(messageData.uiElements)) {
        const elements = messageData.uiElements as Array<
          Record<string, unknown>
        >;
        let changed = false;
        for (const element of elements) {
          const influences = element.influences;
          if (Array.isArray(influences)) {
            const filtered = influences.filter((influence) => {
              if (!influence || typeof influence !== 'object') return false;
              const entityId = (influence as Record<string, unknown>).entityId;
              return isUuid(entityId);
            });
            if (filtered.length !== influences.length) {
              element.influences = filtered;
              changed = true;
            }
          }
        }
        if (changed) {
          modified = true;
        }
      }

      // Handle fields present in DB but needing adaptation for Event Schema
      if (fixed.message.createdAt) {
        const normalizedCreatedAt = new Date(
          fixed.message.createdAt,
        ).toISOString();
        if (fixed.message.createdAt !== normalizedCreatedAt) {
          fixed.message.createdAt = normalizedCreatedAt;
          modified = true;
        }
      }

      // Apply extractContent logic to set userMessage/systemMessage/shouldProcess
      if (fixed.message.type === 'USER') {
        const userMessage = MessageContentExtractor.extractMessageContent(
          fixed.message as any,
        );
        if (fixed.message.userMessage !== userMessage) {
          fixed.message.userMessage = userMessage;
          modified = true;
        }

        const parentMessageId = fixed.message.parentMessageId;
        const parentMessage = fixed.message.parentMessage;
        let parentContent = parentMessage?.content;
        if (
          parentMessageId &&
          (!parentMessage ||
            typeof parentMessage !== 'object' ||
            typeof parentMessage.content !== 'string')
        ) {
          const parent = await prisma.message.findUnique({
            where: { id: parentMessageId },
            select: { id: true, type: true, data: true },
          });
          const extractedParentContent = extractParentMessageContent(parent);
          if (parent && extractedParentContent) {
            fixed.message.parentMessage = {
              id: parentMessageId,
              content: extractedParentContent,
            };
            parentContent = extractedParentContent;
            modified = true;
          }
        }

        const shouldProcess =
          !IS_PROBABLY_JSON.test(userMessage) &&
          userMessage.length + (parentContent?.length ?? 0) > 50;
        if (fixed.message.shouldProcess !== shouldProcess) {
          fixed.message.shouldProcess = shouldProcess;
          modified = true;
        }
      } else if (fixed.message.type === 'SYSTEM') {
        if (fixed.message.status === 'completed') {
          if (fixed.message.systemMessage !== '') {
            fixed.message.systemMessage = '';
            modified = true;
          }
          if (fixed.message.shouldProcess !== false) {
            fixed.message.shouldProcess = false;
            modified = true;
          }
        } else {
          const messageData = fixed.message.data as any;
          if (messageData?.response) {
            const systemMessage = messageData.response;
            const ragEnabled = messageData.ragEnabled;
            const shouldProcess =
              !IS_PROBABLY_JSON.test(systemMessage) &&
              systemMessage.length > 50;
            if (fixed.message.systemMessage !== systemMessage) {
              fixed.message.systemMessage = systemMessage;
              modified = true;
            }
            const nextShouldProcess =
              ragEnabled === false ? false : shouldProcess;
            if (fixed.message.shouldProcess !== nextShouldProcess) {
              fixed.message.shouldProcess = nextShouldProcess;
              modified = true;
            }
          } else {
            if (fixed.message.systemMessage !== '') {
              fixed.message.systemMessage = '';
              modified = true;
            }
            if (fixed.message.shouldProcess !== true) {
              fixed.message.shouldProcess = true;
              modified = true;
            }
          }
        }
      }

      // Fix specific invalid keys
      if (fixed.message.expectedConversationVersion !== undefined) {
        delete fixed.message.expectedConversationVersion;
        modified = true;
      }

      // Fix invalid uiHints structure (old format with showSpinner, etc.)
      // Proper UIHints requires expectedElements and estimatedCount
      if (fixed.message.data && typeof fixed.message.data === 'object') {
        if (fixed.message.data.uiHints) {
          const uiHints = fixed.message.data.uiHints;
          if (
            typeof uiHints.showSpinner === 'boolean' ||
            uiHints.processingState ||
            uiHints.processingMessage
          ) {
            delete fixed.message.data.uiHints;
            modified = true;
          } else {
            const uiHintsValidation = UIHintsSchema.safeParse(uiHints);
            if (!uiHintsValidation.success) {
              delete fixed.message.data.uiHints;
              modified = true;
            }
          }
        }
      }

      // Ensure userId (use from DB if available, otherwise use 'system' for SYSTEM messages)
      if (!fixed.message.userId) {
        if (message?.userId) {
          fixed.message.userId = message.userId;
        } else if (fixed.message.type === 'SYSTEM') {
          fixed.message.userId = 'system';
        }
        modified = true;
      }

      // Extract messageDataType and remove data from message
      if (fixed.message.data && typeof fixed.message.data === 'object') {
        const data = fixed.message.data as Record<string, unknown>;
        if (typeof data.type === 'string') {
          fixed.messageDataType = data.type;
          modified = true;
        }
        delete fixed.message.data;
        modified = true;
      }
    }
  }

  if (event.eventType === 'message.updated') {
    if (
      fixed.update &&
      typeof fixed.update === 'object' &&
      !Array.isArray(fixed.update)
    ) {
      const update = fixed.update as any;
      const updateData = update.data as any;
      const isTerminalStatus =
        update.status === 'completed' || update.status === 'streaming_ready';
      const response =
        updateData && typeof updateData.response === 'string'
          ? updateData.response
          : undefined;

      if (update.systemMessage === undefined && isTerminalStatus) {
        update.systemMessage = '';
        modified = true;
      } else if (update.systemMessage === undefined && response !== undefined) {
        update.systemMessage = response;
        modified = true;
      }

      if (typeof update.shouldProcess !== 'boolean') {
        if (isTerminalStatus) {
          update.shouldProcess = false;
          modified = true;
        } else if (response !== undefined) {
          const ragEnabled = updateData?.ragEnabled;
          const shouldProcess =
            !IS_PROBABLY_JSON.test(response) && response.length > 50;
          update.shouldProcess = ragEnabled === false ? false : shouldProcess;
          modified = true;
        } else if (typeof update.systemMessage === 'string') {
          update.shouldProcess =
            !IS_PROBABLY_JSON.test(update.systemMessage) &&
            update.systemMessage.length > 50;
          modified = true;
        } else {
          update.systemMessage = '';
          update.shouldProcess = false;
          modified = true;
        }
      }

      // Extract messageDataType and remove data from update
      if (updateData && typeof updateData === 'object') {
        if (typeof updateData.type === 'string') {
          fixed.messageDataType = updateData.type;
          modified = true;
        }
      }
      delete update.data;
      modified = true;

      // Strip extra fields from update to match strict schema
      const allowedUpdateKeys = new Set([
        'status',
        'parentMessageId',
        'systemMessage',
        'shouldProcess',
      ]);
      for (const key of Object.keys(update)) {
        if (!allowedUpdateKeys.has(key)) {
          delete update[key];
          modified = true;
        }
      }
    }

    if (!fixed.conversationId) {
      const message = await prisma.message.findUnique({
        where: { id: event.aggregateId },
        select: { conversationId: true },
      });
      if (message?.conversationId) {
        fixed.conversationId = message.conversationId;
        modified = true;
      }
    }

    if (!fixed.conversationId) {
      const relatedEvents = await prisma.outboxEvent.findMany({
        where: { aggregateId: event.aggregateId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { conversationId: true, payload: true },
      });

      for (const relatedEvent of relatedEvents) {
        if (isUuid(relatedEvent.conversationId)) {
          fixed.conversationId = relatedEvent.conversationId;
          modified = true;
          break;
        }
        if (relatedEvent.payload && typeof relatedEvent.payload === 'object') {
          const payloadConversationId = (relatedEvent.payload as any)
            .conversationId;
          if (isUuid(payloadConversationId)) {
            fixed.conversationId = payloadConversationId;
            modified = true;
            break;
          }
        }
      }
    }
  }

  if (event.eventType.startsWith('agent_session.')) {
    if (fixed.conversationId && !isUuid(fixed.conversationId)) {
      delete fixed.conversationId;
      modified = true;
    }
    if (fixed.projectId && !isUuid(fixed.projectId)) {
      delete fixed.projectId;
      modified = true;
    }

    if (
      fixed.codingSession &&
      typeof fixed.codingSession === 'object' &&
      !Array.isArray(fixed.codingSession)
    ) {
      if (
        normalizeAgentSessionSnapshot(
          fixed.codingSession as Record<string, unknown>,
        )
      ) {
        modified = true;
      }
    }

    const codingSession = await loadAgentSessionFixContext(
      prisma,
      event.aggregateId,
    );

    if (
      hasMissingAgentSessionSnapshotFields(
        fixed.codingSession &&
          typeof fixed.codingSession === 'object' &&
          !Array.isArray(fixed.codingSession)
          ? (fixed.codingSession as Record<string, unknown>)
          : undefined,
      )
    ) {
      const snapshot = buildAgentSessionSnapshot(codingSession);
      if (snapshot) {
        fixed.codingSession = snapshot;
        modified = true;
      }
    }

    const codingSessionSnapshot =
      fixed.codingSession &&
      typeof fixed.codingSession === 'object' &&
      !Array.isArray(fixed.codingSession)
        ? (fixed.codingSession as Record<string, unknown>)
        : undefined;

    if (!fixed.organizationId && codingSessionSnapshot?.organizationId) {
      fixed.organizationId = codingSessionSnapshot.organizationId;
      modified = true;
    }
    if (!fixed.userId && codingSessionSnapshot?.userId) {
      fixed.userId = codingSessionSnapshot.userId;
      modified = true;
    }

    let resolvedConversationId = [
      fixed.conversationId,
      event.conversationId,
      codingSessionSnapshot?.conversationId,
      codingSession?.conversationId,
    ].find((value) => isUuid(value));

    if (!resolvedConversationId && isUuid(codingSession?.conversation?.id)) {
      resolvedConversationId = codingSession.conversation.id;
    }

    if (
      resolvedConversationId &&
      (!fixed.conversationId || fixed.conversationId !== resolvedConversationId)
    ) {
      fixed.conversationId = resolvedConversationId;
      modified = true;
    }

    if (
      codingSessionSnapshot &&
      !codingSessionSnapshot.conversationId &&
      resolvedConversationId
    ) {
      codingSessionSnapshot.conversationId = resolvedConversationId;
      modified = true;
    }

    if (!fixed.projectId) {
      if (isUuid(codingSession?.conversation?.projectId)) {
        fixed.projectId = codingSession.conversation.projectId;
        modified = true;
      } else if (resolvedConversationId) {
        const conversation = await prisma.conversation.findUnique({
          where: { id: resolvedConversationId },
          select: { projectId: true },
        });
        if (isUuid(conversation?.projectId)) {
          fixed.projectId = conversation.projectId;
          modified = true;
        }
      }
    }

    if (event.eventType === 'agent_session.created') {
      if (fixed.taskId === null) {
        delete fixed.taskId;
        modified = true;
      }
      if (fixed.planId === null) {
        delete fixed.planId;
        modified = true;
      }
      if (fixed.serviceId === null) {
        delete fixed.serviceId;
        modified = true;
      }

      if (!fixed.taskId && typeof codingSessionSnapshot?.taskId === 'string') {
        fixed.taskId = codingSessionSnapshot.taskId;
        modified = true;
      }
      if (
        !fixed.serviceId &&
        typeof codingSessionSnapshot?.serviceId === 'string'
      ) {
        fixed.serviceId = codingSessionSnapshot.serviceId;
        modified = true;
      }
    }

    if (!fixed.type && codingSession?.type) {
      fixed.type = codingSession.type;
      modified = true;
    }
  }

  if (event.eventType === 'conversation.created') {
    const legacyConversation =
      fixed.conversation &&
      typeof fixed.conversation === 'object' &&
      !Array.isArray(fixed.conversation)
        ? (fixed.conversation as Record<string, unknown>)
        : undefined;

    if (
      !fixed.workflowAboutId &&
      typeof legacyConversation?.workflowAboutId === 'string'
    ) {
      fixed.workflowAboutId = legacyConversation.workflowAboutId;
      modified = true;
    }
    if (
      !fixed.workflowAboutType &&
      typeof legacyConversation?.workflowAboutType === 'string'
    ) {
      fixed.workflowAboutType = legacyConversation.workflowAboutType;
      modified = true;
    }
    if (
      !fixed.workflowName &&
      typeof legacyConversation?.workflowName === 'string'
    ) {
      fixed.workflowName = legacyConversation.workflowName;
      modified = true;
    }
    if (
      !fixed.conversationTitle &&
      typeof legacyConversation?.title === 'string'
    ) {
      fixed.conversationTitle = legacyConversation.title;
      modified = true;
    }
    if (
      !fixed.initiatedBy &&
      typeof legacyConversation?.initiatedBy === 'string'
    ) {
      fixed.initiatedBy = legacyConversation.initiatedBy;
      modified = true;
    }
    if (!fixed.status && typeof legacyConversation?.status === 'string') {
      fixed.status = legacyConversation.status;
      modified = true;
    }

    if (legacyConversation) {
      delete fixed.conversation;
      modified = true;
    }

    if (
      !fixed.workflowName ||
      !fixed.initiatedBy ||
      !fixed.status ||
      !fixed.workflowAboutType ||
      !fixed.workflowAboutId
    ) {
      const conversation = await prisma.conversation.findUnique({
        where: { id: event.aggregateId },
      });
      if (conversation) {
        if (!fixed.workflowAboutId && conversation.workflowAboutId) {
          fixed.workflowAboutId = conversation.workflowAboutId;
          modified = true;
        }
        if (!fixed.workflowAboutType && conversation.workflowAboutType) {
          fixed.workflowAboutType = conversation.workflowAboutType;
          modified = true;
        }
        if (!fixed.workflowName && conversation.workflowName) {
          fixed.workflowName = conversation.workflowName;
          modified = true;
        }
        if (!fixed.conversationTitle && conversation.title) {
          fixed.conversationTitle = conversation.title;
          modified = true;
        }
        if (!fixed.initiatedBy && conversation.initiatedBy) {
          fixed.initiatedBy = conversation.initiatedBy;
          modified = true;
        }
        if (!fixed.status && conversation.status) {
          fixed.status = conversation.status;
          modified = true;
        }
      }
    }
  }

  // Initiative events rehydration (initiative.created needs full snapshot)
  if (event.eventType === 'initiative.created') {
    const existingInitiative =
      fixed.initiative && typeof fixed.initiative === 'object'
        ? fixed.initiative
        : undefined;
    const existingSections = Array.isArray(existingInitiative?.sections)
      ? existingInitiative.sections
      : undefined;
    if (existingSections) {
      const content = inputSectionsToContentMap(existingSections);
      if (content.description !== undefined) {
        existingInitiative.description = content.description;
      }
      if (content.details !== undefined) {
        existingInitiative.details = content.details;
      }
      if (content.acceptanceCriteria !== undefined) {
        existingInitiative.acceptanceCriteria = content.acceptanceCriteria;
      }
      delete existingInitiative.sections;
      modified = true;
    }

    if (
      !existingInitiative ||
      Object.keys(existingInitiative).length === 0 ||
      hasMissingContentFields(existingInitiative)
    ) {
      const initiative = await prisma.initiative.findUnique({
        where: { id: event.aggregateId },
        include: { sections: true },
      });
      if (initiative) {
        const normalizedSections = initiative.sections.map((section: any) => ({
          key: section.key,
          materializedMarkdown: section.materializedMarkdown ?? '',
        })) as MaterializedWorkItemSection[];
        const content = materializedSectionsToContentMap(normalizedSections);
        const contentSnapshot = buildInitiativeEventContentSnapshot({
          description: content.description.trim() || '',
          details: content.details.trim() || '',
          acceptanceCriteria: content.acceptanceCriteria.trim() || '',
        });
        fixed.initiative = buildInitiativeEventSnapshot({
          initiative,
          content: contentSnapshot,
          linkedProjectIds: [],
        });
        // Ensure context IDs match
        if (!fixed.organizationId)
          fixed.organizationId = initiative.organizationId;
        if (!fixed.projectId && initiative.originatingProjectId)
          fixed.projectId = initiative.originatingProjectId;
        modified = true;
      }
    }
  }

  if (event.eventType === 'initiative.updated') {
    const existingUpdate =
      fixed.update && typeof fixed.update === 'object' ? fixed.update : {};
    const existingSections = Array.isArray(existingUpdate.sections)
      ? existingUpdate.sections
      : undefined;
    if (existingSections) {
      const content = inputSectionsToContentMap(existingSections);
      if (content.description !== undefined) {
        existingUpdate.description = content.description;
      }
      if (content.details !== undefined) {
        existingUpdate.details = content.details;
      }
      if (content.acceptanceCriteria !== undefined) {
        existingUpdate.acceptanceCriteria = content.acceptanceCriteria;
      }
      delete existingUpdate.sections;
      modified = true;
    }
    if (hasMissingContentFields(existingUpdate as Record<string, unknown>)) {
      const initiative = await prisma.initiative.findUnique({
        where: { id: event.aggregateId },
        include: { sections: true },
      });
      if (initiative) {
        const normalizedSections = initiative.sections.map((section: any) => ({
          key: section.key,
          materializedMarkdown: section.materializedMarkdown ?? '',
        })) as MaterializedWorkItemSection[];
        const content = materializedSectionsToContentMap(normalizedSections);
        const contentSnapshot = buildInitiativeEventContentSnapshot({
          description: content.description.trim() || '',
          details: content.details.trim() || '',
          acceptanceCriteria: content.acceptanceCriteria.trim() || '',
        });
        fixed.update = {
          ...buildInitiativeEventUpdateSnapshot(
            existingUpdate as UpdateInitiativeDto,
          ),
          description: contentSnapshot.description,
          details: contentSnapshot.details,
          acceptanceCriteria: contentSnapshot.acceptanceCriteria,
        };
        modified = true;
      }
    }
  }

  // Task events rehydration (task.created needs full task snapshot)
  if (event.eventType === 'task.created') {
    const existingTask =
      fixed.task && typeof fixed.task === 'object' ? fixed.task : undefined;
    const existingSections = Array.isArray(existingTask?.sections)
      ? existingTask.sections
      : undefined;
    if (
      existingSections &&
      existingSections.some((section: any) => 'content' in section)
    ) {
      const content = inputSectionsToContentMap(existingSections);
      if (content.description !== undefined) {
        existingTask.description = content.description;
      }
      if (content.details !== undefined) {
        existingTask.details = content.details;
      }
      if (content.acceptanceCriteria !== undefined) {
        existingTask.acceptanceCriteria = content.acceptanceCriteria;
      }
      if (content.requirements !== undefined) {
        existingTask.requirements = content.requirements;
      }
      delete existingTask.sections;
      modified = true;
    }

    if (
      !existingTask ||
      Object.keys(existingTask).length === 0 ||
      hasMissingTaskSnapshotFields(existingTask)
    ) {
      const task = await prisma.task.findUnique({
        where: { id: event.aggregateId },
        include: { sections: true },
      });
      if (task) {
        const normalizedSections = task.sections.map((section: any) => ({
          key: section.key,
          order: section.order,
          materializedMarkdown: section.materializedMarkdown ?? '',
        })) as MaterializedWorkItemSection[];
        const content = materializedSectionsToContentMap(normalizedSections);
        const description = content.description.trim();
        const acceptanceCriteria = content.acceptanceCriteria.trim();
        const contentSnapshot = buildTaskEventContentSnapshot({
          type: task.type,
          description: description || '',
          acceptanceCriteria: acceptanceCriteria || '',
          requirements: content.requirements,
        });
        contentSnapshot.sections = task.sections.map((section: any) => ({
          key: section.key,
          order: section.order,
          materializedMarkdown: section.materializedMarkdown,
        }));
        fixed.task = toTaskSnapshot(task, contentSnapshot);
        // Ensure context IDs match
        if (!fixed.organizationId) fixed.organizationId = task.organizationId;
        if (!fixed.initiativeId && task.initiativeId) {
          fixed.initiativeId = task.initiativeId;
        }
        modified = true;
      }
    }
  }

  if (event.eventType === 'task.updated') {
    const existingUpdate =
      fixed.update && typeof fixed.update === 'object' ? fixed.update : {};
    const existingSections = Array.isArray(existingUpdate.sections)
      ? existingUpdate.sections
      : undefined;
    if (existingSections) {
      const content = inputSectionsToContentMap(existingSections);
      if (content.description !== undefined) {
        existingUpdate.description = content.description;
      }
      if (content.details !== undefined) {
        existingUpdate.details = content.details;
      }
      if (content.acceptanceCriteria !== undefined) {
        existingUpdate.acceptanceCriteria = content.acceptanceCriteria;
      }
      if (content.requirements !== undefined) {
        existingUpdate.requirements = content.requirements;
      }
      delete existingUpdate.sections;
      modified = true;
    }
    if (hasMissingContentFields(existingUpdate as Record<string, unknown>)) {
      const task = await prisma.task.findUnique({
        where: { id: event.aggregateId },
        include: { sections: true },
      });
      if (task) {
        const normalizedSections = task.sections.map((section: any) => ({
          key: section.key,
          materializedMarkdown: section.materializedMarkdown ?? '',
        })) as MaterializedWorkItemSection[];
        const content = materializedSectionsToContentMap(normalizedSections);
        const description = content.description.trim();
        const details = content.details.trim();
        const acceptanceCriteria = content.acceptanceCriteria.trim();
        fixed.update = {
          ...existingUpdate,
          description: description || '',
          details: details || '',
          acceptanceCriteria: acceptanceCriteria || '',
          ...(task.type === 'FEATURE' && content.requirements !== undefined
            ? { requirements: content.requirements }
            : {}),
        };
        modified = true;
      }
    }
  }

  // For other task events, ensure initiativeId is present
  if (
    event.eventType.startsWith('task.') &&
    event.eventType !== 'task.created'
  ) {
    if (!fixed.initiativeId) {
      const task = await prisma.task.findUnique({
        where: { id: event.aggregateId },
      });
      if (task) {
        if (task.initiativeId) {
          fixed.initiativeId = task.initiativeId;
        }
        if (!fixed.organizationId) fixed.organizationId = task.organizationId;
        modified = true;
      }
    }
  }

  // Design Doc events rehydration
  if (event.eventType.startsWith('design_doc.')) {
    if (!fixed.designDoc || Object.keys(fixed.designDoc).length === 0) {
      try {
        const designDoc = await prisma.designDoc.findUnique({
          where: { id: event.aggregateId },
          include: { sections: true },
        });
        if (designDoc) {
          fixed.designDoc = buildDesignDocEventDoc(
            designDoc as unknown as DesignDocWithSectionsRecord,
          );
          if (!fixed.organizationId)
            fixed.organizationId = designDoc.organizationId;
          if (!fixed.projectId && designDoc.projectId)
            fixed.projectId = designDoc.projectId;
          modified = true;
        }
      } catch (e) {
        // Table might not exist, skip
      }
    }

    // Clean up legacy fields from designDoc
    if (fixed.designDoc) {
      if (fixed.designDoc.metadata !== undefined) {
        delete fixed.designDoc.metadata;
        modified = true;
      }
      if (fixed.designDoc.archivedAt !== undefined) {
        delete fixed.designDoc.archivedAt;
        modified = true;
      }
    }
  }

  // Coding Prompt events rehydration
  if (event.eventType.startsWith('coding_prompt.')) {
    if (!fixed.codingPrompt || Object.keys(fixed.codingPrompt).length === 0) {
      try {
        const codingPrompt = await prisma.codingPrompt.findUnique({
          where: { id: event.aggregateId },
        });
        if (codingPrompt) {
          fixed.codingPrompt = JSON.parse(JSON.stringify(codingPrompt));
          if (fixed.codingPrompt.createdAt)
            fixed.codingPrompt.createdAt = new Date(
              fixed.codingPrompt.createdAt,
            ).toISOString();
          if (fixed.codingPrompt.updatedAt)
            fixed.codingPrompt.updatedAt = new Date(
              fixed.codingPrompt.updatedAt,
            ).toISOString();
          if (!fixed.organizationId)
            fixed.organizationId = codingPrompt.organizationId;
          modified = true;
        }
      } catch (e) {
        // Table might not exist, skip
      }
    }
  }

  if (
    event.eventType === 'implementation_hint.created' ||
    event.eventType === 'implementation_hint.updated'
  ) {
    const hintSnapshot =
      fixed.implementationHint &&
      typeof fixed.implementationHint === 'object' &&
      !Array.isArray(fixed.implementationHint)
        ? (fixed.implementationHint as Record<string, unknown>)
        : undefined;

    const nullableOptionalKeys = [
      'hint',
      'context',
      'extractedFrom',
      'confidence',
      'version',
      'codingPromptIds',
      'fileReferences',
      'versions',
      'latestVersion',
    ];

    if (hintSnapshot) {
      for (const key of nullableOptionalKeys) {
        if (hintSnapshot[key] === null) {
          delete hintSnapshot[key];
          modified = true;
        }
      }

      if (hintSnapshot.createdAt instanceof Date) {
        hintSnapshot.createdAt = hintSnapshot.createdAt.toISOString();
        modified = true;
      }
      if (hintSnapshot.updatedAt instanceof Date) {
        hintSnapshot.updatedAt = hintSnapshot.updatedAt.toISOString();
        modified = true;
      }

      const versions = Array.isArray(hintSnapshot.versions)
        ? hintSnapshot.versions
        : [];
      for (const version of versions) {
        if (version && typeof version === 'object') {
          const versionRecord = version as Record<string, unknown>;
          if (versionRecord.context === null) {
            delete versionRecord.context;
            modified = true;
          }
          if (versionRecord.confidence === null) {
            delete versionRecord.confidence;
            modified = true;
          }
          if (versionRecord.createdAt instanceof Date) {
            versionRecord.createdAt = versionRecord.createdAt.toISOString();
            modified = true;
          }
        }
      }

      const latestVersion =
        hintSnapshot.latestVersion &&
        typeof hintSnapshot.latestVersion === 'object' &&
        !Array.isArray(hintSnapshot.latestVersion)
          ? (hintSnapshot.latestVersion as Record<string, unknown>)
          : undefined;
      if (latestVersion) {
        if (latestVersion.context === null) {
          delete latestVersion.context;
          modified = true;
        }
        if (latestVersion.confidence === null) {
          delete latestVersion.confidence;
          modified = true;
        }
        if (latestVersion.createdAt instanceof Date) {
          latestVersion.createdAt = latestVersion.createdAt.toISOString();
          modified = true;
        }
      }

      const fileReferences = Array.isArray(hintSnapshot.fileReferences)
        ? hintSnapshot.fileReferences
        : [];
      for (const fileReference of fileReferences) {
        if (fileReference && typeof fileReference === 'object') {
          const fileReferenceRecord = fileReference as Record<string, unknown>;
          if (fileReferenceRecord.startLine === null) {
            delete fileReferenceRecord.startLine;
            modified = true;
          }
          if (fileReferenceRecord.endLine === null) {
            delete fileReferenceRecord.endLine;
            modified = true;
          }
          if (fileReferenceRecord.createdAt instanceof Date) {
            fileReferenceRecord.createdAt =
              fileReferenceRecord.createdAt.toISOString();
            modified = true;
          }
        }
      }
    }

    const hasRequiredImplementationHintFields =
      hintSnapshot &&
      typeof hintSnapshot.id === 'string' &&
      typeof hintSnapshot.serviceId === 'string' &&
      (typeof hintSnapshot.codingSessionId === 'string' ||
        typeof hintSnapshot.agentSessionId === 'string') &&
      typeof hintSnapshot.featureName === 'string' &&
      typeof hintSnapshot.description === 'string' &&
      typeof hintSnapshot.sourceType === 'string' &&
      typeof hintSnapshot.createdAt === 'string' &&
      typeof hintSnapshot.updatedAt === 'string';

    if (!hasRequiredImplementationHintFields) {
      const implementationHint = await loadImplementationHintFixContext(
        prisma,
        event.aggregateId,
      );
      const hydratedImplementationHint =
        buildImplementationHintEventDto(implementationHint);

      if (hydratedImplementationHint) {
        fixed.implementationHint = hydratedImplementationHint;
        modified = true;

        if (
          !fixed.organizationId &&
          typeof implementationHint?.service.organizationId === 'string'
        ) {
          fixed.organizationId = implementationHint.service.organizationId;
          modified = true;
        }
        if (
          !fixed.projectId &&
          typeof implementationHint?.service.projectId === 'string'
        ) {
          fixed.projectId = implementationHint.service.projectId;
          modified = true;
        }
      }
    } else {
      if (!fixed.organizationId && isUuid(event.organizationId)) {
        fixed.organizationId = event.organizationId;
        modified = true;
      }
      if (!fixed.projectId && isUuid(event.projectId)) {
        fixed.projectId = event.projectId;
        modified = true;
      }
    }
  }

  if (event.eventType === 'report.created') {
    const report =
      fixed.report &&
      typeof fixed.report === 'object' &&
      !Array.isArray(fixed.report)
        ? (fixed.report as Record<string, unknown>)
        : undefined;

    if (!report || Object.keys(report).length === 0) {
      const reportRecord = await loadReportFixContext(
        prisma,
        event.aggregateId,
      );
      const hydratedReport = buildReportEventDto(reportRecord);
      if (hydratedReport) {
        fixed.report = hydratedReport;
        modified = true;
      }
    }

    const reportAfterHydration =
      fixed.report &&
      typeof fixed.report === 'object' &&
      !Array.isArray(fixed.report)
        ? (fixed.report as Record<string, unknown>)
        : undefined;

    if (
      reportAfterHydration &&
      typeof reportAfterHydration.ragEnabled !== 'boolean'
    ) {
      const stored = await prisma.report.findUnique({
        where: { id: event.aggregateId },
        select: { ragEnabled: true },
      });
      if (stored) {
        reportAfterHydration.ragEnabled = stored.ragEnabled;
        modified = true;
      }
    }
    if (
      typeof fixed.shouldProcess !== 'boolean' ||
      (reportAfterHydration?.ragEnabled === false &&
        fixed.shouldProcess !== false)
    ) {
      fixed.shouldProcess = reportAfterHydration?.ragEnabled !== false;
      modified = true;
    }

    if (
      !fixed.organizationId &&
      typeof reportAfterHydration?.organizationId === 'string'
    ) {
      fixed.organizationId = reportAfterHydration.organizationId;
      modified = true;
    }

    if (
      !fixed.projectId &&
      typeof reportAfterHydration?.projectId === 'string'
    ) {
      fixed.projectId = reportAfterHydration.projectId;
      modified = true;
    }

    if (
      reportAfterHydration &&
      typeof reportAfterHydration.reportType === 'string' &&
      typeof reportAfterHydration.title !== 'string'
    ) {
      reportAfterHydration.title = reportTitleForType(
        reportAfterHydration.reportType,
      );
      modified = true;
    }

    if (
      reportAfterHydration &&
      typeof reportAfterHydration.audience !== 'string'
    ) {
      const reportRecord = await prisma.report.findUnique({
        where: { id: event.aggregateId },
        select: { audience: true },
      });
      if (reportRecord?.audience) {
        reportAfterHydration.audience = reportRecord.audience;
        modified = true;
      }
    }

    if (
      reportAfterHydration &&
      reportAfterHydration.createdAt instanceof Date
    ) {
      reportAfterHydration.createdAt =
        reportAfterHydration.createdAt.toISOString();
      modified = true;
    }

    if (
      reportAfterHydration &&
      reportAfterHydration.expiresAt instanceof Date
    ) {
      reportAfterHydration.expiresAt =
        reportAfterHydration.expiresAt.toISOString();
      modified = true;
    }

    if (reportAfterHydration && Array.isArray(reportAfterHydration.entities)) {
      for (const entity of reportAfterHydration.entities) {
        if (
          entity &&
          typeof entity === 'object' &&
          (entity as Record<string, unknown>).createdAt instanceof Date
        ) {
          (entity as Record<string, unknown>).createdAt = (
            (entity as Record<string, unknown>).createdAt as Date
          ).toISOString();
          modified = true;
        }
      }
    }
  }

  if (event.eventType.startsWith('service.')) {
    if (fixed.service && typeof fixed.service === 'object') {
      const nullableKeys = [
        'description',
        'projectId',
        'repositoryUrl',
        'repositoryType',
        'repositoryId',
        'serviceType',
        'language',
        'framework',
        'tags',
        'childCounts',
        'archivedAt',
      ];
      for (const key of nullableKeys) {
        if (fixed.service[key] === null) {
          delete fixed.service[key];
          modified = true;
        }
      }
      if (fixed.service.createdAt instanceof Date) {
        fixed.service.createdAt = fixed.service.createdAt.toISOString();
        modified = true;
      }
      if (fixed.service.updatedAt instanceof Date) {
        fixed.service.updatedAt = fixed.service.updatedAt.toISOString();
        modified = true;
      }
      if (fixed.service.archivedAt instanceof Date) {
        fixed.service.archivedAt = fixed.service.archivedAt.toISOString();
        modified = true;
      }
    }

    if (!fixed.service || Object.keys(fixed.service).length === 0) {
      const service = await prisma.service.findUnique({
        where: { id: event.aggregateId },
        include: {
          _count: {
            select: {
              taskRelations: true,
              initiativeRelations: true,
              agentSessionRelations: true,
              implementationHints: true,
            },
          },
        },
      });
      if (service) {
        fixed.service = {
          id: service.id,
          name: service.name,
          description: service.description ?? undefined,
          organizationId: service.organizationId,
          projectId: service.projectId ?? undefined,
          repositoryUrl: service.repositoryUrl ?? undefined,
          repositoryType: service.repositoryType ?? undefined,
          repositoryId: service.repositoryId ?? undefined,
          serviceType: service.serviceType ?? undefined,
          language: service.language ?? undefined,
          framework: service.framework ?? undefined,
          tags: service.tags,
          status: service.status,
          childCounts: {
            tasks: service._count?.taskRelations ?? 0,
            initiatives: service._count?.initiativeRelations ?? 0,
            codingSessions: service._count?.agentSessionRelations ?? 0,
            implementationHints: service._count?.implementationHints ?? 0,
          },
          createdAt: new Date(service.createdAt).toISOString(),
          updatedAt: new Date(service.updatedAt).toISOString(),
          archivedAt: service.archivedAt
            ? new Date(service.archivedAt).toISOString()
            : undefined,
        };
        if (!fixed.organizationId)
          fixed.organizationId = service.organizationId;
        if (!fixed.projectId && service.projectId) {
          fixed.projectId = service.projectId;
        }
        modified = true;
      }
    }
  }

  return modified ? fixed : null;
}
