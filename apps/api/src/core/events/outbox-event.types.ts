import {
  ConversationId,
  OrganizationId,
  PlanId,
  ProjectId,
  UserId,
} from '../../types';
import {
  AgentTrigger,
  CreateArtifactDto,
  CreateSystemMessage,
  CreateUserMessage,
  CreateProjectDto,
  AgentSessionDto,
  AgentSessionStatus,
  ConversationStatus,
  InitiationType,
  ImplementationHintDto,
  MessageResponseDto,
  ReportDto,
  ConversationUpdateEventData,
  UpdateArtifactDto,
  UpdateProjectDto,
  WorkflowName,
  OrganizationClosedEvent,
  GitHubWebhookAcceptedEvent,
  HelpContentChangedEvent,
  TaskContentChangedEventPayload,
} from '../../generated';
import { ExecutionContext } from 'src/types/execution-context';

// ---------------------------------------------------------------------------
// Core Outbox Event typings – extracted from legacy ObservableOutboxService
// ---------------------------------------------------------------------------

type CreateAnyMessageDto = CreateUserMessage | CreateSystemMessage;

// Base interface for all outbox events
interface BaseOutboxEventData<P extends ExecutionContext = ExecutionContext> {
  aggregateType: string;
  aggregateId: string;
  headers?: Record<string, unknown>;
  scheduledFor?: Date;
  maxRetries?: number;
  payload: P;
}

type GeneratedDomainEventOutboxData<
  E extends { type: string; aggregateId: string; payload: object },
  AggregateType extends string,
> = Pick<E, 'aggregateId' | 'payload'> &
  Pick<BaseOutboxEventData, 'headers' | 'scheduledFor' | 'maxRetries'> & {
    eventType: E['type'];
    aggregateType: AggregateType;
  };

type OrganizationClosedOutboxEvent = GeneratedDomainEventOutboxData<
  OrganizationClosedEvent,
  'organization'
>;

type GitHubWebhookAcceptedOutboxEvent = GeneratedDomainEventOutboxData<
  GitHubWebhookAcceptedEvent,
  'github'
>;

type HelpContentChangedOutboxEvent = GeneratedDomainEventOutboxData<
  HelpContentChangedEvent,
  'help'
>;

// Conversation event types
interface ConversationCreatedEvent
  extends BaseOutboxEventData<
    {
      organizationId: OrganizationId;
      workflowAboutId?: string;
      workflowAboutType?: string;
      workflowName: WorkflowName;
      conversationTitle?: string;
      initiatedBy: InitiationType;
      status: ConversationStatus;
    } & ExecutionContext
  > {
  eventType: 'conversation.created';
  aggregateType: 'conversation';
}

export interface ConversationUpdatedEvent
  extends BaseOutboxEventData<
    {
      updateData?: ConversationUpdateEventData;
      organizationId: OrganizationId;
      conversationId?: string | ConversationId;
      projectId?: string | ProjectId;
      triggeringMessage?: CreateAnyMessageDto;
      triggersAgent?: AgentTrigger;
    } & ExecutionContext
  > {
  eventType: 'conversation.updated';
  aggregateType: 'conversation';
}

// Message event types
export interface MessageCreatedEvent
  extends BaseOutboxEventData<
    {
      message: CreateAnyMessageDto;
      projectId: ProjectId;
      conversationId: ConversationId;
      organizationId: OrganizationId;
    } & ExecutionContext
  > {
  eventType: 'message.created';
  aggregateType: 'message';
}

interface MessageUpdatedEvent
  extends BaseOutboxEventData<
    {
      message: MessageResponseDto;
      updateData?: any;
      organizationId: OrganizationId;
    } & ExecutionContext
  > {
  eventType: 'message.updated';
  aggregateType: 'message';
}

interface MessageDeletedEvent
  extends BaseOutboxEventData<
    {
      messageId: string;
      message: MessageResponseDto;
      organizationId: OrganizationId;
    } & ExecutionContext
  > {
  eventType: 'message.deleted';
  aggregateType: 'message';
}

/**
 * Producer contract for mention.created / mention.removed:
 *
 * Both events are derived from an explicit prior-vs-new diff of the
 * mentions persisted on a source entity body (or message). Producers
 * MUST snapshot prior mentions before mutation, compute the new set
 * after mutation, and emit one mention.created per added entityId and
 * one mention.removed per removed entityId. Removals are NEVER inferred
 * from the absence of a mention.created — a subscriber cannot
 * distinguish "no event arrived yet" from "mention was dropped" without
 * an explicit removal.
 */
interface MentionCreatedEvent
  extends BaseOutboxEventData<
    {
      sourceEntityId: string;
      sourceEntityType: 'MESSAGE' | 'TASK' | 'DESIGN_DOC';
      messageId?: string;
      conversationId?: ConversationId;
      workflowAboutId?: string;
      workflowAboutType?: string;
      entityId: string;
      entityType: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
    } & ExecutionContext
  > {
  eventType: 'mention.created';
  aggregateType: 'mention';
}

/** See MentionCreatedEvent for the diff-driven producer contract. */
interface MentionRemovedEvent
  extends BaseOutboxEventData<
    {
      sourceEntityId: string;
      sourceEntityType: 'MESSAGE' | 'TASK' | 'DESIGN_DOC';
      conversationId?: ConversationId;
      entityId: string;
      entityType: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
    } & ExecutionContext
  > {
  eventType: 'mention.removed';
  aggregateType: 'mention';
}

// Project event types
interface ProjectCreatedEvent
  extends BaseOutboxEventData<
    {
      project: CreateProjectDto;
      organizationId?: OrganizationId;
    } & ExecutionContext
  > {
  eventType: 'project.created';
  aggregateType: 'project';
}

interface ProjectUpdatedEvent
  extends BaseOutboxEventData<
    {
      updateData?: UpdateProjectDto;
      organizationId?: OrganizationId;
    } & ExecutionContext
  > {
  eventType: 'project.updated';
  aggregateType: 'project';
}

interface ProjectStatusChangedEvent
  extends BaseOutboxEventData<
    {
      previousStatus?: string;
      newStatus: string;
      organizationId?: OrganizationId;
    } & ExecutionContext
  > {
  eventType: 'project.status_changed';
  aggregateType: 'project';
}

interface ProjectDeletedEvent
  extends BaseOutboxEventData<
    {
      deletedAt: string;
      organizationId?: OrganizationId;
    } & ExecutionContext
  > {
  eventType: 'project.deleted';
  aggregateType: 'project';
}

interface AgentSessionDeletedEvent
  extends BaseOutboxEventData<
    {
      organizationId: OrganizationId;
      projectId: ProjectId;
      agentSession: AgentSessionDto;
      conversationId?: ConversationId;
      userId?: UserId;
    } & ExecutionContext
  > {
  eventType: 'agent_session.deleted';
  aggregateType: 'agent_session';
}

interface AgentSessionCreatedEvent
  extends BaseOutboxEventData<
    {
      organizationId: OrganizationId;
      projectId: ProjectId;
      conversationId: ConversationId;
      taskId?: string;
      planId?: string;
      serviceId?: string;
      agentSession: AgentSessionDto;
      userId?: UserId;
    } & ExecutionContext
  > {
  eventType: 'agent_session.created';
  aggregateType: 'agent_session';
}

interface AgentSessionStatusChangedEvent
  extends BaseOutboxEventData<
    {
      organizationId: OrganizationId;
      projectId?: ProjectId;
      agentSession: AgentSessionDto;
      previousStatus: AgentSessionStatus;
      newStatus: AgentSessionStatus;
      conversationId?: ConversationId;
      userId?: UserId;
    } & ExecutionContext
  > {
  eventType: 'agent_session.status_changed';
  aggregateType: 'agent_session';
}

interface ImplementationHintCreatedEvent
  extends BaseOutboxEventData<
    {
      implementationHint: ImplementationHintDto;
      organizationId: OrganizationId;
      projectId: ProjectId;
    } & ExecutionContext
  > {
  eventType: 'implementation_hint.created';
  aggregateType: 'implementation_hint';
}

interface ImplementationHintUpdatedEvent
  extends BaseOutboxEventData<
    {
      implementationHint: ImplementationHintDto;
      changes?: Record<string, unknown>;
      organizationId: OrganizationId;
      projectId: ProjectId;
    } & ExecutionContext
  > {
  eventType: 'implementation_hint.updated';
  aggregateType: 'implementation_hint';
}

interface ImplementationHintDeletedEvent
  extends BaseOutboxEventData<
    {
      implementationHintId: string;
      organizationId: OrganizationId;
      projectId: ProjectId;
    } & ExecutionContext
  > {
  eventType: 'implementation_hint.deleted';
  aggregateType: 'implementation_hint';
}

interface ReportCreatedEvent
  extends BaseOutboxEventData<
    {
      organizationId: OrganizationId;
      projectId?: ProjectId;
      report: ReportDto;
      userId?: UserId;
    } & ExecutionContext
  > {
  eventType: 'report.created';
  aggregateType: 'report';
}

// System event types
interface SystemNotificationEvent
  extends BaseOutboxEventData<
    {
      message: string;
      severity: 'info' | 'warning' | 'error';
      organizationId?: OrganizationId;
      projectId?: ProjectId;
      conversationId?: ConversationId;
      userId?: UserId;
    } & ExecutionContext
  > {
  eventType: 'system.notification';
  aggregateType: 'system';
}

// User event types
interface UserActivityEvent
  extends BaseOutboxEventData<
    {
      userId: UserId;
      activity: string;
      organizationId?: OrganizationId;
      projectId?: ProjectId;
      conversationId?: ConversationId;
    } & ExecutionContext
  > {
  eventType: 'user.activity';
  aggregateType: 'user';
}

// Artifact event types
interface ArtifactCreatedEvent
  extends BaseOutboxEventData<
    {
      organizationId: OrganizationId;
      projectId: ProjectId;
      artifact: CreateArtifactDto;
    } & ExecutionContext
  > {
  eventType: 'artifact.created';
  aggregateType: 'artifact';
}

interface ArtifactUpdatedEvent
  extends BaseOutboxEventData<
    {
      organizationId: OrganizationId;
      projectId: ProjectId;
      artifact: UpdateArtifactDto;
    } & ExecutionContext
  > {
  eventType: 'artifact.updated';
  aggregateType: 'artifact';
}

// Initiative event types
interface InitiativeCreatedEvent
  extends BaseOutboxEventData<
    {
      organizationId: OrganizationId;
      initiative: any; // TODO: Use proper CreateInitiativeDto type
    } & ExecutionContext
  > {
  eventType: 'initiative.created';
  aggregateType: 'Initiative';
}

interface InitiativeUpdatedEvent
  extends BaseOutboxEventData<
    {
      organizationId: OrganizationId;
      update: any; // TODO: Use proper UpdateInitiativeDto type
      projectId?: ProjectId;
      originatingProjectId?: ProjectId | null;
      linkedProjectIds?: ProjectId[];
      changes: Array<{
        field: string;
        oldValue: any;
        newValue: any;
        dataType: string;
      }>;
      totalFieldsChanged: number;
      changedBy: {
        userId: UserId;
        email: string;
        name: string;
      };
      changeMetadata?: {
        timestamp: string;
        mergedAt?: string;
        mergeCount?: number;
      };
    } & ExecutionContext
  > {
  eventType: 'initiative.updated';
  aggregateType: 'Initiative';
}

interface InitiativeContentChangedEvent
  extends BaseOutboxEventData<
    {
      organizationId: OrganizationId;
      content: {
        description: string;
        details: string;
        acceptanceCriteria: string;
      };
      projectId: ProjectId;
      originatingProjectId?: ProjectId | null;
      linkedProjectIds?: ProjectId[];
    } & ExecutionContext
  > {
  eventType: 'initiative.content_changed';
  aggregateType: 'Initiative';
}

interface InitiativeStatusChangedEvent
  extends BaseOutboxEventData<
    {
      organizationId: OrganizationId;
      previousStatus: string;
      newStatus: string;
    } & ExecutionContext
  > {
  eventType: 'initiative.status_changed';
  aggregateType: 'Initiative';
}

interface DesignDocStatusChangedEvent
  extends BaseOutboxEventData<
    {
      organizationId: OrganizationId;
      projectId: ProjectId;
      previousStatus: string;
      newStatus: string;
    } & ExecutionContext
  > {
  eventType: 'design_doc.status_changed';
  aggregateType: 'design_doc';
}

interface TaskContentChangedEvent
  extends BaseOutboxEventData<TaskContentChangedEventPayload> {
  eventType: 'task.content_changed';
  aggregateType: 'task';
}

interface DesignDocContentChangedEvent
  extends BaseOutboxEventData<
    {
      organizationId: OrganizationId;
      designDoc: Record<string, unknown>;
      projectId: ProjectId;
    } & ExecutionContext
  > {
  eventType: 'design_doc.content_changed';
  aggregateType: 'design_doc';
}

// Workflow event types
interface WorkflowStartedEvent
  extends BaseOutboxEventData<
    {
      workflowId: string;
      workflowType: string;
      organizationId?: OrganizationId;
      projectId?: ProjectId;
      conversationId?: ConversationId;
      userId?: UserId;
      inputs?: Record<string, unknown>;
    } & ExecutionContext
  > {
  eventType: 'workflow.started';
  aggregateType: 'workflow';
}

interface WorkflowCompletedEvent
  extends BaseOutboxEventData<
    {
      workflowId: string;
      workflowType: string;
      organizationId?: OrganizationId;
      projectId?: ProjectId;
      conversationId?: ConversationId;
      userId?: UserId;
      outputs?: Record<string, unknown>;
    } & ExecutionContext
  > {
  eventType: 'workflow.completed';
  aggregateType: 'workflow';
}

interface WorkflowFailedEvent
  extends BaseOutboxEventData<
    {
      workflowId: string;
      workflowType: string;
      error: string;
      organizationId?: OrganizationId;
      projectId?: ProjectId;
      conversationId?: ConversationId;
      userId?: UserId;
    } & ExecutionContext
  > {
  eventType: 'workflow.failed';
  aggregateType: 'workflow';
}

// Discriminated union of all supported events
export type OutboxEventData =
  | ConversationCreatedEvent
  | ConversationUpdatedEvent
  | MessageCreatedEvent
  | MessageUpdatedEvent
  | MessageDeletedEvent
  | MentionCreatedEvent
  | MentionRemovedEvent
  | ProjectCreatedEvent
  | ProjectUpdatedEvent
  | ProjectStatusChangedEvent
  | ProjectDeletedEvent
  | OrganizationClosedOutboxEvent
  | GitHubWebhookAcceptedOutboxEvent
  | HelpContentChangedOutboxEvent
  | AgentSessionCreatedEvent
  | AgentSessionDeletedEvent
  | AgentSessionStatusChangedEvent
  | ImplementationHintCreatedEvent
  | ImplementationHintUpdatedEvent
  | ImplementationHintDeletedEvent
  | ReportCreatedEvent
  | ArtifactCreatedEvent
  | ArtifactUpdatedEvent
  | InitiativeCreatedEvent
  | InitiativeUpdatedEvent
  | InitiativeContentChangedEvent
  | InitiativeStatusChangedEvent
  | TaskContentChangedEvent
  | DesignDocContentChangedEvent
  | DesignDocStatusChangedEvent
  | SystemNotificationEvent
  | UserActivityEvent
  | WorkflowStartedEvent
  | WorkflowCompletedEvent
  | WorkflowFailedEvent;

// Helper to extract specific payload type given an event type
export type EventPayload<T extends OutboxEventData['eventType']> = Extract<
  OutboxEventData,
  { eventType: T }
>['payload'];

// Type guard helpers – convenient for switch/if chains
export function isConversationEvent(
  event: OutboxEventData,
): event is ConversationCreatedEvent | ConversationUpdatedEvent {
  return event.eventType.startsWith('conversation.');
}

export function isMessageEvent(
  event: OutboxEventData,
): event is MessageCreatedEvent | MessageUpdatedEvent | MessageDeletedEvent {
  return event.eventType.startsWith('message.');
}

export function isProjectEvent(
  event: OutboxEventData,
): event is
  | ProjectCreatedEvent
  | ProjectUpdatedEvent
  | ProjectStatusChangedEvent
  | ProjectDeletedEvent {
  return event.eventType.startsWith('project.');
}

export function isSystemEvent(
  event: OutboxEventData,
): event is SystemNotificationEvent {
  return event.eventType.startsWith('system.');
}

export function isWorkflowEvent(
  event: OutboxEventData,
): event is
  | WorkflowStartedEvent
  | WorkflowCompletedEvent
  | WorkflowFailedEvent {
  return event.eventType.startsWith('workflow.');
}

export function isInitiativeEvent(
  event: OutboxEventData,
): event is
  | InitiativeCreatedEvent
  | InitiativeUpdatedEvent
  | InitiativeContentChangedEvent
  | InitiativeStatusChangedEvent {
  return event.eventType.startsWith('initiative.');
}
