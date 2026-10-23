import type { INestApplicationContext } from '@nestjs/common';
import { Initiative, Prisma, ProjectStatus } from '@prisma/client';
import { Client } from '@temporalio/client';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { MessageStatus } from '../constants/message-status.constants';
import { DomainEventPublisher } from '../core/events/domain-event-publisher';
import { LlmCompleteEvent } from '../core/events/types/domain-events';
import { QueueName } from '../core/events/types/event.types';
import {
  IQueueService,
  QueueJob,
} from '../core/queue/interfaces/queue.interface';
import {
  ArtifactData,
  ArtifactResponseDto,
  ArtifactSourceType,
  ArtifactStatus,
  ArtifactType,
  ConversationResponseDto,
  ConversationStatus,
  CreateTagDto,
  InitiativeCreatorType,
  InitiativeResponseDto,
  IntegrationConnectionStatus,
  IntegrationResponseDto,
  IntegrationState,
  IntegrationTargetType,
  IntegrationType,
  MaterializedWorkItemSection,
  MessageResponseDto,
  OrganizationRole,
  PayloadType,
  Priority,
  ProjectResponseDto,
  SystemMessageData,
  TagSource,
  TaskSectionInput,
  TaskSectionKey,
  TaskResponseDto,
  UserMessageData,
  WorkItemSectionInput,
  WorkStatus,
  WorkflowName,
} from '../generated';
import { PrismaService } from '../prisma/prisma.service';
import { AgentCostData } from '../services/agents/agent-cost-tracking.service';
import {
  AgentExecutionResult,
  MastraAgentRequest,
  MastraAgentResponse,
} from '../services/agents/mastra-client.service';
import { ArtifactService } from '../services/artifacts/artifact.service';
import { ConversationService } from '../services/conversation.service';
import { InitiativeOptimizationService } from '../services/initiatives/initiative-optimization.service';
import { InitiativeService } from '../services/initiatives/initiative.service';
import { InitiativeDraft } from '../services/initiatives/types';
import { IntentDetectorService } from '../services/intent-detector.service';
import { IJobEnqueuer } from '../services/interfaces/job-enqueuer.interface';
import { LLMClientService } from '../services/llm/llm-client.service';
import { MessageService } from '../services/message.service';
import { TaskService } from '../services/tasks/task.service';
import { FlowExecutionService } from '../services/workflows/flow-execution.service';
import { NodeExecutionService } from '../services/workflows/node-execution.service';
import {
  ApiKeyId,
  ArtifactId,
  ConversationId,
  DesignDocId,
  FlowExecutionId,
  InitiativeId,
  IntegrationId,
  JobId,
  MessageId,
  OrganizationId,
  PlanId,
  ProjectId,
  RequestId,
  TaskId,
  UserId,
  WorkflowId,
} from '../types';
import {
  AgentExecutionResultPayload,
  ConversationNode,
  Flow,
  FlowContext,
  FlowUserMessage,
  NodeResult,
  NodeType,
} from '../types/flow-internal.types';
import {
  InitiativeRefinableEntity,
  toInitiativeRefinableEntity,
} from '../types/initiative-refinement-adapter.types';
import {
  ChangeDetectionResult,
  ContentUpdates,
  EntityType,
  OptimizationContext,
  RefinableEntity,
  RefinementContext,
  RefinementLevel,
  RefinementOperationResult,
  RefinementSession,
  WorkItemRefinementRequest,
} from '../types/refinable-entity.types';
import { TaskRefinableEntity } from '../types/task-refinement-adapter.types';
import { WorkItemSectionKey } from '../types/work-item-section.types';
import {
  LLMResponsePayload,
  NodeConfiguration,
  StepTransitionResult,
  WorkflowInput,
  WorkflowPhase,
  WorkflowState,
  WorkflowStep,
} from '../workflows/conversation-workflow-state';

// Test ID constants with branded types
export const testIds = {
  conversation: '123e4567-e89b-42d3-a456-426614174001' as ConversationId,
  organization: '123e4567-e89b-42d3-a456-426614174002' as OrganizationId,
  project: '123e4567-e89b-42d3-a456-426614174003' as ProjectId,
  user: '123e4567-e89b-42d3-a456-426614174004' as UserId,
  workflow: '123e4567-e89b-42d3-a456-426614174005' as WorkflowId,
  initiative: '123e4567-e89b-42d3-a456-426614174006' as InitiativeId,
  message: '123e4567-e89b-42d3-a456-426614174007' as MessageId,
  parentMessage: '123e4567-e89b-42d3-a456-426614174008' as MessageId,
  request: '123e4567-e89b-42d3-a456-426614174009' as RequestId,
  flowExecution: '123e4567-e89b-42d3-a456-426614174010' as FlowExecutionId,
  job: '123e4567-e89b-42d3-a456-426614174011' as JobId,
  integration: '123e4567-e89b-42d3-a456-426614174012' as IntegrationId,
  task: '123e4567-e89b-42d3-a456-426614174013' as TaskId,
  designDoc: '123e4567-e89b-42d3-a456-426614174014' as DesignDocId,
  plan: '123e4567-e89b-42d3-a456-426614174016' as PlanId,
  planStage: '123e4567-e89b-42d3-a456-426614174017' as TaskId,
  event: '123e4567-e89b-42d3-a456-426614174015',
  flowId: 'test-flow-123',
  nodeId: 'node-123',
  artifactId: 'node-123' as ArtifactId,
  // Agent-specific test IDs
  agentExecution: 'test-agent-exec-123' as const,
  agentRequest: 'test-agent-req-456' as const,
  toolExecution: 'test-tool-exec-789' as const,
  agentId: 'initiative-refiner' as const,
  apiKey: '123e4567-e89b-42d3-a456-426614174016' as ApiKeyId,
};

const DEFAULT_WORK_ITEM_CONTENT: Record<WorkItemSectionKey, string> = {
  description: 'Test work item description',
  details: 'Test work item details',
  acceptanceCriteria: 'Test work item acceptance criteria',
  requirements: '',
};

const DEFAULT_TASK_CONTENT: Record<TaskSectionKey, string> = {
  description: 'Test task description',
  acceptanceCriteria: 'Test task acceptance criteria',
  requirements: 'Test task requirements',
  graphPresentation: '',
};

export function createMockMaterializedWorkItemSections(
  contentOverrides: Partial<Record<WorkItemSectionKey, string>> = {},
): MaterializedWorkItemSection[] {
  const content = {
    ...DEFAULT_WORK_ITEM_CONTENT,
    ...contentOverrides,
  };

  return [
    {
      id: `${testIds.organization}-description`,
      key: 'description',
      order: 0,
      materializedMarkdown: content.description,
      materializedProposalId: '10000000-0000-4000-8000-000000000001',
    },
    {
      id: `${testIds.organization}-details`,
      key: 'details',
      order: 1,
      materializedMarkdown: content.details,
      materializedProposalId: '10000000-0000-4000-8000-000000000001',
    },
    {
      id: `${testIds.organization}-acceptance`,
      key: 'acceptanceCriteria',
      order: 2,
      materializedMarkdown: content.acceptanceCriteria,
      materializedProposalId: '10000000-0000-4000-8000-000000000001',
    },
  ];
}

export function createMockWorkItemSectionInputs(
  contentOverrides: Partial<Record<WorkItemSectionKey, string>> = {},
): WorkItemSectionInput[] {
  const content = {
    ...DEFAULT_WORK_ITEM_CONTENT,
    ...contentOverrides,
  };

  return [
    {
      key: 'description',
      order: 0,
      content: content.description,
    },
    {
      key: 'details',
      order: 1,
      content: content.details,
    },
    {
      key: 'acceptanceCriteria',
      order: 2,
      content: content.acceptanceCriteria,
    },
  ];
}

export function createMockMaterializedTaskSections(
  contentOverrides: Partial<Record<TaskSectionKey, string>> = {},
): MaterializedWorkItemSection[] {
  const content = {
    ...DEFAULT_TASK_CONTENT,
    ...contentOverrides,
  };

  return [
    {
      id: `${testIds.organization}-task-description`,
      key: 'description',
      order: 0,
      materializedMarkdown: content.description,
      materializedProposalId: '10000000-0000-4000-8000-000000000001',
    },
    {
      id: `${testIds.organization}-task-acceptance`,
      key: 'acceptanceCriteria',
      order: 1,
      materializedMarkdown: content.acceptanceCriteria,
      materializedProposalId: '10000000-0000-4000-8000-000000000001',
    },
  ];
}

export function createMockTaskSectionInputs(
  contentOverrides: Partial<Record<TaskSectionKey, string>> = {},
): TaskSectionInput[] {
  const content = {
    ...DEFAULT_TASK_CONTENT,
    ...contentOverrides,
  };

  return [
    {
      key: 'description',
      order: 0,
      content: content.description,
    },
    {
      key: 'acceptanceCriteria',
      order: 1,
      content: content.acceptanceCriteria,
    },
  ];
}

// Mock authenticated user factory
export function createMockAuthenticatedUser(
  overrides?: Partial<AuthenticatedUser>,
): AuthenticatedUser {
  return {
    userId: testIds.user,
    email: 'test@example.com',
    name: 'Test User',
    currentOrgId: testIds.organization,
    orgMemberships: [
      {
        orgId: testIds.organization,
        role: OrganizationRole.Admin,
      },
    ],
    isDevAdmin: false,
    devAdminMode: false,
    ...overrides,
  };
}

type RecursivePartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[] // If T[P] is an array
    ? RecursivePartial<U>[] // Apply RecursivePartial to the array element type
    : T[P] extends object | undefined // If T[P] is an object (or undefined)
      ? RecursivePartial<T[P]> // Apply RecursivePartial recursively
      : T[P]; // Otherwise, keep the type as is (for primitive types)
};

// Test ID generators with branded types (keeping for backwards compatibility)
export const createTestId = {
  conversation: (id = 'test-conv-123'): ConversationId => id as ConversationId,
  organization: (id = 'test-org-123'): OrganizationId => id as OrganizationId,
  project: (id = 'test-proj-123'): ProjectId => id as ProjectId,
  user: (id = 'test-user-123'): UserId => id as UserId,
  workflow: (id = 'test-wf-123'): WorkflowId => id as WorkflowId,
  initiative: (id = 'test-init-123'): InitiativeId => id as InitiativeId,
  message: (id = 'test-msg-123'): MessageId => id as MessageId,
  request: (id = 'test-req-123'): RequestId => id as RequestId,
  flowExecution: (id = 'test-exec-123'): FlowExecutionId =>
    id as FlowExecutionId,
  integration: (id = 'test-integration-123'): IntegrationId =>
    id as IntegrationId,
};

// Helper function to pick only specified fields
function pickFields<T extends object>(obj: T, fields: Array<keyof T>): T {
  const result: Partial<T> = {};
  for (const field of fields) {
    if (field in obj) {
      result[field] = obj[field];
    }
  }
  return result as T;
}

// Mock conversation factory
export function createMockConversation(
  overrides?: Partial<ConversationResponseDto>,
): ConversationResponseDto;
export function createMockConversation(
  overrides: Partial<ConversationResponseDto> | undefined,
  fields: Array<keyof ConversationResponseDto>,
): Partial<ConversationResponseDto>;
export function createMockConversation(
  overrides: Partial<ConversationResponseDto> = {},
  fields?: Array<keyof ConversationResponseDto>,
): ConversationResponseDto {
  const base: ConversationResponseDto = {
    id: testIds.conversation,
    createdBy: null,
    projectId: testIds.project,
    organizationId: testIds.organization,
    workflowId: testIds.workflow,
    title: 'Test Conversation',
    status: ConversationStatus.InProgress,
    workflowName: 'test' as WorkflowName,
    initiatedBy: InitiativeCreatorType.User,
    triggerEvent: 'test_trigger',
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// CreateConversationDto factory
export function createMockCreateConversationDto(
  overrides: Partial<{
    projectId: ProjectId;
    workflowId: WorkflowId;
    workflowAboutType: string;
    workflowAboutId: string | null;
    initiatedBy: any;
    triggerEvent: string;
    initiativeId: string | null;
    title: string | null;
    workflowName: string;
    category: any;
    status: any;
  }> = {},
): any {
  return {
    projectId: testIds.project,
    workflowId: testIds.workflow,
    workflowAboutType: 'test-workflow-type',
    workflowAboutId: null,
    initiatedBy: InitiativeCreatorType.User,
    triggerEvent: 'test_trigger',
    initiativeId: null,
    title: 'Test Conversation',
    workflowName: 'onboarding',
    status: ConversationStatus.Started,
    ...overrides,
  };
}

// Mock message factory
export function createMockMessage(
  overrides?: Partial<MessageResponseDto>,
): MessageResponseDto;
export function createMockMessage(
  overrides: Partial<MessageResponseDto> | undefined,
  fields: Array<keyof MessageResponseDto>,
): Partial<MessageResponseDto>;
export function createMockMessage(
  overrides: Partial<MessageResponseDto> = {},
  fields?: Array<keyof MessageResponseDto>,
): MessageResponseDto {
  const base: MessageResponseDto = {
    id: testIds.message,
    conversationId: testIds.conversation,
    projectId: testIds.project,
    type: 'SYSTEM',
    userId: 'system',
    data: {
      type: 'QUESTIONS',
      response: 'Test message',
      detectedIntent: 'test_intent',
      intentConfidence: 0.9,
      uiElements: [],
      actions: [],
    },
    status: MessageStatus.Open,
    createdAt: new Date().toISOString(),
    awaitingResponse: false,
    ...overrides,
  } as MessageResponseDto;

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Helper function to create mock user message
export function createMockUserMessage(
  overrides?: Partial<MessageResponseDto>,
): MessageResponseDto {
  return createMockMessage({
    type: 'USER' as const,
    userId: testIds.user,
    data: {
      message: 'Test user response',
      feedback: 'Test feedback',
    },
    awaitingResponse: false,
    ...overrides,
  } as Partial<MessageResponseDto>);
}

// Mock initiative factory
type InitiativeOverrides = Partial<InitiativeResponseDto> & {
  influences?: Array<{
    artifactId: string;
    reasoning: string;
    reasonType: string;
  }>;
};

export function createMockInitiative(
  overrides?: InitiativeOverrides,
): InitiativeResponseDto;
export function createMockInitiative(
  overrides: InitiativeOverrides | undefined,
  fields: Array<keyof InitiativeResponseDto>,
): Partial<InitiativeResponseDto>;
export function createMockInitiative(
  overrides: InitiativeOverrides = {},
  fields?: Array<keyof InitiativeResponseDto>,
): InitiativeResponseDto {
  const base: InitiativeResponseDto = {
    id: testIds.initiative,
    organizationId: testIds.organization,
    name: 'Test Initiative',
    status: WorkStatus.RefiningDescription,
    priority: Priority.Medium,
    tags: ['test'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    creatorType: InitiativeCreatorType.User,
    originatingProjectId: testIds.project,
    linkedProjectIds: [testIds.project],
    dueDate: undefined,
    reasoning: undefined,
    sourceConversationId: undefined,
    sourceType: undefined,
    sourceId: undefined,
    childCounts: {
      total: 0,
      done: 0,
      inProgress: 0,
      backlog: 0,
    },
    sections: createMockMaterializedWorkItemSections({
      description: 'Test initiative description',
    }),
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Mock Prisma Initiative factory (for service layer)
export function createMockPrismaInitiative(
  overrides?: Partial<Initiative>,
): Initiative;
export function createMockPrismaInitiative(
  overrides: Partial<Initiative> | undefined,
  fields: Array<keyof Initiative>,
): Partial<Initiative>;
export function createMockPrismaInitiative(
  overrides: Partial<Initiative> = {},
  fields?: Array<keyof Initiative>,
): Initiative {
  const now = new Date();
  const base = {
    id: testIds.initiative,
    organizationId: testIds.organization,
    projectId: testIds.project,
    name: 'Test Initiative',
    reasoning: 'Test reasoning',
    status: 'REFINING_DESCRIPTION' as any, // Using string literal to match Prisma enum
    priority: 'MEDIUM' as any,
    assigneeId: testIds.user,
    creatorType: 'USER' as any,
    estimatedEffort: null,
    dueDate: null,
    tags: ['test'],
    sourceConversationId: testIds.conversation,
    sourceType: null,
    sourceId: null,
    createdAt: now,
    updatedAt: now,
    lastModifiedBy: testIds.user,
    lastModifiedAt: now,
    archivedAt: null,
    ...overrides,
  } as Initiative;

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Mock InitiativeRefinableEntity factory
export function createMockInitiativeRefinableEntity(
  overrides?: Partial<InitiativeRefinableEntity>,
): InitiativeRefinableEntity;
export function createMockInitiativeRefinableEntity(
  overrides: Partial<InitiativeRefinableEntity> | undefined,
  fields: Array<keyof InitiativeRefinableEntity>,
): Partial<InitiativeRefinableEntity>;
export function createMockInitiativeRefinableEntity(
  overrides: Partial<InitiativeRefinableEntity> = {},
  fields?: Array<keyof InitiativeRefinableEntity>,
): InitiativeRefinableEntity {
  // Create a mock InitiativeResponseDto first, then convert it
  const mockInitiativeDto = createMockInitiative({
    sections: createMockMaterializedWorkItemSections({
      description: overrides.description || 'Mock description',
      details: overrides.details || 'Mock details',
      acceptanceCriteria:
        overrides.acceptanceCriteria || 'Mock acceptance criteria',
    }),
    // Apply any other overrides that can be directly mapped to InitiativeResponseDto
    ...(overrides.id && { id: overrides.id as InitiativeId }),
    ...(overrides.name && { name: overrides.name }),
    ...(overrides.status && { status: overrides.status as WorkStatus }),
    ...(overrides.priority && { priority: overrides.priority as Priority }),
    ...(overrides.assigneeId && { assigneeId: overrides.assigneeId as UserId }),
    ...(overrides.organizationId && {
      organizationId: overrides.organizationId as OrganizationId,
    }),
    ...(overrides.createdAt && {
      createdAt:
        typeof overrides.createdAt === 'string'
          ? overrides.createdAt
          : overrides.createdAt.toISOString(),
    }),
    ...(overrides.updatedAt && {
      updatedAt:
        typeof overrides.updatedAt === 'string'
          ? overrides.updatedAt
          : overrides.updatedAt.toISOString(),
    }),
  });

  // Convert to InitiativeRefinableEntity
  const refinableEntity = toInitiativeRefinableEntity(mockInitiativeDto);

  // Apply any remaining overrides
  const result: InitiativeRefinableEntity = {
    ...refinableEntity,
    ...overrides,
  };

  if (fields) {
    return pickFields(result, fields);
  }

  return result;
}

// Mock project factory
export function createMockProject(
  overrides?: Partial<ProjectResponseDto>,
): ProjectResponseDto;
export function createMockProject(
  overrides: Partial<ProjectResponseDto> | undefined,
  fields: Array<keyof ProjectResponseDto>,
): Partial<ProjectResponseDto>;
export function createMockProject(
  overrides: Partial<ProjectResponseDto> = {},
  fields?: Array<keyof ProjectResponseDto>,
): ProjectResponseDto {
  const base: ProjectResponseDto = {
    id: testIds.project,
    organizationId: testIds.organization,
    name: 'Test Project',
    description: 'Test project description',
    status: 'ACTIVE',
    currentUserRole: 'OWNER',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...overrides,
    hasEstablishedActivity: overrides.hasEstablishedActivity ?? false,
    maturity: overrides.maturity ?? 'ESTABLISHED',
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Mock task factory
export function createMockTaskResponseDto(
  overrides?: Partial<TaskResponseDto>,
): TaskResponseDto;
export function createMockTaskResponseDto(
  overrides: Partial<TaskResponseDto> | undefined,
  fields: Array<keyof TaskResponseDto>,
): Partial<TaskResponseDto>;
export function createMockTaskResponseDto(
  overrides: Partial<TaskResponseDto> = {},
  fields?: Array<keyof TaskResponseDto>,
): TaskResponseDto {
  const base: TaskResponseDto = {
    id: testIds.task,
    name: 'Test Task',
    type: 'STANDARD',
    organizationId: testIds.organization,
    projectId: testIds.project,
    initiativeId: testIds.initiative, // Required for WorkItemEntity compatibility
    status: WorkStatus.Backlog,
    source: 'system',
    priority: 'MEDIUM' as Priority,
    dueDate: undefined,
    assigneeId: undefined,
    parentTaskId: undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: undefined,
    childCounts: {
      total: 0,
      done: 0,
      inProgress: 0,
      backlog: 0,
    },
    sections: createMockMaterializedTaskSections({
      description: 'Test task description',
      acceptanceCriteria: 'Test success criteria for completion',
    }),
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Mock artifact factory
export function createMockArtifact(
  overrides?: Partial<ArtifactResponseDto>,
): ArtifactResponseDto;
export function createMockArtifact(
  overrides: Partial<ArtifactResponseDto> | undefined,
  fields: Array<keyof ArtifactResponseDto>,
): Partial<ArtifactResponseDto>;
export function createMockArtifact(
  overrides: Partial<ArtifactResponseDto> = {},
  fields?: Array<keyof ArtifactResponseDto>,
): ArtifactResponseDto {
  const base: ArtifactResponseDto = {
    id: 'test-artifact-123',
    projectId: testIds.project,
    type: ArtifactType.QaPair,
    title: 'Test Artifact',
    data: {
      type: 'QA_PAIR',
      question: 'Test question?',
      answer: 'Test answer',
    } as ArtifactData,
    tags: ['test'],
    status: ArtifactStatus.Active,
    priority: Priority.Medium,
    isPublic: false,
    sourceType: ArtifactSourceType.Conversation,
    sourceId: 'test-source-123',
    hasEmbedding: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Influence mock data factories
export function createMockInfluence(
  overrides?: Partial<import('../generated').Influence>,
): import('../generated').Influence;
export function createMockInfluence(
  overrides: Partial<import('../generated').Influence> | undefined,
  fields: Array<keyof import('../generated').Influence>,
): Partial<import('../generated').Influence>;
export function createMockInfluence(
  overrides: Partial<import('../generated').Influence> = {},
  fields?: Array<keyof import('../generated').Influence>,
): import('../generated').Influence {
  const base: import('../generated').Influence = {
    entityId: 'test-artifact-123',
    entityType: 'ARTIFACT',
    reasoning: 'Test reasoning for influence',
    reasonType: 'previous_conversation',
    confidence: 0.8,
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Legacy alias for backward compatibility (deprecated)
export const createMockArtifactInfluence = createMockInfluence;

export function createMockArtifactWithInfluences(
  artifactOverrides: Partial<ArtifactResponseDto> = {},
  influences: import('../generated').Influence[] = [],
): ArtifactResponseDto & {
  influences: import('../generated').Influence[];
} {
  return {
    ...createMockArtifact(artifactOverrides),
    influences,
  };
}

// Database test helpers for influence testing
export const createTestArtifactData = (
  overrides: Partial<{
    id: string;
    organizationId: string;
    projectId: string;
    type: string;
    title: string;
    content: string;
    category: string;
    sourceType: string;
    sourceId: string;
    status: string;
  }> = {},
) => ({
  id: 'test-artifact-123',
  organizationId: testIds.organization,
  projectId: testIds.project,
  type: 'INSIGHT', // This will be cast to ArtifactType when used with Prisma
  title: 'Test Artifact',
  data: { type: 'INSIGHT', content: overrides.content || 'Test content' }, // Required `data` field for Prisma
  category: 'test',
  sourceType: 'CONVERSATION', // This will be cast to ArtifactSourceType when used with Prisma
  sourceId: testIds.conversation,
  status: 'ACTIVE', // This will be cast to ArtifactStatus when used with Prisma
  ...overrides,
});

export const createTestInfluenceData = (
  overrides: Partial<{
    influencingId: string;
    influencedId: string;
    reasoning: string;
    reasonType: string;
    confidence: number;
    organizationId: string;
  }> = {},
) => ({
  influencingId: 'source-artifact-123',
  influencedId: 'target-artifact-456',
  reasoning: 'Test influence reasoning',
  reasonType: 'CONTEXT',
  confidence: 0.8,
  organizationId: testIds.organization,
  ...overrides,
});

// Agent mock data factories
export function createMockAgentRequest(
  overrides: Partial<MastraAgentRequest> = {},
): MastraAgentRequest {
  return {
    agentId: testIds.agentId,
    requestId: 'req-test-001',
    context: {
      currentLevel: 'details',
      organizationId: testIds.organization,
      projectId: testIds.project,
      initiativeId: testIds.initiative,
      conversationId: testIds.conversation,
      workflowAboutId: 'workflow-about-id',
      workflowAboutType: 'workflow-about-type',
    },
    messages: [{ role: 'user', content: 'Test message for agent execution' }],
    maxExecutionTime: 300000,
    temperature: 0.7,
    ...overrides,
  };
}

export function createMockAgentResponse(
  overrides: Partial<MastraAgentResponse> = {},
): MastraAgentResponse {
  return {
    executionId: testIds.agentExecution,
    status: 'completed',
    result: createMockAgentResult(),
    executionTime: 5000,
    cost: 0.05,
    error: undefined,
    ...overrides,
  };
}

export function createMockAgentResult(
  overrides: Partial<AgentExecutionResult> = {},
): AgentExecutionResult {
  return {
    agentId: 'test-agent',
    data: {},
    confidence: 0.85,
    ...overrides,
  };
}

export function createMockAgentCostData(
  overrides: Partial<AgentCostData> = {},
): AgentCostData {
  return {
    agentId: testIds.agentId,
    executionId: testIds.agentExecution,
    executionTime: 5000,
    cost: 0.05,
    organizationId: testIds.organization,
    projectId: testIds.project,
    tokenUsage: {
      inputTokens: 100,
      outputTokens: 50,
    },
    metadata: {
      confidence: 0.85,
      toolCalls: 1,
      changesApplied: 1,
      initiativeId: testIds.initiative,
    },
    ...overrides,
  };
}

export function createMockAgentNodeData(
  overrides: Partial<MastraAgentResponse> = {},
): MastraAgentResponse {
  return {
    executionId: testIds.agentExecution,
    status: 'completed',
    result: createMockAgentResult(),
    executionTime: 5000,
    cost: 0.05,
    ...overrides,
  };
}

// Mock database initiative factory (includes archivedAt field)
export function createMockDatabaseInitiative(
  overrides?: Partial<Initiative>,
): Initiative;
export function createMockDatabaseInitiative(
  overrides: Partial<Initiative> | undefined,
  fields: Array<keyof Initiative>,
): Partial<Initiative>;
export function createMockDatabaseInitiative(
  overrides: Partial<Initiative> = {},
  fields?: Array<keyof Initiative>,
): Initiative {
  const base: Initiative = {
    id: testIds.initiative as string,
    organizationId: testIds.organization as string,
    name: 'Test Initiative',
    assigneeId: null,
    reasoning: null,
    status: 'REFINING_DESCRIPTION',
    priority: 'MEDIUM',
    creatorType: 'USER',
    dueDate: null,
    tags: ['test'],
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    sourceConversationId: null,
    sourceType: null,
    sourceId: null,
    lastModifiedBy: testIds.user as string,
    lastModifiedAt: new Date(),
    originatingProjectId: testIds.project as string,
    ...overrides,
  };
  if (fields) {
    return pickFields(base, fields);
  }
  return base;
}

// Mock initiative draft factory
export function createMockInitiativeDraft(
  overrides?: Partial<InitiativeDraft>,
): InitiativeDraft;
export function createMockInitiativeDraft(
  overrides: Partial<InitiativeDraft> | undefined,
  fields: Array<keyof InitiativeDraft>,
): Partial<InitiativeDraft>;
export function createMockInitiativeDraft(
  overrides: Partial<InitiativeDraft> = {},
  fields?: Array<keyof InitiativeDraft>,
): InitiativeDraft {
  const base: InitiativeDraft = {
    id: testIds.initiative,
    name: 'Mock Initiative Draft',
    description: 'Mock initiative description',
    details: 'Mock initiative details',
    acceptanceCriteria: 'Mock acceptance criteria',
    reasoning: 'Mock reasoning for initiative',
    estimatedEffort: 'medium',
    priority: 'medium',
    tags: ['mock-tag'],
    currentLevel: 'description',
    reviewStatus: 'unreviewed',
    influences: [],
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Mock tag factory - using CreateTagDto as TagResponseDto doesn't exist
export function createMockTag(overrides?: Partial<CreateTagDto>): CreateTagDto;
export function createMockTag(
  overrides: Partial<CreateTagDto> | undefined,
  fields: Array<keyof CreateTagDto>,
): Partial<CreateTagDto>;
export function createMockTag(
  overrides: Partial<CreateTagDto> = {},
  fields?: Array<keyof CreateTagDto>,
): CreateTagDto {
  const base: CreateTagDto = {
    organizationId: testIds.organization,
    name: 'test-tag',
    description: null,
    color: null,
    source: TagSource.User,
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Mock integration factory
export function createMockIntegration(
  overrides?: Partial<IntegrationResponseDto>,
): IntegrationResponseDto;
export function createMockIntegration(
  overrides: Partial<IntegrationResponseDto> | undefined,
  fields: Array<keyof IntegrationResponseDto>,
): Partial<IntegrationResponseDto>;
export function createMockIntegration(
  overrides: Partial<IntegrationResponseDto> = {},
  fields?: Array<keyof IntegrationResponseDto>,
): IntegrationResponseDto {
  const base: IntegrationResponseDto = {
    id: testIds.integration,
    organizationId: testIds.organization,
    projectId: testIds.project,
    type: IntegrationType.Github,
    name: 'Test Integration',
    description: 'Test integration description',
    config: {
      token: 'test-token',
      webhookSecret: 'test-webhook-secret',
      repositoryUrl: 'https://github.com/test/repo',
    },
    targetType: IntegrationTargetType.Organization,
    state: IntegrationState.Active,
    connectionStatus: IntegrationConnectionStatus.Connected,
    lastConnectionCheck: new Date().toISOString(),
    lastSuccessfulSync: new Date().toISOString(),
    errorMessage: null,
    createdBy: testIds.user,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Mock flow context factory

type FlowOverrides = Partial<Omit<Flow, 'node'>> & {
  nodes?: Omit<Flow['nodes'], 'end' | 'recovery'>;
};

// Mock flow context factory
export function createMockFlow(overrides?: FlowOverrides): Flow;
export function createMockFlow(
  overrides: FlowOverrides | undefined,
  fields: Array<keyof Flow>,
): Partial<Flow>;
export function createMockFlow(
  overrides: FlowOverrides = {},
  fields?: Array<keyof Flow>,
): Flow {
  const baseNodes: Record<
    string,
    ConversationNode<Readonly<FlowContext>>
  > = overrides.nodes
    ? { ...overrides.nodes }
    : {
        'test-node': {
          id: 'test-node',
          title: 'Test Node',
        } as ConversationNode,
      };

  const nodes: Flow['nodes'] = {
    ...baseNodes,
    end: {
      id: 'end',
      title: 'End Node',
    } as ConversationNode,
    recovery: {
      id: 'recovery',
      title: 'Recovery Node',
    } as ConversationNode,
  };

  const base: Flow = {
    id: testIds.flowId,
    name: 'flow',
    description: 'desc',
    version: 1,
    startNode: 'welcome',
    ...overrides,
    nodes,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Mock flow context factory
export function createMockFlowContext(
  overrides?: Partial<FlowContext>,
): FlowContext;
export function createMockFlowContext(
  overrides: Partial<FlowContext> | undefined,
  fields: Array<keyof FlowContext>,
): Partial<FlowContext>;
export function createMockFlowContext(
  overrides: Partial<FlowContext> = {},
  fields?: Array<keyof FlowContext>,
): FlowContext {
  const base: FlowContext = {
    core: {
      workflowId: testIds.workflow,
      projectId: testIds.project,
      organizationId: testIds.organization,
      conversationId: testIds.conversation,
      workflowAboutId: 'workflow-about-id',
      workflowAboutType: 'task',
      user: { id: testIds.user, role: 'member' },
      session: { startTime: new Date(), interactionCount: 1 },
    },
    flowId: 'test-flow',
    flowPath: {
      pathTaken: [],
    },
    lastAgentExecution: undefined,
    currentInitiativeId: undefined,
    projectData: undefined,
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Mock flow user message factory
export function createMockFlowUserMessage(
  overrides?: Partial<FlowUserMessage>,
): FlowUserMessage;
export function createMockFlowUserMessage(
  overrides: Partial<FlowUserMessage> | undefined,
  fields: Array<keyof FlowUserMessage>,
): Partial<FlowUserMessage>;
export function createMockFlowUserMessage(
  overrides: Partial<FlowUserMessage> = {},
  fields?: Array<keyof FlowUserMessage>,
): FlowUserMessage {
  const base: FlowUserMessage = {
    id: testIds.message,
    workflowId: testIds.workflow,
    projectId: testIds.project,
    type: 'USER' as const,
    status: MessageStatus.Open,
    data: { message: 'Test user message' },
    conversationId: testIds.conversation,
    parentMessageId: testIds.parentMessage,
    createdAt: new Date().toISOString(),
    timestamp: new Date().toISOString(),
    nodeId: testIds.nodeId,
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Mock node result factory - using OPENER type specifically
export function createMockNodeResult(
  overrides?: Partial<NodeResult>,
): NodeResult;
export function createMockNodeResult(
  overrides: Partial<NodeResult> | undefined,
  fields: Array<keyof NodeResult>,
): Partial<NodeResult>;
export function createMockNodeResult(
  overrides: Partial<NodeResult> = {},
  fields?: Array<keyof NodeResult>,
): NodeResult {
  const base: NodeResult = {
    type: NodeType.OPENER,
    message: 'Test node result',
    data: {
      detectedIntent: 'test_intent',
      intentConfidence: 0.9,
    },
    uiElements: [],
    actions: [],
    ...overrides,
  } as NodeResult;

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Mock Prisma service structure
export const createMockPrismaService = () => ({
  db: {
    conversation: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    message: {
      create: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    unifiedSearchLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    messageMention: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    task: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      groupBy: jest.fn(),
      count: jest.fn(),
    },
    workItemType: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    workItemTypeTemplate: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    proposal: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    workItemChangeSetMaterialization: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    taskDependency: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    initiative: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    plan: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    planRelationship: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    planExecutionGuidance: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      upsert: jest.fn(),
    },
    planStage: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    planStep: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    planStepRelation: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    planVersion: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn(),
    },
    planSignOff: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    projectInitiative: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    analyticsEventBatch: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    analyticsEvent: {
      createMany: jest.fn(),
      findUnique: jest.fn(),
    },
    entityRegistry: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      createMany: jest.fn(),
      updateMany: jest.fn(),
    },
    project: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    artifact: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    tag: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    entityStar: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    organization: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    organizationMember: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    projectMember: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    goalMembership: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    outboxEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    interactionFlow: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    interactionStep: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    uiFlow: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    apiKey: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    designDoc: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    designDocSection: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    artifactRelation: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    designDocSectionUpdate: {
      create: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    subfacet: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    entitySummary: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    entitySubfacet: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    agentSession: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    agentOperation: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    executionAuthorization: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    executionGrant: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    report: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    reportEntity: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    fileTouchIndex: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    implementationHint: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    implementationHintVersion: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    implementationHintFileReference: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    service: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    serviceTask: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    serviceInitiative: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    serviceAgentSession: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
      delete: jest.fn(),
    },
    taskSectionHistory: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(async function (this: any, arg: any) {
      if (typeof arg === 'function') return arg(this);
      return Promise.all(arg);
    }),
  },
  $transaction: jest.fn(async function (this: any, arg: any) {
    if (typeof arg === 'function') return arg(this.db);
    return Promise.all(arg);
  }),
  $connect: jest.fn(),
  $disconnect: jest.fn(),
});

// Mock service factories with proper types
export const createMockConversationService = () =>
  ({
    createConversation: jest.fn(),
    getConversation: jest.fn(),
    findOne: jest.fn(),
    updateConversation: jest.fn(),
    updateConversationInternal: jest.fn(),
    updateConversationWorkflowId: jest.fn(),
    // Default to "won the claim" so the startConversationWorkflow path proceeds
    // unless a test explicitly overrides this to exercise the lost-race branch.
    claimConversationForStart: jest
      .fn()
      .mockResolvedValue({ claimed: true, conversation: null }),
    incrementConversationVersion: jest.fn(),
    getConversationsByProject: jest.fn(),
    getActiveConversations: jest.fn(),
    getActiveConversationsFromAdapter: jest.fn(),
    getConversationsByInitiativeFromAdapter: jest.fn(),
    getConversationsByWorkflowEntityFromAdapter: jest.fn(),
    getAllConversationsFromAdapter: jest.fn(),
    getConversationFromAdapter: jest.fn(),
    getConversationVersion: jest.fn(),
    getOwnerUserId: jest.fn(),
    getOwnerMachineSelection: jest.fn(),
    updateConversationFromAdapter: jest.fn(),
    deleteConversation: jest.fn(),
    deleteConversationFromAdapter: jest.fn(),
    getConversationHistoryEntries: jest.fn(),
    getRecentMessages: jest.fn(),
  }) as unknown as jest.Mocked<ConversationService>;

export const createMockMessageService = () =>
  ({
    addMessage: jest.fn(),
    removePendingOpenTrigger: jest.fn(),
    appendMessageToConversation: jest.fn(),
    getMessagesForAdapter: jest.fn(),
    getMessageForAdapter: jest.fn(),
    addMessageFromAdapter: jest.fn(),
    updateMessageFromAdapter: jest.fn(),
    getMessage: jest.fn(),
    updateMessage: jest.fn(),
    deleteMessage: jest.fn(),
    getPendingMessageByRequest: jest.fn(),
    getMessagesByConversation: jest.fn(),
    getRecentMessages: jest.fn(),
    getMessageStats: jest.fn(),
    setPendingMessageByJob: jest.fn(),
    setPendingMessage: jest.fn(),
    getPendingMessageByJob: jest.fn(),
    getMessages: jest.fn(),
    getMostRecentUserMessage: jest.fn(),
    updateSystemMessageWithLLMResponse: jest.fn(),
    searchByWorkflowAbout: jest.fn(),
  }) as unknown as jest.Mocked<MessageService>;

export const createMockInitiativeOptimizationService = () =>
  ({
    detectChanges: jest.fn(),
    generateOptimizationContext: jest.fn(),
  }) as unknown as jest.Mocked<InitiativeOptimizationService>;

export const createMockQueueService = () =>
  ({
    addJob: jest.fn(),
    getJob: jest.fn(),
    addProcessor: jest.fn(),
    getStats: jest.fn(),
    getJobs: jest.fn(),
    retryJob: jest.fn(),
    cleanup: jest.fn(),
    removeJob: jest.fn(),
  }) as unknown as jest.Mocked<IQueueService>;

export const createMockJobEnqueuer = () =>
  ({
    queueFlowNodeExecution: jest.fn(),
    queueNonInteractiveFlowNodeExecution: jest.fn(),
    queueAgentWorkflow: jest.fn(),
    queueArtifactGeneration: jest.fn(),
    getJob: jest.fn(),
    getQueueStats: jest.fn(),
    retryJob: jest.fn(),
  }) as unknown as jest.Mocked<IJobEnqueuer>;

export const createMockDesignDocService = () =>
  ({
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    restore: jest.fn(),
    createForAdapter: jest.fn(),
    findAllForAdapter: jest.fn(),
    findOneForAdapter: jest.fn(),
    updateForAdapter: jest.fn(),
    removeForAdapter: jest.fn(),
    restoreForAdapter: jest.fn(),
    applySectionUpdates: jest.fn(),
  }) as unknown as jest.Mocked<any>;

export const createMockFlowExecutionService = () =>
  ({
    createFlowExecution: jest.fn(),
    updateFlowState: jest.fn(),
    markCompleted: jest.fn(),
    markFailed: jest.fn(),
    findByConversation: jest.fn(),
    findLatestResumableByEntity: jest.fn(),
    getExecutionStats: jest.fn(),
  }) as unknown as jest.Mocked<FlowExecutionService>;

export const createMockFlowEngineService = () =>
  ({
    registerFlow: jest.fn(),
    getFlow: jest.fn(),
    getNode: jest.fn(),
    getPreviousNode: jest.fn(),
    executeNode: jest.fn(),
    executeNonLLMNode: jest.fn(),
    executePreClassify: jest.fn(),
    executePreviousNodePostProcess: jest.fn(),
    applyContextTransform: jest.fn(),
    startFlowNode: jest.fn(),
    determineNextNode: jest.fn(),
    onModuleInit: jest.fn(),
    getFlowDefinition: jest.fn(),
    processNode: jest.fn(),
  }) as unknown as jest.Mocked<NodeExecutionService>;

export const createMockAgentProcessor = () =>
  ({
    processAgentWorkflow: jest.fn().mockResolvedValue(undefined),
    handleAgentRequestEvent: jest.fn().mockResolvedValue(undefined),
    handleAgentProgressEvent: jest.fn().mockResolvedValue(undefined),
    handleAgentCompletionEvent: jest.fn().mockResolvedValue(undefined),
    updateSystemMessageWithAgentResponse: jest
      .fn()
      .mockResolvedValue(undefined),
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
  }) as unknown as jest.Mocked<any>;

export const createMockInitiativeService = () =>
  ({
    createMany: jest.fn(),
    createForAdapter: jest.fn(),
    findAllForAdapter: jest.fn(),
    findOneForAdapter: jest.fn(),
    findByIdForAdapter: jest.fn(),
    updateForAdapter: jest.fn(),
    deleteForAdapter: jest.fn(),
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    findByProject: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    createFromFlow: jest.fn(),
    createFromDrafts: jest.fn(),
    findByIds: jest.fn(),
    updateMany: jest.fn(),
    updateFromFlow: jest.fn(),
    refineInitiatives: jest.fn(),
    getInitiativesForRefinement: jest.fn(),
    applyRefinementChanges: jest.fn(),
    findByConversation: jest.fn(),
    getActiveRefinementConversation: jest.fn(),
    getInitiativeFromConversation: jest.fn(),
  }) as unknown as jest.Mocked<InitiativeService>;

export const createMockTaskService = () =>
  ({
    create: jest.fn(),
    createFromDrafts: jest.fn(),
    findAll: jest.fn(),
    findReferences: jest.fn(),
    findOne: jest.fn(),
    findOneByOrganization: jest.fn(),
    findHierarchy: jest.fn(),
    findHierarchyByOrganization: jest.fn(),
    update: jest.fn(),
    updateByOrganization: jest.fn(),
    remove: jest.fn(),
    removeByOrganization: jest.fn(),
    findOneForAdapter: jest.fn(),
    updateForAdapter: jest.fn(),
    findAllByOrganizationForAdapter: jest.fn(),
    createRefinementConversation: jest.fn(),
    getActiveRefinementConversation: jest.fn(),
  }) as unknown as jest.Mocked<TaskService>;

export const createMockIntentDetectorService = () =>
  ({
    detectIntent: jest.fn(),
    detect: jest.fn(),
    mapIntentToTransition: jest.fn(),
  }) as unknown as jest.Mocked<IntentDetectorService>;

export const createMockIntegrationService = () =>
  ({
    findAllActiveIntegrations: jest.fn(),
    findOneWithDecryptedConfig: jest.fn(),
    mapToDto: jest.fn(),
    dtoToIntegration: jest.fn(),
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    sync: jest.fn(),
    testConnection: jest.fn(),
    updateConnectionStatus: jest.fn(),
  }) as unknown as jest.Mocked<{
    findAllActiveIntegrations: (
      organizationId: OrganizationId,
    ) => Promise<IntegrationResponseDto[]>;
    findOneWithDecryptedConfig: (
      id: IntegrationId,
    ) => Promise<IntegrationResponseDto | null>;
    mapToDto: (integration: unknown) => IntegrationResponseDto;
    dtoToIntegration: (integration: IntegrationResponseDto) => unknown;
    create: (
      organizationId: OrganizationId,
      projectId: ProjectId,
      createIntegrationDto: unknown,
      createdBy?: UserId,
    ) => Promise<IntegrationResponseDto>;
    findAll: (
      organizationId: OrganizationId,
    ) => Promise<IntegrationResponseDto[]>;
    findOne: (id: IntegrationId) => Promise<IntegrationResponseDto | null>;
    update: (
      id: IntegrationId,
      updates: unknown,
    ) => Promise<IntegrationResponseDto>;
    remove: (id: IntegrationId) => Promise<void>;
    sync: (id: IntegrationId) => Promise<void>;
    testConnection: (id: IntegrationId) => Promise<boolean>;
    updateConnectionStatus: (
      id: IntegrationId,
      status: unknown,
    ) => Promise<IntegrationResponseDto>;
  }>;

export const createMockGitHubIntegrationHandler = () =>
  ({
    getIntegrationType: jest.fn(),
    testConnection: jest.fn(),
    sync: jest.fn(),
    handleWebhook: jest.fn(),
    validateConfig: jest.fn(),
    getRequiredConfigFields: jest.fn(),
    getSuggestedUsers: jest.fn(),
  }) as unknown as jest.Mocked<{
    getIntegrationType: () => string;
    testConnection: (
      config: unknown,
      organizationId: OrganizationId,
    ) => Promise<unknown>;
    sync: (integration: unknown) => Promise<void>;
    handleWebhook: (payload: unknown, signature: string) => Promise<void>;
    validateConfig: (config: unknown) => Promise<boolean>;
    getRequiredConfigFields: () => string[];
    getSuggestedUsers: (integration: unknown) => Promise<unknown[]>;
  }>;

export const createMockLLMClientService = () =>
  ({
    generateResponse: jest.fn(),
    call: jest.fn(),
    callStructured: jest.fn(),
    streamLLM: jest.fn(),
  }) as unknown as jest.Mocked<LLMClientService>;

export const createMockArtifactService = () =>
  ({
    create: jest.fn(),
    createMany: jest.fn(),
    archiveBySource: jest.fn(),
    restoreArchivedBySource: jest.fn(),
    findMany: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    resolveReferences: jest.fn(),
    semanticSearch: jest.fn(),
  }) as unknown as jest.Mocked<ArtifactService>;

// Agent service mock factories
export const createMockMastraClientService = () =>
  ({
    executeAgent: jest.fn(),
    executeAgentWithTools: jest.fn(),
    getCircuitBreakerKey: jest.fn(),
    shouldAllowExecution: jest.fn(),
    validateAgentConfig: jest.fn(),
    classifyError: jest.fn(),
  }) as unknown as jest.Mocked<{
    executeAgent: (request: MastraAgentRequest) => Promise<MastraAgentResponse>;
    getCircuitBreakerKey: (
      agentId: string,
      organizationId: OrganizationId,
    ) => string;
    shouldAllowExecution: (
      agentId: string,
      organizationId: OrganizationId,
    ) => Promise<boolean>;
    validateAgentConfig: (
      agentId: string,
      context: Record<string, unknown>,
    ) => void;
    classifyError: (error: unknown) => string;
  }>;

export const createMockAgentCostTrackingService = () =>
  ({
    trackAgentExecution: jest.fn(),
    getOrganizationAgentCosts: jest.fn(),
    getAgentCostSummary: jest.fn(),
    getAgentCostTrends: jest.fn(),
    checkCostAlerts: jest.fn(),
  }) as unknown as jest.Mocked<{
    trackAgentExecution: (data: AgentCostData) => Promise<void>;
    getOrganizationAgentCosts: (
      organizationId: OrganizationId,
    ) => Promise<AgentCostData[]>;
    getAgentCostSummary: (
      organizationId: OrganizationId,
    ) => Promise<{ totalCost: number; executionCount: number }>;
    getAgentCostTrends: (organizationId: OrganizationId) => Promise<unknown[]>;
    checkCostAlerts: (organizationId: OrganizationId) => Promise<unknown[]>;
  }>;

export const createMockDomainEventPublisher = () =>
  ({
    publish: jest.fn().mockResolvedValue(undefined),
    publishInTransaction: jest.fn().mockResolvedValue(undefined),
    publishBatch: jest.fn().mockResolvedValue(undefined),
    getPublishedEvents: jest.fn().mockReturnValue([]),
    clearEvents: jest.fn(),
    hasEvent: jest.fn().mockReturnValue(false),
    getEventCount: jest.fn().mockReturnValue(0),
  }) as unknown as jest.Mocked<DomainEventPublisher>;

export const createMockTemporalClient = () =>
  ({
    workflow: {
      getHandle: jest.fn(() => ({
        signal: jest.fn(),
        describe: jest.fn(() => ({
          status: { name: 'TERMINATED' },
        })),
      })),
      start: jest.fn(),
      execute: jest.fn(),
    },
    activity: jest.fn(),
    schedule: jest.fn(),
    taskQueue: jest.fn(),
    operator: jest.fn(),
    action: jest.fn(),
    batch: jest.fn(),
    options: jest.fn(),
    withMetadata: jest.fn(),
  }) as unknown as jest.Mocked<Client>;

export const createMockEventRouter = () =>
  ({
    on: jest.fn(),
    emit: jest.fn(),
    off: jest.fn(),
  }) as jest.Mocked<{
    on: (event: string, handler: (...args: unknown[]) => void) => void;
    emit: (event: string, ...args: unknown[]) => void;
    off: (event: string, handler: (...args: unknown[]) => void) => void;
  }>;

export const createMockMessageClassificationService = () =>
  ({
    classifyMessage: jest.fn(),
    classifyMessageWithLevel: jest.fn(),
    shouldRouteMessage: jest.fn(),
    extractInitiativeContext: jest.fn(),
    generateWorkflowSignal: jest.fn(),
    getConfig: jest.fn(),
  }) as jest.Mocked<{
    classifyMessage: (message: any, context: any) => Promise<any>;
    classifyMessageWithLevel: (
      message: any,
      context: any,
      level: string,
      organizationId?: OrganizationId,
    ) => Promise<any>;
    shouldRouteMessage: (message: any) => Promise<boolean>;
    extractInitiativeContext: (context: any) => Promise<any>;
    generateWorkflowSignal: (signal: any) => Promise<any>;
    getConfig: () => any;
  }>;

export const createMockContextResolutionService = () =>
  ({
    getInitiativesForConversation: jest.fn(),
    resolveContext: jest.fn(),
    registerProvider: jest.fn(),
  }) as jest.Mocked<{
    getInitiativesForConversation: (
      conversationId: ConversationId,
    ) => Promise<InitiativeResponseDto[]>;
    resolveContext: (context: unknown) => Promise<unknown>;
    registerProvider: (provider: unknown) => void;
  }>;

// Mock data factories for message classification types
export interface ConversationContext {
  conversationId: ConversationId;
  organizationId: OrganizationId;
  userId: UserId;
  projectId: ProjectId;
  workflowId: WorkflowId;
  availableInitiatives: Array<{
    id: InitiativeId;
    name: string;
    description: string;
    currentLevel: string;
    status: string;
  }>;
  recentMessages: Array<{
    content: string;
    type: string;
    timestamp: Date;
  }>;
}

export function createMockConversationContext(
  overrides?: Partial<ConversationContext>,
): ConversationContext {
  return {
    conversationId: testIds.conversation,
    organizationId: testIds.organization,
    userId: testIds.user,
    projectId: testIds.project,
    workflowId: testIds.workflow,
    availableInitiatives: [
      {
        id: testIds.initiative,
        name: 'Test Initiative',
        description: 'Test initiative description',
        currentLevel: 'description',
        status: 'PLANNING',
      },
    ],
    recentMessages: [
      {
        content: 'Test message content',
        type: 'USER',
        timestamp: new Date(),
      },
    ],
    ...overrides,
  };
}

export interface MessageClassificationResult {
  intent: string;
  confidence: number;
  reasoning: string;
  targetInitiativeId: InitiativeId | null;
  targetLevel: string | null;
  metadata: {
    autoClassified: boolean;
    processedAt: string;
    model: string;
  };
}

export function createMockMessageClassificationResult(
  overrides?: Partial<MessageClassificationResult>,
): MessageClassificationResult {
  return {
    intent: 'GENERAL',
    confidence: 0.5,
    reasoning: 'Test classification reasoning',
    targetInitiativeId: null,
    targetLevel: null,
    metadata: {
      autoClassified: true,
      processedAt: new Date().toISOString(),
      model: 'claude-4-haiku',
    },
    ...overrides,
  };
}

export interface MessageCreatedEvent {
  id: string;
  type: 'MESSAGE.CREATED';
  aggregateId: MessageId;
  aggregateVersion: number;
  eventType: 'MESSAGE.CREATED';
  payload: {
    organizationId: OrganizationId;
    conversationId: ConversationId;
    userId: UserId;
    message: {
      type: 'USER' | 'SYSTEM';
      data: { message: string };
      status: string;
      workflowId: WorkflowId;
      conversationId: ConversationId;
      createdAt: string;
    };
  };
}

export function createMockMessageCreatedEvent(
  overrides?: Partial<MessageCreatedEvent>,
): MessageCreatedEvent {
  return {
    id: testIds.event,
    type: 'MESSAGE.CREATED',
    aggregateId: testIds.message,
    aggregateVersion: 1,
    eventType: 'MESSAGE.CREATED',
    payload: {
      payloadType: PayloadType.MessageCreated,
      organizationId: testIds.organization,
      conversationId: testIds.conversation,
      projectId: testIds.project,
      userId: testIds.user,
      message: {
        type: 'USER',
        data: { message: 'Test message content' },
        status: 'PENDING',
        workflowId: testIds.workflow,
        conversationId: testIds.conversation,
        createdAt: new Date().toISOString(),
      },
    },
    ...overrides,
  } as MessageCreatedEvent;
}

export interface EventEnvelope<T = MessageCreatedEvent> {
  id: string;
  timestamp: number;
  event: T;
}

export function createMockEventEnvelope<T = MessageCreatedEvent>(
  event?: T,
  overrides?: Partial<EventEnvelope<T>>,
): EventEnvelope<T> {
  return {
    id: testIds.event,
    timestamp: Date.now(),
    event: (event || createMockMessageCreatedEvent()) as T,
    ...overrides,
  };
}

// Mock service factories for common patterns
export const createMockServices = () => ({
  conversationService: {
    createConversation: jest.fn(),
    getConversation: jest.fn(),
    updateConversation: jest.fn(),
  },
  messageService: {
    addMessage: jest.fn(),
    getMessage: jest.fn(),
    updateMessage: jest.fn(),
  },
  initiativeService: {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  projectService: {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  temporalClient: {
    workflow: {
      start: jest.fn(),
      getHandle: jest.fn(),
    },
  },
  flowEngineService: {
    executeNonLLMNode: jest.fn(),
    startFlowNode: jest.fn(),
    getFlow: jest.fn(),
    applyContextTransform: jest.fn(),
  },
  queueService: {
    addJob: jest.fn(),
    getJob: jest.fn(),
  },
  jobEnqueuer: {
    queueFlowNodeExecution: jest.fn(),
    queueAgentWorkflow: jest.fn(),
    queueArtifactGeneration: jest.fn(),
    getJob: jest.fn(),
    getQueueStats: jest.fn(),
    retryJob: jest.fn(),
  },
});

// Integration config factory
export const createMockIntegrationConfig = (
  type: IntegrationType,
  overrides: Record<string, string | boolean | number> = {},
) => {
  const baseConfigs = {
    [IntegrationType.Github]: {
      token: 'github_token_123',
      webhookSecret: 'webhook_secret_123',
    },
    [IntegrationType.Slack]: {
      botToken: 'slack_bot_token_123',
      signingSecret: 'slack_signing_secret_123',
    },
    [IntegrationType.Jira]: {
      apiToken: 'jira_api_token_123',
      domain: 'test.atlassian.net',
    },
  };

  return {
    ...baseConfigs[type],
    ...overrides,
  };
};

// Utility for creating arrays of mocks
export const createMockArray = <T>(
  factory: (overrides?: Partial<T>) => T,
  count = 3,
  overridesArray: Partial<T>[] = [],
): T[] => {
  return Array.from({ length: count }, (_, index) =>
    factory(overridesArray[index] || {}),
  );
};

// Mock placeholder context factory
export function createMockPlaceholderContext(
  overrides: Partial<any> = {},
): any {
  const { services: overrideServices, ...restOverrides } = overrides;
  const mockServices = {
    initiativeService: {
      findOne: jest.fn().mockResolvedValue(null),
      findOneForAdapter: jest.fn().mockResolvedValue(null),
    } as any,
    artifactService: {
      findOne: jest.fn().mockResolvedValue(null),
    } as any,
    taskService: {
      findOneByOrganization: jest.fn().mockResolvedValue(null),
      findOneForAdapter: jest.fn().mockResolvedValue(null),
    } as any,
    designDocService: {
      findOne: jest.fn().mockResolvedValue(null),
      findOneForAdapter: jest.fn().mockResolvedValue(null),
    } as any,
    messageService: {
      getMentionsForConversation: jest.fn().mockResolvedValue([]),
    } as any,
    entityRegistryService: {
      getEntitiesByIds: jest.fn().mockResolvedValue([]),
      lookupEntityTypes: jest.fn().mockResolvedValue({}),
    } as any,
    contextResolutionService: {
      resolveContext: jest.fn(),
    } as any,
    planService: {
      findOne: jest.fn().mockResolvedValue(null),
    } as any,
  };

  const mockFlowContext: any = {
    core: {
      workflowId: 'test-workflow' as any,
      projectId: 'test-project' as any,
      organizationId: 'test-org' as any,
      conversationId: 'test-conversation' as any,
      user: { id: 'test-user' as any, role: 'member' },
      session: { startTime: new Date(), interactionCount: 1 },
    },
    flowId: 'test-flow',
    flowPath: {
      pathTaken: [] as string[],
      previousNode: null as string | null,
    },
  };

  return {
    flowContext: mockFlowContext,
    promptContext: {
      projectId: mockFlowContext.core.projectId,
      organizationId: mockFlowContext.core.organizationId,
      conversationId: mockFlowContext.core.conversationId,
      user: mockFlowContext.core.user,
    },
    nodeBuildContext: {},
    services: { ...mockServices, ...(overrideServices || {}) },
    options: {},
    ...restOverrides,
  };
}

// Mock job factory
export function createMockJob<T = Record<string, unknown>>(
  overrides?: Partial<QueueJob<T>>,
): QueueJob<T>;
export function createMockJob<T = Record<string, unknown>>(
  overrides: Partial<QueueJob<T>> | undefined,
  fields: Array<keyof QueueJob<T>>,
): Partial<QueueJob<T>>;
export function createMockJob<T = Record<string, unknown>>(
  overrides: Partial<QueueJob<T>> = {},
  fields?: Array<keyof QueueJob<T>>,
): QueueJob<T> {
  const base = {
    id: testIds.job,
    data: {} as T,
    queueName: 'flow_node' as QueueName,
    organizationId: testIds.organization,
    projectId: testIds.project,
    createdAt: new Date(),
    ...overrides,
  } as QueueJob<T>;

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Mock conversation node factory
export function createMockConversationNode(
  overrides: Partial<ConversationNode> = {},
): ConversationNode {
  const base: ConversationNode = {
    id: 'test-node',
    type: NodeType.OPENER,
    twoPhase: false,
    title: 'Test Node',
    execute: jest.fn().mockResolvedValue(createMockNodeResult()),
    action: jest.fn(),
    nextNode: 'end',
    processLlmResponse: jest
      .fn()
      .mockResolvedValue({ modifiedResult: undefined }),
    determineRouting: jest.fn().mockResolvedValue({
      modifiedResult: undefined,
      routingOverride: undefined,
    }),
    ...overrides,
  } as ConversationNode;

  return base;
}

// Database record types (what Prisma actually returns - Date objects)
export type DbConversationRecord = {
  id: ConversationId;
  createdBy: string | null;
  projectId: ProjectId;
  organizationId: OrganizationId;
  workflowId: WorkflowId;
  workflowAboutType: string;
  initiatedBy: InitiativeCreatorType;
  triggerEvent: string;
  status: ConversationStatus;
  title: string;
  workflowName: string | null;
  version: number;
  lastModifiedBy: string | null;
  initiativeId: InitiativeId | null;
  workflowAboutId: string | null;
  taskId: string | null;
  designDocId: string | null;
  createdAt: Date;
  updatedAt: Date;
  messages: MessageResponseDto[];
};

// Response DTO types (what the API returns - ISO string dates)
export type ConversationResponseRecord = {
  id: ConversationId;
  createdBy: string | null;
  projectId: ProjectId;
  organizationId: OrganizationId;
  workflowId: WorkflowId;
  workflowAboutType?: string;
  workflowAboutId?: string;
  initiativeId?: InitiativeId;
  initiatedBy: InitiativeCreatorType;
  triggerEvent: string;
  status: ConversationStatus;
  title: string;
  workflowName: WorkflowName;
  version: number;
  lastModifiedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DbProjectRecord = {
  maturity: 'TAKING_SHAPE' | 'ESTABLISHED';
  id: ProjectId;
  organizationId: OrganizationId;
  name: string;
  description: string;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  createdBy: UserId;
  config: Prisma.JsonValue | null;
};

export type DbMessageRecord = {
  id: MessageId;
  conversationId: ConversationId;
  projectId: ProjectId;
  workflowId: WorkflowId;
  type: 'USER' | 'SYSTEM';
  status: string;
  executionStatus: 'queued' | 'started' | 'cancelled' | 'failed' | null;
  executionOperationId: string | null;
  executionAdmissionId: string | null;
  executionAdmissionDisposition: 'IMMEDIATE' | 'QUEUED' | null;
  executionTurnId: string | null;
  executionRevision: number;
  executionCancellationRequested: boolean;
  userId: string;
  data: SystemMessageData | UserMessageData;
  createdAt: Date;
  contentUpdatedAt: Date;
  parentMessageId: MessageId | null;
};

// Database record factories
export function createMockDbConversation(
  overrides: Partial<DbConversationRecord> = {},
): DbConversationRecord {
  return {
    id: testIds.conversation,
    createdBy: null,
    projectId: testIds.project,
    organizationId: testIds.organization,
    workflowId: testIds.workflow,
    workflowAboutType: 'onboarding',
    workflowAboutId: null,
    initiatedBy: InitiativeCreatorType.User,
    taskId: null,
    triggerEvent: 'test_event',
    status: ConversationStatus.Started,
    title: 'Test Conversation',
    workflowName: 'onboarding',
    version: 1,
    lastModifiedBy: null,
    initiativeId: null,
    designDocId: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    messages: [] as MessageResponseDto[],
    ...overrides,
  };
}

export function createMockConversationResponse(
  overrides: Partial<ConversationResponseRecord> = {},
): ConversationResponseRecord {
  return {
    id: testIds.conversation,
    createdBy: null,
    projectId: testIds.project,
    organizationId: testIds.organization,
    workflowId: testIds.workflow,
    initiatedBy: InitiativeCreatorType.User,
    triggerEvent: 'test_event',
    status: ConversationStatus.Started,
    title: 'Test Conversation',
    workflowName: 'onboarding' as WorkflowName,
    version: 1,
    lastModifiedBy: null,
    createdAt: new Date('2024-01-01').toISOString(),
    updatedAt: new Date('2024-01-01').toISOString(),
    ...overrides,
  };
}

export function createMockDbProject(
  overrides: Partial<DbProjectRecord> = {},
): DbProjectRecord {
  return {
    maturity: 'ESTABLISHED',
    id: testIds.project,
    organizationId: testIds.organization,
    name: 'Test Project',
    description: 'Test project description',
    status: ProjectStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    createdBy: testIds.user,
    config: {
      version: 1,
      existingWorkIntent: 'unanswered',
    },
    ...overrides,
  };
}

export function createMockDbMessage(
  overrides: Partial<DbMessageRecord> = {},
): DbMessageRecord {
  const createdAt = overrides.createdAt ?? new Date();
  return {
    id: testIds.message,
    conversationId: testIds.conversation,
    projectId: testIds.project,
    workflowId: testIds.workflow,
    type: 'SYSTEM',
    status: 'open',
    executionStatus: null,
    executionOperationId: null,
    executionAdmissionId: null,
    executionAdmissionDisposition: null,
    executionTurnId: null,
    executionRevision: 0,
    executionCancellationRequested: false,
    userId: 'system',
    data: {
      type: 'QUESTIONS',
      response: 'Test message',
      detectedIntent: 'test_intent',
      intentConfidence: 0.9,
      uiElements: [],
      actions: [],
    },
    createdAt,
    contentUpdatedAt: createdAt,
    parentMessageId: null,
    ...overrides,
  };
}

// Enhanced Prisma service mock with proper types
export const createMockPrismaServiceWithTypes = () => {
  const mockDb = {
    $transaction: jest.fn<Promise<unknown>, [(tx: any) => Promise<unknown>]>(),
    conversation: {
      create: jest.fn<Promise<DbConversationRecord>, [unknown]>(),
      findMany: jest.fn<Promise<DbConversationRecord[]>, [unknown?]>(),
      findFirst: jest.fn<Promise<DbConversationRecord | null>, [unknown?]>(),
      findUnique: jest.fn<Promise<DbConversationRecord | null>, [unknown]>(),
      update: jest.fn<Promise<DbConversationRecord>, [unknown]>(),
      delete: jest.fn<Promise<DbConversationRecord>, [unknown]>(),
      count: jest.fn<Promise<number>, [unknown?]>(),
    },
    project: {
      create: jest.fn<Promise<DbProjectRecord>, [unknown]>(),
      findMany: jest.fn<Promise<DbProjectRecord[]>, [unknown?]>(),
      findFirst: jest.fn<Promise<DbProjectRecord | null>, [unknown?]>(),
      findUnique: jest.fn<Promise<DbProjectRecord | null>, [unknown]>(),
      update: jest.fn<Promise<DbProjectRecord>, [unknown]>(),
      delete: jest.fn<Promise<DbProjectRecord>, [unknown]>(),
    },
    message: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    pendingOpenTrigger: {
      deleteMany: jest.fn(),
    },
    initiative: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    projectInitiative: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    analyticsEventBatch: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    analyticsEvent: {
      createMany: jest.fn(),
      findUnique: jest.fn(),
    },
    entityRegistry: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      createMany: jest.fn(),
      updateMany: jest.fn(),
    },
    artifact: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    tag: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    entityStar: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    organization: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    organizationMember: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    projectMember: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    goalMembership: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    outboxEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    interactionFlow: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    interactionStep: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    uiFlow: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    agentSession: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    service: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    task: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      groupBy: jest.fn(),
      count: jest.fn(),
    },
    designDoc: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    plan: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    planExecutionGuidance: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      upsert: jest.fn(),
    },
    planStage: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    planStep: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    planStepRelation: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    planVersion: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn(),
    },
    planRelationship: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    planSignOff: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
  };

  mockDb.$transaction.mockImplementation(
    async (cb: (db: typeof mockDb) => Promise<unknown>) => cb(mockDb),
  );

  return {
    db: mockDb,
    $transaction: jest.fn(async (cb: (db: typeof mockDb) => Promise<unknown>) =>
      cb(mockDb),
    ),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  } as unknown as jest.Mocked<PrismaService>;
};

// Mock LLM Complete Event factory
export function createMockLlmCompleteEvent(
  overrides?: RecursivePartial<LlmCompleteEvent>,
): LlmCompleteEvent;
export function createMockLlmCompleteEvent(
  overrides: RecursivePartial<LlmCompleteEvent> | undefined,
  fields: Array<keyof LlmCompleteEvent>,
): RecursivePartial<LlmCompleteEvent>;
export function createMockLlmCompleteEvent(
  overrides: RecursivePartial<LlmCompleteEvent> = {},
  fields?: Array<keyof LlmCompleteEvent>,
): LlmCompleteEvent {
  const payload = {
    requestId: testIds.request,
    messageId: testIds.message,
    organizationId: testIds.organization,
    projectId: testIds.project,
    conversationId: testIds.conversation,
    status: 'success',
    flowConfig: {
      nodeId: 'node-id',
      jobId: testIds.job,
      context: createMockFlowContext(),
      nodeType: NodeType.LLM_QUESTIONS,
    },
    systemMessageData: {
      type: 'ANALYSIS',
      response: 'Test LLM response',
      detectedIntent: 'test_intent',
      intentConfidence: 0.9,
      uiElements: [],
      actions: [],
    },
    error: undefined,
    ...overrides?.payload,
  } as LlmCompleteEvent['payload'];
  const base = {
    id: 'test-event-123',
    type: 'llm.complete',
    aggregateId: testIds.request,
    payload,
    ...overrides,
  } as LlmCompleteEvent;

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Workflow state mock factories
export function createMockWorkflowState(
  overrides?: Partial<WorkflowState>,
): WorkflowState;
export function createMockWorkflowState(
  overrides: Partial<WorkflowState> | undefined,
  fields: Array<keyof WorkflowState>,
): Partial<WorkflowState>;
export function createMockWorkflowState(
  overrides: Partial<WorkflowState> = {},
  fields?: Array<keyof WorkflowState>,
): WorkflowState {
  const base: WorkflowState = {
    step: WorkflowStep.INITIALIZING,
    workflowId: testIds.workflow,
    projectId: testIds.project,
    organizationId: testIds.organization,
    flowId: testIds.flowId as WorkflowName,
    executionId: testIds.flowExecution,
    conversationId: testIds.conversation,
    workflowAboutId: '',
    workflowAboutType: '',
    userId: testIds.user,
    currentNodeId: testIds.nodeId,
    nodeConfig: createMockNodeConfiguration(),
    phase: WorkflowPhase.EXECUTING,
    context: createMockFlowContext(),
    isComplete: false,
    hasOpener: false,
    iterations: 0,
    maxIterations: 20,
    initiatedBy: 'USER',
    triggerEvent: 'test_trigger',
    title: 'Test Workflow',
    workflowName: WorkflowName.Onboarding,
    userResponseTimeout: '1d',
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

export function createMockWorkflowInput(
  overrides?: Partial<WorkflowInput>,
): WorkflowInput;
export function createMockWorkflowInput(
  overrides: Partial<WorkflowInput> | undefined,
  fields: Array<keyof WorkflowInput>,
): Partial<WorkflowInput>;
export function createMockWorkflowInput(
  overrides: Partial<WorkflowInput> = {},
  fields?: Array<keyof WorkflowInput>,
): WorkflowInput {
  const base: WorkflowInput = {
    projectId: testIds.project,
    workflowId: testIds.workflow,
    organizationId: testIds.organization,
    flowId: testIds.flowId as WorkflowName,
    userId: testIds.user,
    conversationId: testIds.conversation,
    initiatedBy: 'USER',
    triggerEvent: 'test_trigger',
    title: 'Test Workflow',
    workflowName: WorkflowName.Onboarding,
    userResponseTimeout: '1d',
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

export function createMockNodeConfiguration(
  overrides?: Partial<NodeConfiguration>,
): NodeConfiguration;
export function createMockNodeConfiguration(
  overrides: Partial<NodeConfiguration> | undefined,
  fields: Array<keyof NodeConfiguration>,
): Partial<NodeConfiguration>;
export function createMockNodeConfiguration(
  overrides: Partial<NodeConfiguration> = {},
  fields?: Array<keyof NodeConfiguration>,
): NodeConfiguration {
  const base: NodeConfiguration = {
    id: testIds.nodeId,
    type: 'LLM_QUESTIONS', // Default node type for tests
    supportsPhases: false,
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

export function createMockLLMResponsePayload(
  overrides?: Partial<LLMResponsePayload>,
): LLMResponsePayload;
export function createMockLLMResponsePayload(
  overrides: Partial<LLMResponsePayload> | undefined,
  fields: Array<keyof LLMResponsePayload>,
): Partial<LLMResponsePayload>;
export function createMockLLMResponsePayload(
  overrides: Partial<LLMResponsePayload> = {},
  fields?: Array<keyof LLMResponsePayload>,
): LLMResponsePayload {
  const base: LLMResponsePayload = {
    requestId: testIds.request,
    contextUpdates: [],
    responseData: {
      type: 'QUESTIONS',
      response: 'Test LLM response',
      detectedIntent: 'test_intent',
      intentConfidence: 0.9,
      uiElements: [],
      actions: [],
    },
    nextNodeId: 'next-node-id',
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

export function createMockStepTransitionResult(
  overrides?: Partial<StepTransitionResult>,
): StepTransitionResult;
export function createMockStepTransitionResult(
  overrides: Partial<StepTransitionResult> | undefined,
  fields: Array<keyof StepTransitionResult>,
): Partial<StepTransitionResult>;
export function createMockStepTransitionResult(
  overrides: Partial<StepTransitionResult> = {},
  fields?: Array<keyof StepTransitionResult>,
): StepTransitionResult {
  const base: StepTransitionResult = {
    nextStep: WorkflowStep.WAITING_FOR_USER_INPUT,
    shouldContinue: true,
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Agent Execution Result Payload mock factory
export function createMockAgentExecutionResultPayload(
  overrides?: Partial<AgentExecutionResultPayload>,
  fields?: Array<keyof AgentExecutionResultPayload>,
): Partial<AgentExecutionResultPayload>;
export function createMockAgentExecutionResultPayload(
  overrides: Partial<AgentExecutionResultPayload> = {},
  fields?: Array<keyof AgentExecutionResultPayload>,
): AgentExecutionResultPayload {
  const base: AgentExecutionResultPayload = {
    agentId: 'test-agent-id',
    executionId: 'test-execution-id',
    initiativeId: testIds.initiative,
    status: 'completed',
    result: {
      text: 'Test agent execution completed successfully',
      changes: [
        {
          type: 'initiative_update',
          field: 'description',
          oldValue: 'old description',
          newValue: 'updated description',
          reasoning: 'Updated based on analysis',
        },
      ],
      confidence: 0.85,
      reasoning: 'Analysis completed with high confidence',
    },
    organizationId: testIds.organization,
    projectId: testIds.project,
    conversationId: testIds.conversation,
    timestamp: new Date(),
    metadata: {
      executionDuration: 5000,
      tokensUsed: 150,
    },
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Workflow test ID constants
export const testWorkflowIds = {
  systemDriven: 'test-workflow-system-driven' as WorkflowId,
  userDriven: 'test-workflow-user-driven' as WorkflowId,
  gatherNode: 'test-workflow-gather-node' as WorkflowId,
  autoNode: 'test-workflow-auto-node' as WorkflowId,
} as const;

export const testNodeIds = {
  opener: 'test-opener-node',
  gather: 'test-gather-node',
  auto: 'test-auto-node',
  agent: 'test-agent-node',
  completion: 'test-completion-node',
  end: 'end',
} as const;

// Date utilities for testing
export const createTestDates = {
  now: () => new Date(),
  pastDay: (days = 1) => new Date(Date.now() - days * 24 * 60 * 60 * 1000),
  futureDay: (days = 1) => new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  isoString: (date = new Date()) => date.toISOString(),
};

// Initiative-specific service mocks
export const createMockInitiativeLifecycleService = () =>
  ({
    generateFromOnboardingFlow: jest.fn(),
    findConversationForInitiative: jest.fn(),
    createRefinementConversation: jest.fn(),
    getInitiativesFromConversation: jest.fn(),
    getInitiativeCreationConversation: jest.fn(),
    getActiveRefinementConversation: jest.fn(),
  }) as jest.Mocked<{
    generateFromOnboardingFlow: (
      flowContext: any,
      organizationId: OrganizationId,
    ) => Promise<any>;
    findConversationForInitiative: (
      initiativeId: InitiativeId,
    ) => Promise<ConversationResponseDto | null>;
    createRefinementConversation: (
      initiativeId: InitiativeId,
    ) => Promise<ConversationResponseDto>;
    getInitiativesFromConversation: (
      conversation: { id: ConversationId; projectId: ProjectId },
      organizationId: OrganizationId,
    ) => Promise<InitiativeDraft[]>;
    getInitiativeCreationConversation: (
      projectId: ProjectId,
    ) => Promise<ConversationResponseDto | null>;
    getActiveRefinementConversation: (
      initiativeId: InitiativeId,
    ) => Promise<ConversationId | null>;
  }>;

export const createMockInitiativeInteractionService = () =>
  ({
    processUserMessage: jest.fn(),
    refineInitiativeByMessage: jest.fn(),
    processProgressiveDisclosure: jest.fn(),
    getLevelProgressionSuggestions: jest.fn(),
    markInitiativeAsReviewed: jest.fn(),
    getInitiativeFromConversation: jest.fn(),
    refineInitiativeByContentUpdate: jest.fn(),
  }) as jest.Mocked<{
    processUserMessage: (userMessage: string, context: any) => Promise<any>;
    refineInitiativeByMessage: (
      conversationId: ConversationId,
      organizationId: OrganizationId,
      request: any,
    ) => Promise<any>;
    processProgressiveDisclosure: (request: any) => Promise<any>;
    getLevelProgressionSuggestions: (
      initiativeId: InitiativeId,
    ) => Promise<any>;
    markInitiativeAsReviewed: (
      conversationId: ConversationId,
      organizationId: OrganizationId,
      initiativeId: string,
      approved: boolean,
    ) => Promise<any>;
    getInitiativeFromConversation: (
      conversationId: ConversationId,
      organizationId: OrganizationId,
      initiativeId: string,
    ) => Promise<InitiativeDraft | null>;
    refineInitiativeByContentUpdate: (
      conversationId: ConversationId,
      organizationId: OrganizationId,
      request: any,
    ) => Promise<any>;
  }>;

export const createMockInitiativeRefinementWorkflowService = () => {
  const mockService = {
    sendAgentExecutionResult: jest.fn(),
    getWorkflowInfo: jest.fn(),
    isWorkflowRunning: jest.fn(),
    sendUserMessage: jest.fn(),
    sendSkipToNode: jest.fn(),
    logger: {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    },
    temporalClient: {} as any,
  };
  return mockService as any;
};

export const createMockInitiativeIntelligenceService = () =>
  ({
    generateInitiatives: jest.fn(),
    refineInitiative: jest.fn(),
    sanitizeUserFeedback: jest.fn(),
  }) as jest.Mocked<{
    generateInitiatives: (context: any) => Promise<any>;
    refineInitiative: (request: any) => Promise<any>;
    sanitizeUserFeedback: (rawFeedback: string) => any;
  }>;

// ==================================================
// LEVEL-AWARE MOCK FACTORIES (Phase 1 Enhancement)
// ==================================================

/**
 * Level-aware initiative mock factory
 * Creates initiatives with status matching the specified refinement level
 */
export function createMockInitiativeWithLevel(
  level: 'description' | 'details' | 'acceptanceCriteria',
  overrides?: Partial<InitiativeResponseDto>,
): InitiativeResponseDto;
export function createMockInitiativeWithLevel(
  level: 'description' | 'details' | 'acceptanceCriteria',
  overrides: Partial<InitiativeResponseDto> | undefined,
  fields: Array<keyof InitiativeResponseDto>,
): Partial<InitiativeResponseDto>;
export function createMockInitiativeWithLevel(
  level: 'description' | 'details' | 'acceptanceCriteria',
  overrides: Partial<InitiativeResponseDto> = {},
  fields?: Array<keyof InitiativeResponseDto>,
): InitiativeResponseDto {
  const statusMap = {
    description: WorkStatus.RefiningDescription,
    details: WorkStatus.RefiningDetails,
    acceptanceCriteria: WorkStatus.RefiningAcceptanceCriteria,
  };

  const base = createMockInitiative({
    status: statusMap[level],
    ...overrides,
  });

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

/**
 * Classification result mock factory
 * Creates message classification results for level-aware testing
 */
export interface ClassificationResult {
  intent: 'approve_level' | 'edit_content' | 'finalize' | 'general_response';
  confidence: number;
  level?: string;
  reasoning: string;
  suggestedActions: string[];
  timestamp: string;
  model: string;
}

export function createMockClassificationResult(
  intent: 'approve_level' | 'edit_content' | 'finalize' | 'general_response',
  confidence: number = 0.85,
  level?: string,
  overrides: Partial<ClassificationResult> = {},
): ClassificationResult {
  return {
    intent,
    confidence,
    level,
    reasoning: `Mock classification: ${intent} with confidence ${confidence}${level ? ` at ${level} level` : ''}`,
    suggestedActions: getSuggestedActionsForIntent(intent),
    timestamp: new Date().toISOString(),
    model: 'claude-4-haiku',
    ...overrides,
  };
}

/**
 * Level-aware response mock factory
 * Creates progress-aware response data for UI consumption
 */
export interface LevelAwareResponse {
  currentLevel: 'description' | 'details' | 'acceptanceCriteria';
  nextLevel?: 'description' | 'details' | 'acceptanceCriteria';
  progressInfo: {
    currentLevel: string;
    nextLevel?: string;
    progress: number;
    totalLevels: number;
    levelIndex: number;
  };
  recommendedActions: string[];
  canApprove: boolean;
  canFinalize: boolean;
  statusDescription: string;
}

export function createMockLevelAwareResponse(
  currentLevel: 'description' | 'details' | 'acceptanceCriteria',
  nextLevel?: 'description' | 'details' | 'acceptanceCriteria',
  progressInfo: Partial<LevelAwareResponse['progressInfo']> = {},
  overrides: Partial<LevelAwareResponse> = {},
): LevelAwareResponse {
  const progressMap = {
    description: 0.33,
    details: 0.66,
    acceptanceCriteria: 0.99,
  };

  return {
    currentLevel,
    nextLevel,
    progressInfo: {
      currentLevel,
      nextLevel,
      progress: progressMap[currentLevel],
      totalLevels: 3,
      levelIndex:
        currentLevel === 'description' ? 0 : currentLevel === 'details' ? 1 : 2,
      ...progressInfo,
    },
    recommendedActions: [`Continue refining ${currentLevel} level`],
    canApprove: true,
    canFinalize: currentLevel === 'acceptanceCriteria',
    statusDescription: getStatusDescriptionForLevel(currentLevel),
    ...overrides,
  };
}

/**
 * Enhanced MessageClassificationService mock with level-aware methods
 */
export interface ClassificationTemplate {
  systemPrompt: string;
  examples: string[];
}

export const createMockMessageClassificationServiceEnhanced = () => {
  const mockService = {
    classifyMessage: jest.fn(),
    classifyMessageWithLevel: jest.fn(),
    shouldRouteMessage: jest.fn(),
    getDescriptionLevelTemplate: jest.fn().mockReturnValue({
      systemPrompt: 'Classify user message for description-level refinement...',
      examples: ['approve description', 'change scope', 'what does this mean?'],
    } as ClassificationTemplate),
    getDetailsLevelTemplate: jest.fn().mockReturnValue({
      systemPrompt: 'Classify user message for details-level refinement...',
      examples: [
        'technical approach good',
        'use different technology',
        'how to implement?',
      ],
    } as ClassificationTemplate),
    getAcceptanceCriteriaLevelTemplate: jest.fn().mockReturnValue({
      systemPrompt:
        'Classify user message for acceptance-criteria-level refinement...',
      examples: ['finalize this', 'add validation test', 'how to verify?'],
    } as ClassificationTemplate),
  };

  return mockService as jest.Mocked<{
    classifyMessage: (
      message: unknown,
      context: unknown,
    ) => Promise<ClassificationResult>;
    classifyMessageWithLevel: (
      message: unknown,
      context: unknown,
      level: string,
    ) => Promise<ClassificationResult>;
    shouldRouteMessage: (message: unknown) => Promise<boolean>;
    getDescriptionLevelTemplate: () => ClassificationTemplate;
    getDetailsLevelTemplate: () => ClassificationTemplate;
    getAcceptanceCriteriaLevelTemplate: () => ClassificationTemplate;
  }>;
};

/**
 * Initiative refinement context mock factory
 * Creates workflow context for initiative refinement flows
 */
export interface InitiativeRefinementContext {
  initiativeId: string;
  currentLevel: 'description' | 'details' | 'acceptanceCriteria';
  organizationId: OrganizationId;
  projectId: ProjectId;
  conversationId: ConversationId;
  workflowId: WorkflowId;
  gatheredData: {
    userFeedback: unknown[];
    systemSuggestions: unknown[];
    approvalHistory: unknown[];
    contentChanges: unknown[];
  };
  progressInfo: LevelAwareResponse | null;
  metadata: {
    createdAt: string;
    lastUpdated: string;
    refinementStarted: string;
  };
}

export function createMockInitiativeRefinementContext(
  initiativeId: string,
  currentLevel?: 'description' | 'details' | 'acceptanceCriteria',
  overrides: Partial<InitiativeRefinementContext> = {},
): InitiativeRefinementContext {
  return {
    initiativeId,
    currentLevel: currentLevel || 'description',
    organizationId: testIds.organization,
    projectId: testIds.project,
    conversationId: testIds.conversation,
    workflowId: testIds.workflow,
    gatheredData: {
      userFeedback: [],
      systemSuggestions: [],
      approvalHistory: [],
      contentChanges: [],
    },
    progressInfo: currentLevel
      ? createMockLevelAwareResponse(currentLevel)
      : null,
    metadata: {
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      refinementStarted: new Date().toISOString(),
    },
    ...overrides,
  };
}

/**
 * Signal debouncing service mock factory
 * Mocks the debouncing behavior for content updates
 */
export const createMockSignalDebouncingService = () =>
  ({
    getDebounceTimeout: jest.fn().mockReturnValue(1000),
    isDebouncePending: jest.fn().mockReturnValue(false),
    debounceContentUpdate: jest.fn().mockResolvedValue(undefined),
    clearDebounce: jest.fn(),
    getDebounceStatus: jest
      .fn()
      .mockReturnValue({ pending: false, timeoutMs: 1000 }),
  }) as jest.Mocked<{
    getDebounceTimeout: (key: string) => number;
    isDebouncePending: (key: string) => boolean;
    debounceContentUpdate: (
      key: string,
      callback: () => Promise<void>,
    ) => Promise<void>;
    clearDebounce: (key: string) => void;
    getDebounceStatus: (key: string) => { pending: boolean; timeoutMs: number };
  }>;

/**
 * Workflow service mock factory for initiative workflows
 */
export const createMockWorkflowService = () =>
  ({
    startWorkflow: jest.fn(),
    sendSignal: jest.fn(),
    isWorkflowRunning: jest.fn().mockResolvedValue(true),
    getWorkflowStatus: jest.fn().mockResolvedValue({ status: 'running' }),
    sendInitiativeRefinementFeedback: jest.fn(),
    sendInitiativeContentUpdate: jest.fn(),
    sendInitiativeReview: jest.fn(),
  }) as jest.Mocked<{
    startWorkflow: (workflowId: WorkflowId, input: unknown) => Promise<void>;
    sendSignal: (
      workflowId: WorkflowId,
      signal: string,
      data: unknown,
    ) => Promise<void>;
    isWorkflowRunning: (workflowId: WorkflowId) => Promise<boolean>;
    getWorkflowStatus: (workflowId: WorkflowId) => Promise<{ status: string }>;
    sendInitiativeRefinementFeedback: (
      workflowId: WorkflowId,
      feedback: unknown,
    ) => Promise<void>;
    sendInitiativeContentUpdate: (
      workflowId: WorkflowId,
      update: unknown,
    ) => Promise<void>;
    sendInitiativeReview: (
      workflowId: WorkflowId,
      review: unknown,
    ) => Promise<void>;
  }>;

// ==================================================
// LEVEL-AWARE TEST DATA SETS
// ==================================================

/**
 * Pre-configured level-aware initiatives for testing
 */
export const levelAwareTestInitiatives = {
  description: createMockInitiativeWithLevel('description', {
    name: 'Test Description Initiative',
    sections: createMockMaterializedWorkItemSections({
      description: 'Initiative at description level',
    }),
  }),
  details: createMockInitiativeWithLevel('details', {
    name: 'Test Details Initiative',
    sections: createMockMaterializedWorkItemSections({
      description: 'Initiative at details level',
    }),
  }),
  acceptanceCriteria: createMockInitiativeWithLevel('acceptanceCriteria', {
    name: 'Test Acceptance Criteria Initiative',
    sections: createMockMaterializedWorkItemSections({
      description: 'Initiative at acceptance criteria level',
    }),
  }),
};

/**
 * Test classification scenarios organized by level and intent
 */
export interface ClassificationScenario {
  message: string;
  intent: 'approve_level' | 'edit_content' | 'finalize' | 'general_response';
  confidence: number;
}

export const testClassificationScenarios: {
  description: ClassificationScenario[];
  details: ClassificationScenario[];
  acceptanceCriteria: ClassificationScenario[];
} = {
  description: [
    {
      message: 'This description looks good to me',
      intent: 'approve_level',
      confidence: 0.9,
    },
    {
      message: 'Can we change the scope to include mobile apps?',
      intent: 'edit_content',
      confidence: 0.85,
    },
    {
      message: 'What does "user authentication" mean in this context?',
      intent: 'general_response',
      confidence: 0.7,
    },
    {
      message: "I approve this description, let's move forward",
      intent: 'approve_level',
      confidence: 0.95,
    },
  ],
  details: [
    {
      message: 'The technical approach is solid',
      intent: 'approve_level',
      confidence: 0.88,
    },
    {
      message: "Let's use PostgreSQL instead of MySQL",
      intent: 'edit_content',
      confidence: 0.9,
    },
    {
      message: 'How will we handle database migrations?',
      intent: 'general_response',
      confidence: 0.75,
    },
    {
      message: 'I agree with the implementation plan',
      intent: 'approve_level',
      confidence: 0.85,
    },
  ],
  acceptanceCriteria: [
    {
      message: "Perfect, let's finalize this initiative",
      intent: 'finalize',
      confidence: 0.95,
    },
    {
      message: 'Add a test for password strength validation',
      intent: 'edit_content',
      confidence: 0.88,
    },
    {
      message: 'How do we validate the authentication flow?',
      intent: 'general_response',
      confidence: 0.72,
    },
    {
      message: 'This is ready for implementation',
      intent: 'finalize',
      confidence: 0.9,
    },
  ],
};

// ==================================================
// HELPER FUNCTIONS FOR MOCK FACTORIES
// ==================================================

/**
 * Helper to get suggested actions based on intent
 */
function getSuggestedActionsForIntent(intent: string): string[] {
  const actionMap: Record<string, string[]> = {
    approve_level: [
      'Advance to next refinement level',
      'Update initiative status',
    ],
    edit_content: ['Apply content changes', 'Update initiative data'],
    finalize: ['Complete refinement process', 'Mark as active'],
    general_response: ['Provide clarification', 'Continue conversation'],
  };
  return actionMap[intent] || ['Process user input'];
}

/**
 * Helper to get status description for level
 */
function getStatusDescriptionForLevel(level: string): string {
  const descriptionMap: Record<string, string> = {
    description: 'Refining high-level description and scope',
    details: 'Working on technical details and implementation',
    acceptanceCriteria:
      'Defining acceptance criteria and validation requirements',
  };
  return descriptionMap[level] || `Refining at ${level} level`;
}

/**
 * Helper to get next level in progression
 */
function _getNextLevel(currentLevel: string): string | undefined {
  const levelMap: Record<string, string | undefined> = {
    description: 'details',
    details: 'acceptanceCriteria',
    acceptanceCriteria: undefined, // final level
  };
  return levelMap[currentLevel];
}

/**
 * Helper to get progress percentage for level
 */
function _getProgressForLevel(level: string): number {
  const progressMap: Record<string, number> = {
    description: 0.33,
    details: 0.66,
    acceptanceCriteria: 0.99,
  };
  return progressMap[level] || 0;
}

// Additional service mock factories for FlowNodeProcessor

export const createMockPromptBuilderService = () =>
  ({
    buildPrompt: jest.fn().mockReturnValue({
      systemPrompt: 'Test system prompt',
      userPrompt: 'Test user prompt',
      combinedPrompt: 'Combined test prompt',
    }),
  }) as jest.Mocked<{
    buildPrompt: (config: unknown) => {
      systemPrompt: string;
      userPrompt: string;
      combinedPrompt: string;
    };
  }>;

export const createMockFlowNodeErrorRecoveryService = () =>
  ({
    handleError: jest.fn().mockResolvedValue(undefined),
    handleErrorRecovery: jest.fn().mockResolvedValue({
      action: 'retry',
      delayMs: 1000,
      shouldContinue: true,
    }),
    classifyError: jest.fn().mockReturnValue({
      type: 'retryable',
      shouldRetry: true,
      retryAfter: 1000,
    }),
    shouldRetry: jest.fn().mockReturnValue(true),
    getRetryDelay: jest.fn().mockReturnValue(1000),
    resetErrorRecoveryState: jest.fn().mockResolvedValue(undefined),
    getCircuitBreakerKey: jest
      .fn()
      .mockImplementation((type: string, orgId: string) => `${type}_${orgId}`),
    isCircuitOpen: jest.fn().mockReturnValue(false),
    recordCircuitBreakerSuccess: jest.fn(),
    recordCircuitBreakerFailure: jest.fn(),
  }) as jest.Mocked<{
    handleError: (error: Error, context: unknown) => Promise<void>;
    handleErrorRecovery: (
      nodeId: string,
      organizationId: string,
      error: Error,
      context: string,
      config?: unknown,
    ) => Promise<{
      action: string;
      delayMs: number;
      shouldContinue: boolean;
    }>;
    classifyError: (error: Error) => {
      type: string;
      shouldRetry: boolean;
      retryAfter: number;
    };
    shouldRetry: (error: Error) => boolean;
    getRetryDelay: (attempt: number) => number;
    resetErrorRecoveryState: (
      nodeId: string,
      organizationId: string,
    ) => Promise<void>;
    getCircuitBreakerKey: (type: string, orgId: string) => string;
    isCircuitOpen: (key: string) => boolean;
    recordCircuitBreakerSuccess: (key: string) => void;
    recordCircuitBreakerFailure: (key: string) => void;
  }>;

export const createMockTagService = () =>
  ({
    create: jest.fn(),
    findByEntity: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    addTagsToEntity: jest.fn(),
    removeTagsFromEntity: jest.fn(),
    getTagsByEntity: jest.fn(),
    addTagsToInitiative: jest.fn(),
  }) as jest.Mocked<{
    create: (dto: CreateTagDto) => Promise<unknown>;
    findByEntity: (entityId: string, entityType: string) => Promise<unknown[]>;
    findAll: (organizationId: string) => Promise<unknown[]>;
    update: (id: string, updates: Partial<CreateTagDto>) => Promise<unknown>;
    delete: (id: string) => Promise<void>;
    addTagsToEntity: (
      entityId: string,
      entityType: string,
      tags: string[],
    ) => Promise<void>;
    removeTagsFromEntity: (
      entityId: string,
      entityType: string,
      tags: string[],
    ) => Promise<void>;
    getTagsByEntity: (
      entityId: string,
      entityType: string,
    ) => Promise<unknown[]>;
    addTagsToInitiative: (
      initiativeId: string,
      organizationId: string,
      tags?: string[],
    ) => Promise<void>;
  }>;

export const createMockAgentSessionService = () =>
  ({
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  }) as jest.Mocked<{
    create: (...args: unknown[]) => Promise<unknown>;
    findAll: (...args: unknown[]) => Promise<unknown>;
    findOne: (...args: unknown[]) => Promise<unknown>;
    update: (...args: unknown[]) => Promise<unknown>;
    remove: (...args: unknown[]) => Promise<unknown>;
  }>;

export const createMockInitiativeArtifactService = () =>
  ({
    storeOriginalGeneration: jest.fn(),
    getOriginalGenerationArtifacts: jest.fn(),
    getOriginalArtifactForInitiative: jest.fn(),
    updateOriginalArtifactFields: jest.fn(),
    getBulkOriginalArtifacts: jest.fn(),
    storeLevelRefinement: jest.fn(),
    getRefinementHistory: jest.fn(),
    extractOriginalData: jest.fn(),
    extractInitiativeId: jest.fn(),
  }) as unknown as jest.Mocked<{
    storeOriginalGeneration: (
      initiatives: unknown[],
      realInitiatives: Array<{ id: string }>,
      organizationId: string,
      projectId: string,
      generationContext?: unknown,
    ) => Promise<unknown[]>;
    getOriginalGenerationArtifacts: (
      initiativeIds: string[],
      organizationId: string,
    ) => Promise<unknown[]>;
    getOriginalArtifactForInitiative: (
      initiativeId: string,
      organizationId: string,
    ) => Promise<unknown | null>;
    updateOriginalArtifactFields: (
      initiativeId: string,
      organizationId: string,
      updates: Partial<
        Record<'description' | 'details' | 'acceptanceCriteria', string>
      >,
    ) => Promise<void>;
    getBulkOriginalArtifacts: (
      initiativeIds: string[],
      organizationId: string,
    ) => Promise<Map<string, unknown>>;
    storeLevelRefinement: (
      initiativeId: string,
      organizationId: string,
      level: string,
      refinementData: unknown,
    ) => Promise<unknown>;
    getRefinementHistory: (
      initiativeId: string,
      organizationId: string,
    ) => Promise<unknown[]>;
    extractOriginalData: (artifact: unknown) => unknown | null;
    extractInitiativeId: (artifact: unknown) => string | null;
  }>;

// API Key Service Mock
export const createMockApiKeyService = () =>
  (() => {
    const createOrganizationApiKey = jest.fn();
    return {
      createMastraApiKey: createOrganizationApiKey,
      createOrganizationApiKey,
      getOrganizationApiKey: jest.fn(),
      getApiKey: jest.fn(),
      hasMastraApiKey: jest.fn(),
      validateApiKey: jest.fn(),
      findById: jest.fn(),
      findByOrganizationId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      list: jest.fn(),
      invalidateOrganizationApiKey: jest.fn(),
      clearOrganizationApiKeyCache: jest.fn(),
    };
  })() as jest.Mocked<{
    createMastraApiKey: (
      organizationId: string,
      createdBy: string,
    ) => Promise<any>;
    createOrganizationApiKey: (
      organizationId: string,
      createdBy: string,
    ) => Promise<any>;
    getOrganizationApiKey: (organizationId: string) => Promise<string | null>;
    getApiKey: (organizationId: string) => Promise<string | null>;
    hasMastraApiKey: (organizationId: string) => Promise<boolean>;
    validateApiKey: (apiKey: string, clientIp: string) => Promise<any>;
    findById: (id: string) => Promise<any>;
    findByOrganizationId: (organizationId: string) => Promise<any[]>;
    create: (data: any) => Promise<any>;
    update: (id: string, data: any) => Promise<any>;
    delete: (id: string) => Promise<void>;
    list: (organizationId: string) => Promise<any[]>;
    invalidateOrganizationApiKey: (organizationId: string) => void;
    clearOrganizationApiKeyCache: () => void;
  }>;

// Organization Service Mocks
export const createMockOrganizationService = () =>
  ({
    create: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    list: jest.fn(),
    addMember: jest.fn(),
    removeMember: jest.fn(),
    updateMemberRole: jest.fn(),
  }) as jest.Mocked<{
    create: (data: any) => Promise<any>;
    findById: (id: string) => Promise<any>;
    update: (id: string, data: any) => Promise<any>;
    delete: (id: string) => Promise<void>;
    list: () => Promise<any[]>;
    addMember: (orgId: string, userId: string, role: string) => Promise<any>;
    removeMember: (orgId: string, userId: string) => Promise<void>;
    updateMemberRole: (
      orgId: string,
      userId: string,
      role: string,
    ) => Promise<any>;
  }>;

// Security Logger Service Mock
export const createMockSecurityLoggerService = () =>
  ({
    logApiKeyUsage: jest.fn(),
    logAuthFailure: jest.fn(),
    logSecurityEvent: jest.fn(),
  }) as jest.Mocked<{
    logApiKeyUsage: (data: any) => void;
    logAuthFailure: (data: any) => void;
    logSecurityEvent: (data: any) => void;
  }>;

// ConversationWorkflowService Mock
export const createMockConversationWorkflowService = () =>
  ({
    createConversation: jest.fn(),
    startConversationWorkflow: jest.fn(),
    startWorkflowForExistingConversation: jest.fn(),
    getSupportedWorkflowTypes: jest.fn(),
    getWorkflowTypeInfo: jest.fn(),
    getAllSupportedWorkflowConfigs: jest.fn(),
  }) as jest.Mocked<{
    createConversation: (
      createDto: any,
      organizationId: any,
      options?: any,
    ) => Promise<{
      conversation: any;
      workflowStarted: boolean;
      workflowId?: string;
      workflowError?: string;
    }>;
    startConversationWorkflow: (
      conversationId: any,
      organizationId: any,
      additionalContext?: Record<string, unknown>,
    ) => Promise<{
      conversation: any;
      workflowStarted: boolean;
      workflowId?: string;
      workflowError?: string;
    }>;
    startWorkflowForExistingConversation: (
      conversationId: any,
      workflowType: string,
      organizationId: any,
    ) => Promise<{ workflowId: string; conversationId: any; success: boolean }>;
    getSupportedWorkflowTypes: () => string[];
    getWorkflowTypeInfo: (workflowType: string) => any | null;
    getAllSupportedWorkflowConfigs: () => any[];
  }>;

// WorkflowTypeRegistryService Mock
export const createMockWorkflowTypeRegistryService = () =>
  ({
    getWorkflowConfig: jest.fn(),
    getAllSupportedWorkflowTypes: jest.fn(),
    getSupportedWorkflowConfigs: jest.fn(),
    isWorkflowTypeSupported: jest.fn().mockReturnValue(true),
    isNonTemporalBackedWorkflow: jest.fn().mockReturnValue(false),
    shouldDeferAutostart: jest.fn().mockReturnValue(false),
    validateWorkflowType: jest.fn(),
    validateWorkflowName: jest.fn(),
    startWorkflowByType: jest.fn(),
  }) as jest.Mocked<{
    getWorkflowConfig: (workflowType: string) => any | null;
    getAllSupportedWorkflowTypes: () => string[];
    getSupportedWorkflowConfigs: () => any[];
    isWorkflowTypeSupported: (workflowType: string) => boolean;
    isNonTemporalBackedWorkflow: (workflowType?: string | null) => boolean;
    shouldDeferAutostart: (workflowType?: string | null) => boolean;
    validateWorkflowType: (workflowType: string) => string;
    validateWorkflowName: (workflowName: string) => string;
    startWorkflowByType: (
      workflowType: string,
      conversationId: any,
      projectId: any,
      organizationId: any,
      userId: any,
      title: any,
      workflowAboutType: any,
      workflowAboutId: any,
      workflowIdOverride?: any,
      additionalContext?: Record<string, unknown>,
    ) => Promise<{ workflowId: string; conversationId: any; success: boolean }>;
  }>;

// ==================================================
// API KEY TESTING UTILITIES (Phase 1)
// ==================================================

import * as crypto from 'crypto';
import type { MastraClientService } from '../services/agents/mastra-client.service';
import type { ApiKeyService } from '../services/api-key.service';

// API Key Response DTO Types
export interface ApiKeyResponseDto {
  id: string;
  organizationId: OrganizationId;
  keyType: string;
  serviceType?: string;
  prefix: string;
  scopes: string[];
  isActive: boolean;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date;
  lastUsedIp?: string;
  createdBy: UserId;
  name: string;
  description?: string;
}

export interface ApiKeyWithSecret {
  id: string;
  key: string; // Only returned on creation
  prefix: string;
  name: string;
  description?: string;
  keyType: string;
  serviceType?: string;
  scopes: string[];
  expiresAt?: Date;
  createdAt: Date;
  isActive: boolean;
}

export interface ValidatedApiKey {
  id: string;
  organizationId: OrganizationId;
  keyType: string;
  serviceType?: string;
  scopes: string[];
  name: string;
  createdBy: UserId;
}

// API Key Mock Factories
export function createMockApiKey(
  overrides: Partial<ApiKeyResponseDto> = {},
  fields?: Array<keyof ApiKeyResponseDto>,
): Partial<ApiKeyResponseDto> {
  const mockApiKey: ApiKeyResponseDto = {
    id: testIds.apiKey,
    organizationId: testIds.organization,
    keyType: 'MASTRA_AI',
    serviceType: 'agent-service',
    prefix: 'hh_test_abcd',
    scopes: ['agent:execute', 'callback:results'],
    isActive: true,
    expiresAt: new Date(Date.now() + 86400000), // 24 hours
    createdAt: new Date(),
    updatedAt: new Date(),
    lastUsedAt: undefined,
    lastUsedIp: undefined,
    createdBy: testIds.user,
    name: 'Test Mastra API Key',
    description: 'Test API key for unit tests',
    ...overrides,
  };

  return fields ? pickFields(mockApiKey, fields) : mockApiKey;
}

export function createMockApiKeyWithSecret(
  overrides: Partial<ApiKeyWithSecret> = {},
): ApiKeyWithSecret {
  return {
    id: testIds.apiKey,
    key: 'hh_test_' + crypto.randomBytes(32).toString('base64url'),
    prefix: 'hh_test_abcd',
    name: 'Test Mastra API Key',
    description: 'Test API key for unit tests',
    keyType: 'MASTRA_AI',
    serviceType: 'agent-service',
    scopes: ['agent:execute', 'callback:results'],
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
    isActive: true,
    ...overrides,
  };
}

export function createMockValidatedApiKey(
  overrides: Partial<ValidatedApiKey> = {},
): ValidatedApiKey {
  return {
    id: testIds.apiKey,
    organizationId: testIds.organization,
    keyType: 'MASTRA_AI',
    serviceType: 'agent-service',
    scopes: ['agent:execute', 'callback:results'],
    name: 'Test Mastra API Key',
    createdBy: testIds.user,
    ...overrides,
  };
}

export function createMockEncryptedKey(
  plaintext: string = 'test-api-key',
  validFormat: boolean = true,
): string {
  if (!validFormat) {
    return 'invalid-format-missing-colon';
  }

  const iv = crypto.randomBytes(16).toString('hex');
  const fakeEncrypted = Buffer.from(plaintext).toString('hex');
  return `${iv}:${fakeEncrypted}`;
}

// Enhanced API Key Service Mock with Encryption
export function createMockApiKeyServiceEnhanced(): jest.Mocked<ApiKeyService> {
  const createOrganizationApiKey = jest.fn();
  const mockService = {
    createApiKey: jest.fn(),
    createMastraApiKey: createOrganizationApiKey,
    createOrganizationApiKey,
    getOrganizationApiKey: jest.fn(),
    hasMastraApiKey: jest.fn(),
    validateApiKey: jest.fn(),
    getApiKeys: jest.fn(),
    getApiKey: jest.fn(),
    updateApiKey: jest.fn(),
    deleteApiKey: jest.fn(),
    rotateApiKey: jest.fn(),
    encryptApiKey: jest.fn(),
    decryptApiKey: jest.fn(),
    generateApiKey: jest.fn(),
    hashApiKey: jest.fn(),
    verifyApiKey: jest.fn(),
    validateScopes: jest.fn(),
    updateLastUsed: jest.fn(),
  } as any;

  // Set up default behaviors for API key operations
  mockService.createOrganizationApiKey.mockResolvedValue(
    createMockApiKeyWithSecret(),
  );
  mockService.getOrganizationApiKey.mockResolvedValue('hh_test_retrieved_key');
  mockService.getApiKey.mockResolvedValue('hh_test_retrieved_key');
  mockService.hasMastraApiKey.mockResolvedValue(true);
  mockService.validateApiKey.mockResolvedValue(createMockValidatedApiKey());
  mockService.getApiKeys.mockResolvedValue([createMockApiKey()]);

  // Mock encryption/decryption with realistic behavior
  mockService.encryptApiKey.mockImplementation((key: string) =>
    createMockEncryptedKey(key),
  );

  mockService.decryptApiKey.mockImplementation((encrypted: string) => {
    if (!encrypted.includes(':')) return null;
    const [iv, data] = encrypted.split(':');
    return iv && data ? Buffer.from(data, 'hex').toString() : null;
  });

  mockService.generateApiKey.mockImplementation(() => ({
    key: 'hh_test_' + crypto.randomBytes(32).toString('base64url'),
    prefix: 'hh_test_' + crypto.randomBytes(4).toString('hex'),
  }));

  return mockService;
}

// Enhanced Mastra Client Service Mock with Cache Behavior
export function createMockMastraClientServiceEnhanced(): jest.Mocked<MastraClientService> {
  const mockCache = new Map<string, string>();
  const mockCacheExpiry = new Map<string, number>();
  let cacheTtl = 300000; // 5 minutes default

  const mockService = {
    getOrganizationApiKey: jest.fn(),
    invalidateOrgKeyCache: jest.fn(),
    clearAllCaches: jest.fn(),
    scanRequestForSensitiveData: jest.fn(),
    setCacheTtl: jest.fn(),
    executeAgent: jest.fn(),
    getCircuitBreakerKey: jest.fn(),
    shouldAllowExecution: jest.fn(),
    validateAgentConfig: jest.fn(),
    classifyError: jest.fn(),
  } as any;

  // Implement realistic cache behavior
  mockService.getOrganizationApiKey.mockImplementation(
    async (orgId: OrganizationId) => {
      const cached = mockCache.get(orgId);
      const expiry = mockCacheExpiry.get(orgId);

      if (cached && expiry && Date.now() < expiry) {
        return cached;
      }

      const newKey = `hh_test_${orgId}_key`;
      mockCache.set(orgId, newKey);
      mockCacheExpiry.set(orgId, Date.now() + cacheTtl);
      return newKey;
    },
  );

  mockService.invalidateOrgKeyCache.mockImplementation(
    (orgId: OrganizationId) => {
      mockCache.delete(orgId);
      mockCacheExpiry.delete(orgId);
    },
  );

  mockService.clearAllCaches.mockImplementation(() => {
    mockCache.clear();
    mockCacheExpiry.clear();
  });

  mockService.setCacheTtl.mockImplementation((ttl: number) => {
    cacheTtl = ttl;
  });

  return mockService;
}

// Database Test Utilities
export async function createDatabaseTestTransaction<T>(
  testFn: (tx: any) => Promise<T>,
): Promise<T> {
  // Mock transaction wrapper for testing
  const mockTx = createMockPrismaService().db;
  return await testFn(mockTx);
}

// Error Injection Utilities
export function mockDatabaseError(
  operation: string,
  errorType: 'TIMEOUT' | 'CONNECTION' | 'CONSTRAINT' = 'CONNECTION',
): Error {
  const errors = {
    TIMEOUT: new Error(`Database timeout during ${operation}`),
    CONNECTION: new Error(`Database connection failed during ${operation}`),
    CONSTRAINT: new Error(`Unique constraint violation during ${operation}`),
  };

  const error = errors[errorType];
  (error as any).code = errorType;
  (error as any).operation = operation;
  return error;
}

// Cache Test Utilities
export interface MockCacheState {
  cache: Map<string, string>;
  expiry: Map<string, number>;
}

export function createMockCacheState(
  entries: Array<[string, string, number]> = [],
): MockCacheState {
  const cache = new Map<string, string>();
  const expiry = new Map<string, number>();

  entries.forEach(([key, value, ttl]) => {
    cache.set(key, value);
    expiry.set(key, Date.now() + ttl);
  });

  return { cache, expiry };
}

// Concurrency Test Utilities
export async function runConcurrent<T>(
  fn: () => Promise<T>,
  count: number,
  delay: number = 0,
): Promise<Array<PromiseSettledResult<T>>> {
  const promises = Array.from({ length: count }, async () => {
    if (delay > 0) await sleep(Math.random() * delay);
    return fn();
  });

  return Promise.allSettled(promises);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Performance Testing Utilities
export interface PerformanceMetrics {
  executionTime: number;
  memoryUsed: number;
  cacheHitRate: number;
  operationsPerSecond: number;
}

export async function measurePerformance<T>(
  operation: () => Promise<T>,
  iterations: number = 100,
): Promise<{ result: T; metrics: PerformanceMetrics }> {
  const startMemory = process.memoryUsage().heapUsed;
  const startTime = Date.now();

  let cacheHits = 0;
  let result: T | undefined;

  for (let i = 0; i < iterations; i++) {
    result = await operation();
    // Simple cache hit simulation for testing
    if (i > 0 && i % 3 === 0) cacheHits++;
  }

  if (result === undefined) {
    throw new Error('measurePerformance requires at least one iteration.');
  }

  const endTime = Date.now();
  const endMemory = process.memoryUsage().heapUsed;

  return {
    result,
    metrics: {
      executionTime: endTime - startTime,
      memoryUsed: endMemory - startMemory,
      cacheHitRate: cacheHits / iterations,
      operationsPerSecond: iterations / ((endTime - startTime) / 1000),
    },
  };
}

// Security Testing Utilities
export function createMockSecurityContext(organizationId: OrganizationId) {
  return {
    organizationId,
    sensitiveFields: ['userId', 'email', 'apiKey', 'token'],
    logSecurityEvent: jest.fn((event: any) => {
      // Mock security event logging
    }),
    detectLeakage: jest.fn((content: string) => {
      return content.includes(organizationId);
    }),
  };
}

export function generateTestApiKeys(count: number = 5): string[] {
  return Array.from(
    { length: count },
    () => 'hh_test_' + crypto.randomBytes(32).toString('base64url'),
  );
}

// Load Testing Utilities
export async function simulateLoad<T>(
  operation: () => Promise<T>,
  concurrency: number = 100,
  duration: number = 5000,
): Promise<{
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageLatency: number;
  maxLatency: number;
  minLatency: number;
}> {
  const results: number[] = [];
  let successful = 0;
  let failed = 0;

  const startTime = Date.now();
  const promises: Promise<void>[] = [];

  while (Date.now() - startTime < duration) {
    for (let i = 0; i < concurrency; i++) {
      const operationStart = Date.now();
      promises.push(
        operation()
          .then(() => {
            successful++;
            results.push(Date.now() - operationStart);
          })
          .catch(() => {
            failed++;
          }),
      );
    }
    await sleep(100); // Brief pause between batches
  }

  await Promise.allSettled(promises);

  return {
    totalOperations: successful + failed,
    successfulOperations: successful,
    failedOperations: failed,
    averageLatency:
      results.length > 0 ? results.reduce((a, b) => a + b) / results.length : 0,
    maxLatency: results.length > 0 ? Math.max(...results) : 0,
    minLatency: results.length > 0 ? Math.min(...results) : 0,
  };
}

// Test ID Extensions
export const apiKeyTestIds = {
  apiKey: 'test-api-key-id' as string,
  apiKey2: 'test-api-key-id-2' as string,
  encryptedKey: 'encrypted-key-hash',
  hashedKey: 'hashed-key-value',
  prefix: 'hh_test_abcd',
  fallbackKey: 'hh_fallback_key',
} as const;

// Add API key IDs to main testIds for consistency
Object.assign(testIds, apiKeyTestIds);

// Mock task refinement session result
interface TaskRefinementSessionResult {
  success: boolean;
  data: {
    conversation: ConversationResponseDto;
    workItem: TaskRefinableEntity; // Use the actual type
    entityType: EntityType;
    refinementState: {
      currentLevel: RefinementLevel;
      nextLevel: RefinementLevel; // Make required to match controller expectations
      canFinalize: boolean;
      canAdvance: boolean;
      progressPercentage: number;
    };
  };
  timestamp: Date;
}

export function createMockTaskRefinementSessionResult(
  overrides?: Partial<TaskRefinementSessionResult>,
): TaskRefinementSessionResult {
  return {
    success: true,
    data: {
      conversation: createMockConversation(),
      workItem: createMockTaskResponseDto() as unknown as TaskRefinableEntity, // Cast to TaskRefinableEntity
      entityType: 'task',
      refinementState: {
        currentLevel: 'description',
        nextLevel: 'details',
        canFinalize: false,
        canAdvance: true,
        progressPercentage: 25,
      },
    },
    timestamp: new Date(),
    ...overrides,
  };
}

// Mock task refinement status result
interface TaskRefinementStatusResult {
  success: boolean;
  data: {
    entityId: string;
    entityType: EntityType;
    currentLevel: RefinementLevel;
    nextLevel: RefinementLevel; // Make required to match controller expectations
    status: string;
    progress: {
      currentLevel: RefinementLevel;
      nextLevel: RefinementLevel; // Make required to match controller expectations
      progressPercentage: number;
      canAdvance: boolean;
      canFinalize: boolean;
    };
    contentState: {
      hasDescription: boolean;
      hasDetails: boolean;
      hasAcceptanceCriteria: boolean;
    };
    availableActions: string[];
  };
}

export function createMockTaskRefinementStatusResult(
  overrides?: Partial<TaskRefinementStatusResult>,
): TaskRefinementStatusResult {
  const baseData = {
    entityId: testIds.task,
    entityType: 'task' as const,
    currentLevel: 'details' as RefinementLevel,
    nextLevel: 'acceptanceCriteria' as RefinementLevel, // Make required as expected by controller
    status: 'active',
    progress: {
      currentLevel: 'details' as RefinementLevel,
      nextLevel: 'acceptanceCriteria' as RefinementLevel,
      progressPercentage: 60,
      canAdvance: true,
      canFinalize: false,
    },
    contentState: {
      hasDescription: true,
      hasDetails: true,
      hasAcceptanceCriteria: false,
    },
    availableActions: ['advance', 'edit', 'feedback'],
  };

  return {
    success: true,
    data: {
      ...baseData,
      ...overrides?.data,
    },
    ...overrides,
  };
}

// Mock task content update result
interface TaskContentUpdateResult {
  success: boolean;
  message: string;
  status: string;
  data: {
    workItem: TaskRefinableEntity; // Use the actual type
    updatedFields: string[];
    feedbackRequested: boolean;
  };
  timestamp: Date;
}

export function createMockTaskContentUpdateResult(
  overrides?: Partial<TaskContentUpdateResult>,
): TaskContentUpdateResult {
  return {
    success: true,
    message: 'Content updated successfully',
    status: 'active',
    data: {
      workItem: createMockTaskResponseDto({
        name: 'Updated Task',
        sections: createMockMaterializedTaskSections({
          description: 'Updated description',
        }),
      }) as unknown as TaskRefinableEntity,
      updatedFields: ['description', 'acceptanceCriteria'],
      feedbackRequested: true,
    },
    timestamp: new Date(),
    ...overrides,
  };
}

// Mock WorkItemRefinementController factory
export const createMockWorkItemRefinementController = () => {
  const controller = {
    logger: {} as any,
    initiativeRefinementService: {} as any,
    taskRefinementService: {} as any,
    conversationService: {} as any,
    refinementRoutingService: {} as any,
    getOrCreateRefinementSession: jest.fn(),
    refineWorkItem: jest.fn(),
    updateContent: jest.fn(),
    advanceLevel: jest.fn(),
    finalizeRefinement: jest.fn(),
    getRefinementStatus: jest.fn(),
    getInitiativeRefinementSession: jest.fn(),
    initiativeRefineMessage: jest.fn(),
    initiativeUpdateContent: jest.fn(),
    initiativeAdvanceLevel: jest.fn(),
    initiativeFinalizeRefinement: jest.fn(),
    initiativeGetRefinementStatus: jest.fn(),
    getRefinementService: jest.fn(),
    // Add missing methods that were in the old test setup
    validateEntityType: jest.fn(),
    validateRefinementLevel: jest.fn(),
    findWorkItem: jest.fn(),
    updateWorkItem: jest.fn(),
    calculateProgress: jest.fn(),
    getStatusForLevel: jest.fn(),
    getFinalizedStatus: jest.fn(),
  };
  return controller;
};

// Mock service factories for work-item-refinement.controller tests
import type { InitiativeRefinementService } from '../services/initiatives/initiative-refinement.service';
import type { TaskRefinementService } from '../services/tasks/task-refinement.service';

export const createMockInitiativeRefinementService = () =>
  ({
    findOneForAdapter: jest.fn(),
    updateForAdapter: jest.fn(),
    getActiveRefinementConversation: jest.fn(),
    createRefinementConversation: jest.fn(),
    canAdvanceToNextLevel: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    applyRefinementChanges: jest.fn(),
    getCurrentRefinementLevel: jest.fn(),
    getNextLevel: jest.fn(),
    getTypeConfig: jest.fn(),
    validateContentReadiness: jest.fn(),
    buildRefinementContext: jest.fn(),
  }) as unknown as jest.Mocked<InitiativeRefinementService>;

export const createMockTaskRefinementService = () =>
  ({
    findOneForAdapter: jest.fn(),
    updateForAdapter: jest.fn(),
    getActiveRefinementConversation: jest.fn(),
    createRefinementConversation: jest.fn(),
    canAdvanceToNextLevel: jest.fn(),
    getStatusForLevel: jest.fn(),
    isFieldEmpty: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    applyRefinementChanges: jest.fn(),
    getCurrentRefinementLevel: jest.fn(),
    getNextLevel: jest.fn(),
    getTypeConfig: jest.fn(),
    validateContentReadiness: jest.fn(),
    buildRefinementContext: jest.fn(),
  }) as unknown as jest.Mocked<TaskRefinementService>;

// ===== REFINABLE ENTITY SYSTEM MOCK FACTORIES =====

// Mock RefinableEntity factory
export function createMockRefinableEntity(
  overrides?: Partial<RefinableEntity>,
): RefinableEntity;
export function createMockRefinableEntity(
  overrides: Partial<RefinableEntity> | undefined,
  fields: Array<keyof RefinableEntity>,
): Partial<RefinableEntity>;
export function createMockRefinableEntity(
  overrides: Partial<RefinableEntity> = {},
  fields?: Array<keyof RefinableEntity>,
): RefinableEntity {
  const base: RefinableEntity = {
    id: testIds.initiative,
    name: 'Test Refinable Entity',
    description: 'Test entity description for refinement',
    details: 'Test technical implementation details',
    acceptanceCriteria: 'Test success criteria for completion',
    status: WorkStatus.RefiningDescription,
    priority: Priority.Medium,
    assigneeId: null,
    organizationId: testIds.organization,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Mock RefinementContext factory
export function createMockRefinementContext(
  overrides?: Partial<RefinementContext>,
): RefinementContext;
export function createMockRefinementContext(
  overrides: Partial<RefinementContext> | undefined,
  fields: Array<keyof RefinementContext>,
): Partial<RefinementContext>;
export function createMockRefinementContext(
  overrides: Partial<RefinementContext> = {},
  fields?: Array<keyof RefinementContext>,
): RefinementContext {
  const base: RefinementContext = {
    entityId: testIds.initiative,
    entityType: 'initiative',
    organizationId: testIds.organization,
    projectId: testIds.project,
    conversationId: testIds.conversation,
    workflowId: testIds.workflow,
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Mock RefinementSession factory
export function createMockRefinementSession(
  overrides?: Partial<RefinementSession>,
): RefinementSession;
export function createMockRefinementSession(
  overrides: Partial<RefinementSession> | undefined,
  fields: Array<keyof RefinementSession>,
): Partial<RefinementSession>;
export function createMockRefinementSession(
  overrides: Partial<RefinementSession> = {},
  fields?: Array<keyof RefinementSession>,
): RefinementSession {
  const base: RefinementSession = {
    conversationId: testIds.conversation,
    workflowId: testIds.workflow,
    currentLevel: 'description',
    entitySnapshot: createMockRefinableEntity(),
    sessionMetadata: {
      startedAt: new Date().toISOString(),
      entityType: 'initiative',
      organizationId: testIds.organization,
    },
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Mock ChangeDetectionResult factory
export function createMockChangeDetectionResult(
  overrides?: Partial<ChangeDetectionResult>,
): ChangeDetectionResult;
export function createMockChangeDetectionResult(
  overrides: Partial<ChangeDetectionResult> | undefined,
  fields: Array<keyof ChangeDetectionResult>,
): Partial<ChangeDetectionResult>;
export function createMockChangeDetectionResult(
  overrides: Partial<ChangeDetectionResult> = {},
  fields?: Array<keyof ChangeDetectionResult>,
): ChangeDetectionResult {
  const base: ChangeDetectionResult = {
    hasChanges: true,
    changesSummary: 'Test changes detected in content',
    confidenceScore: 0.85,
    affectedFields: ['description'],
    changeType: 'minor',
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Mock OptimizationContext factory
export function createMockOptimizationContext(
  overrides?: Partial<OptimizationContext>,
): OptimizationContext;
export function createMockOptimizationContext(
  overrides: Partial<OptimizationContext> | undefined,
  fields: Array<keyof OptimizationContext>,
): Partial<OptimizationContext>;
export function createMockOptimizationContext(
  overrides: Partial<OptimizationContext> = {},
  fields?: Array<keyof OptimizationContext>,
): OptimizationContext {
  const base: OptimizationContext = {
    shouldSkipLlm: false,
    optimizationHints: ['Content generation recommended'],
    processingRecommendation: 'generate',
    estimatedProcessingTime: 5000,
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Mock RefinementOperationResult factory
export function createMockRefinementOperationResult(
  overrides?: Partial<RefinementOperationResult>,
): RefinementOperationResult;
export function createMockRefinementOperationResult(
  overrides: Partial<RefinementOperationResult> | undefined,
  fields: Array<keyof RefinementOperationResult>,
): Partial<RefinementOperationResult>;
export function createMockRefinementOperationResult(
  overrides: Partial<RefinementOperationResult> = {},
  fields?: Array<keyof RefinementOperationResult>,
): RefinementOperationResult {
  const base: RefinementOperationResult = {
    success: true,
    message: 'Refinement operation completed successfully',
    status: WorkStatus.RefiningDescription,
    entityId: testIds.initiative,
    currentLevel: 'description',
    workflowId: testIds.workflow,
    timestamp: new Date(),
    metadata: {
      processingTime: 3500,
      changesApplied: 1,
    },
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// Mock WorkItemRefinementRequest factory
export function createMockWorkItemRefinementRequest(
  overrides?: Partial<WorkItemRefinementRequest>,
): WorkItemRefinementRequest;
export function createMockWorkItemRefinementRequest(
  overrides: Partial<WorkItemRefinementRequest> | undefined,
  fields: Array<keyof WorkItemRefinementRequest>,
): Partial<WorkItemRefinementRequest>;
export function createMockWorkItemRefinementRequest(
  overrides: Partial<WorkItemRefinementRequest> = {},
  fields?: Array<keyof WorkItemRefinementRequest>,
): WorkItemRefinementRequest {
  const base: WorkItemRefinementRequest = {
    message: 'Test refinement request message',
    contentUpdate: {
      content: 'Updated content for refinement',
      level: 'description',
      previousContent: 'Previous content',
    },
    classifiedIntent: 'approve_level',
    metadata: {
      userRequestedChange: true,
      confidence: 0.9,
    },
    ...overrides,
  };

  if (fields) {
    return pickFields(base, fields);
  }

  return base;
}

// ===== ENHANCED PRISMA AND EVENT MOCKING =====

// Enhanced Prisma service mock with transaction support
export const createMockPrismaServiceWithTransactions = () => {
  const mockTransaction = jest.fn();
  const mockPrisma = createMockPrismaServiceWithTypes();

  // Enhanced transaction mock that properly calls the callback
  mockPrisma.$transaction.mockImplementation(
    async (callback: (tx: any) => Promise<any>) => {
      const transactionPrisma = {
        ...mockPrisma.db,
        $transaction: mockPrisma.$transaction,
      };
      return callback(transactionPrisma);
    },
  );

  return mockPrisma;
};

// Mock Flow Node with proper transitions and behavior
export function createMockFlowNodeWithTransitions(
  nodeId: string,
  nodeType: NodeType = NodeType.ACTION,
  overrides?: Partial<ConversationNode>,
): ConversationNode {
  return {
    id: nodeId,
    type: nodeType,
    title: `Test ${nodeType} Node`,
    nextNode: 'end',
    action: jest.fn().mockResolvedValue({
      type: nodeType,
      message: 'Node executed successfully',
      data: { success: true },
      uiElements: [],
      actions: [],
    }),
    processLlmResponse: jest.fn().mockResolvedValue({
      modifiedResult: undefined,
    }),
    determineRouting: jest.fn().mockResolvedValue({
      modifiedResult: undefined,
      routingOverride: undefined,
    }),
    transitions:
      nodeType === NodeType.AGENT
        ? {
            continue_refining: jest.fn().mockReturnValue('classify_message'),
            get_feedback: jest.fn().mockReturnValue('agent_feedback'),
            move_to_next_level: jest
              .fn()
              .mockReturnValue('approve_level_action'),
          }
        : undefined,
    ...overrides,
  } as ConversationNode;
}

// Mock Content Updates for refinement testing
export function createMockContentUpdates(
  overrides?: Partial<ContentUpdates>,
): ContentUpdates {
  return {
    description: 'Updated description content',
    details: 'Updated technical details',
    acceptanceCriteria: 'Updated acceptance criteria',
    priority: Priority.High,
    assigneeId: testIds.user,
    ...overrides,
  };
}

// Mock NestJS Application Context for dependency injection
export function createMockAppContext(
  overrides?: Record<string, any>,
): INestApplicationContext {
  const mockServices = {
    [InitiativeService.name]: createMockInitiativeService(),
    [MessageService.name]: createMockMessageService(),
    [ArtifactService.name]: createMockArtifactService(),
    [ConversationService.name]: createMockConversationService(),
    [PrismaService.name]: createMockPrismaService(),
    [TaskService.name]: createMockTaskService(),
    [InitiativeOptimizationService.name]:
      createMockInitiativeOptimizationService(),
    ...overrides,
  };

  return {
    get: jest.fn((token: any) => {
      // Handle both string tokens and class constructors
      const key = typeof token === 'string' ? token : token.name;
      const service = mockServices[key];
      if (!service) {
        throw new Error(`No mock service found for token: ${key}`);
      }
      return service;
    }),
    resolve: jest.fn(),
    select: jest.fn(),
    enableShutdownHooks: jest.fn(),
    close: jest.fn(),
    init: jest.fn(),
    isInitialized: true,
    getUrl: jest.fn(),
    registerRequestByContextId: jest.fn(),
    createContextId: jest.fn(),
    useLogger: jest.fn(),
    flushLogs: jest.fn(),
  } as jest.Mocked<INestApplicationContext>;
}

// Additional mock services for work item helpers
export const createMockWorkItemAdapter = () => ({
  findEntity: jest.fn().mockResolvedValue(null),
  updateEntity: jest.fn().mockResolvedValue({}),
  createConversation: jest.fn().mockResolvedValue({ id: 'conv-123' }),
  findActiveConversation: jest.fn().mockResolvedValue(null),
  validateStageTransition: jest.fn().mockResolvedValue([]),
  calculateProgress: jest.fn().mockResolvedValue(50),
  getCurrentStage: jest.fn().mockReturnValue({
    id: 'description',
    order: 1,
    nextStages: ['details'],
  }),
  canAdvanceToStage: jest.fn().mockResolvedValue(true),
});

export const createMockWorkflowRouterService = () => ({
  isWorkflowRunning: jest.fn().mockResolvedValue(true),
  isWorkflowUserMessageSignalReady: jest.fn().mockResolvedValue(true),
  startWorkflow: jest.fn().mockResolvedValue('workflow-123'),
  stopWorkflow: jest.fn().mockResolvedValue(undefined),
  getWorkflowStatus: jest.fn().mockResolvedValue({ status: 'RUNNING' }),
  sendSkipToNode: jest.fn().mockResolvedValue(undefined),
  sendUserMessage: jest.fn().mockResolvedValue(undefined),
});

export const createMockWorkflowExecutionService = () => ({
  getTemplateMetrics: jest.fn().mockResolvedValue({
    templateId: 'test-template',
    templateName: 'Test Template',
    totalExecutions: 10,
    successfulExecutions: 8,
    failedExecutions: 2,
    successRate: 80,
    averageExecutionTime: 1500,
    medianExecutionTime: 1200,
    p95ExecutionTime: 2000,
    executionsByStatus: {},
    executionsByDay: [],
    mostCommonErrors: [],
    period: {
      startDate: new Date().toISOString(),
      endDate: new Date().toISOString(),
    },
  }),
  getWorkflowAnalytics: jest.fn().mockResolvedValue({
    summary: {
      totalTemplates: 5,
      totalExecutions: 100,
      overallSuccessRate: 85,
      averageExecutionTime: 1500,
      activeUsers: 10,
    },
    topTemplates: [],
    trendsOverTime: [],
    period: {
      startDate: new Date().toISOString(),
      endDate: new Date().toISOString(),
    },
  }),
  getWorkflowExecutions: jest.fn().mockResolvedValue({
    executions: [],
    totalCount: 0,
    hasMore: false,
    filters: {},
  }),
  validateSkipToNode: jest.fn().mockResolvedValue({ canSkip: true }),
  getAvailableSkipNodes: jest.fn().mockResolvedValue([]),
});
