/*
 * Domain Events
 * -------------
 * Pure data representations of things that happened in the domain.
 * They carry no infrastructure or transport concerns.
 */

import { AgentCompleteEvent } from 'src/generated/model/agentCompleteEvent';
import { AgentErrorEvent } from 'src/generated/model/agentErrorEvent';
import { AgentProgressEvent } from 'src/generated/model/agentProgressEvent';
import { AgentRequestEvent } from 'src/generated/model/agentRequestEvent';
import { ArtifactArchivedEvent } from 'src/generated/model/artifactArchivedEvent';
import { ArtifactCreatedEvent } from 'src/generated/model/artifactCreatedEvent';
import { ArtifactDeletedEvent } from 'src/generated/model/artifactDeletedEvent';
import { ArtifactGenerationRequestedEvent } from 'src/generated/model/artifactGenerationRequestedEvent';
import { ArtifactRestoredEvent } from 'src/generated/model/artifactRestoredEvent';
import { ArtifactUpdatedEvent } from 'src/generated/model/artifactUpdatedEvent';
import { ImplementationHintCreatedEvent } from 'src/generated/model/implementationHintCreatedEvent';
import { ImplementationHintDeletedEvent } from 'src/generated/model/implementationHintDeletedEvent';
import { ImplementationHintUpdatedEvent } from 'src/generated/model/implementationHintUpdatedEvent';
import { AgentSessionCreatedEvent } from 'src/generated/model/agentSessionCreatedEvent';
import { AgentSessionDeletedEvent } from 'src/generated/model/agentSessionDeletedEvent';
import { AgentSessionStatusChangedEvent } from 'src/generated/model/agentSessionStatusChangedEvent';
import { ConversationCreatedEvent } from 'src/generated/model/conversationCreatedEvent';
import { ConversationDeletedEvent } from 'src/generated/model/conversationDeletedEvent';
import { ConversationStatusChangedEvent } from 'src/generated/model/conversationStatusChangedEvent';
import { ConversationUpdatedEvent } from 'src/generated/model/conversationUpdatedEvent';
import { DesignDocArchivedEvent } from 'src/generated/model/designDocArchivedEvent';
import { DesignDocContentChangedEvent } from 'src/generated/model/designDocContentChangedEvent';
import { DesignDocCreatedEvent } from 'src/generated/model/designDocCreatedEvent';
import { DesignDocRestoredEvent } from 'src/generated/model/designDocRestoredEvent';
import { DesignDocStatusChangedEvent } from 'src/generated/model/designDocStatusChangedEvent';
import { DesignDocUpdatedEvent } from 'src/generated/model/designDocUpdatedEvent';
import { FlowNodeCompleteEvent } from 'src/generated/model/flowNodeCompleteEvent';
import { FlowNodeStartEvent } from 'src/generated/model/flowNodeStartEvent';
import { InitiativeArchivedEvent } from 'src/generated/model/initiativeArchivedEvent';
import { InitiativeContentChangedEvent } from 'src/generated/model/initiativeContentChangedEvent';
import { InitiativeCreatedEvent } from 'src/generated/model/initiativeCreatedEvent';
import { InitiativeProjectLinkedEvent } from 'src/generated/model/initiativeProjectLinkedEvent';
import { InitiativeProjectUnlinkedEvent } from 'src/generated/model/initiativeProjectUnlinkedEvent';
import { InitiativeStatusChangedEvent } from 'src/generated/model/initiativeStatusChangedEvent';
import { InitiativeUpdatedEvent } from 'src/generated/model/initiativeUpdatedEvent';
import { LlmAnalysisQueueEvent } from 'src/generated/model/llmAnalysisQueueEvent';
import { LlmCompleteEvent } from 'src/generated/model/llmCompleteEvent';
import { LlmInitiativeCreationQueueEvent } from 'src/generated/model/llmInitiativeCreationQueueEvent';
import { LlmProgressEvent } from 'src/generated/model/llmProgressEvent';
import { LlmRequestEvent } from 'src/generated/model/llmRequestEvent';
import { MessageCreatedEvent } from 'src/generated/model/messageCreatedEvent';
import { MessageDeletedEvent } from 'src/generated/model/messageDeletedEvent';
import { MessageRealtimeEvent } from 'src/generated/model/messageRealtimeEvent';
import { MessageProcessorErrorEvent } from 'src/generated/model/messageProcessorErrorEvent';
import { MessageUpdatedEvent } from 'src/generated/model/messageUpdatedEvent';
import { MentionCreatedEvent } from 'src/generated/model/mentionCreatedEvent';
import { MentionRemovedEvent } from 'src/generated/model/mentionRemovedEvent';
import { ProjectCreatedEvent } from 'src/generated/model/projectCreatedEvent';
import { ProjectDeletedEvent } from 'src/generated/model/projectDeletedEvent';
import { ProjectStatusChangedEvent } from 'src/generated/model/projectStatusChangedEvent';
import { ProjectUpdatedEvent } from 'src/generated/model/projectUpdatedEvent';
import { OrganizationClosedEvent } from 'src/generated/model/organizationClosedEvent';
import { OrganizationClosedEventPayload } from 'src/generated/model/organizationClosedEventPayload';
import { QueueJobEvent } from 'src/generated/model/queueJobEvent';
import { ReportCreatedEvent } from 'src/generated/model/reportCreatedEvent';
import { ServiceArchivedEvent } from 'src/generated/model/serviceArchivedEvent';
import { ServiceCreatedEvent } from 'src/generated/model/serviceCreatedEvent';
import { ServiceUpdatedEvent } from 'src/generated/model/serviceUpdatedEvent';
import { SubfacetCreatedEvent } from 'src/generated/model/subfacetCreatedEvent';
import { SubfacetDeprecatedEvent } from 'src/generated/model/subfacetDeprecatedEvent';
import { SystemEvent as GeneratedSystemEvent } from 'src/generated/model/systemEvent';
import { NotificationPushEventPayload } from 'src/generated/model/notificationPushEventPayload';
import { WebSocketSystemNotificationEvent } from 'src/generated/model/webSocketSystemNotificationEvent';
import { TaskArchivedEvent } from 'src/generated/model/taskArchivedEvent';
import { TaskAssignedEvent } from 'src/generated/model/taskAssignedEvent';
import { TaskContentChangedEvent } from 'src/generated/model/taskContentChangedEvent';
import { TaskCreatedEvent } from 'src/generated/model/taskCreatedEvent';
import { TaskStatusChangedEvent } from 'src/generated/model/taskStatusChangedEvent';
import { TaskUnassignedEvent } from 'src/generated/model/taskUnassignedEvent';
import { TaskUpdatedEvent } from 'src/generated/model/taskUpdatedEvent';
import {
  SummaryCreatedEvent,
  SummaryDeletedEvent,
  SummaryUpdatedEvent,
} from 'src/generated';
import { ExecutionContext } from 'src/types/execution-context';
import { EVENT_TYPES } from './event.types';
import { OnboardingReplyDelivery } from './event.types';
import {
  NonInteractiveFlowNodeCompleteEvent,
  NonInteractiveFlowNodeErrorEvent,
  NonInteractiveFlowNodeStartEvent,
} from 'src/generated';
import { ProposalApprovedEvent } from 'src/generated/model/proposalApprovedEvent';
import { ProposalApprovedEventPayload } from 'src/generated/model/proposalApprovedEventPayload';
import { EvalAttemptUpdatedEvent } from 'src/generated/model/evalAttemptUpdatedEvent';
import { EvalAttemptUpdatedEventPayload } from 'src/generated/model/evalAttemptUpdatedEventPayload';
import { EvalRunUpdatedEvent } from 'src/generated/model/evalRunUpdatedEvent';
import { EvalRunUpdatedEventPayload } from 'src/generated/model/evalRunUpdatedEventPayload';
import { ProposalGroupLifecycleEvent } from 'src/generated/model/proposalGroupLifecycleEvent';
import { ProposalGroupLifecycleEventPayload } from 'src/generated/model/proposalGroupLifecycleEventPayload';
import { GitHubWebhookAcceptedEvent } from 'src/generated/model/gitHubWebhookAcceptedEvent';
import { HelpContentChangedEvent } from 'src/generated/model/helpContentChangedEvent';
import { HelpContentChangedEventPayload } from 'src/generated/model/helpContentChangedEventPayload';

export type {
  AgentCompleteEvent,
  AgentErrorEvent,
  AgentProgressEvent,
  AgentRequestEvent,
  ArtifactArchivedEvent,
  ArtifactCreatedEvent,
  ArtifactDeletedEvent,
  ArtifactGenerationRequestedEvent,
  ArtifactRestoredEvent,
  ArtifactUpdatedEvent,
  ImplementationHintCreatedEvent,
  ImplementationHintDeletedEvent,
  ImplementationHintUpdatedEvent,
  AgentSessionCreatedEvent,
  AgentSessionDeletedEvent,
  AgentSessionStatusChangedEvent,
  ConversationCreatedEvent,
  ConversationDeletedEvent,
  ConversationStatusChangedEvent,
  ConversationUpdatedEvent,
  DesignDocArchivedEvent,
  DesignDocContentChangedEvent,
  DesignDocCreatedEvent,
  DesignDocRestoredEvent,
  DesignDocStatusChangedEvent,
  DesignDocUpdatedEvent,
  FlowNodeCompleteEvent,
  FlowNodeStartEvent,
  InitiativeArchivedEvent,
  InitiativeContentChangedEvent,
  InitiativeCreatedEvent,
  InitiativeProjectLinkedEvent,
  InitiativeProjectUnlinkedEvent,
  InitiativeStatusChangedEvent,
  InitiativeUpdatedEvent,
  LlmAnalysisQueueEvent,
  LlmCompleteEvent,
  LlmInitiativeCreationQueueEvent,
  LlmProgressEvent,
  LlmRequestEvent,
  MessageCreatedEvent,
  MessageDeletedEvent,
  MessageRealtimeEvent,
  MessageProcessorErrorEvent,
  MessageUpdatedEvent,
  MentionCreatedEvent,
  MentionRemovedEvent,
  ProjectCreatedEvent,
  ProjectDeletedEvent,
  ProjectStatusChangedEvent,
  ProjectUpdatedEvent,
  OrganizationClosedEvent,
  OrganizationClosedEventPayload,
  ReportCreatedEvent,
  ServiceArchivedEvent,
  ServiceCreatedEvent,
  ServiceUpdatedEvent,
  SubfacetCreatedEvent,
  SubfacetDeprecatedEvent,
  GeneratedSystemEvent,
  TaskArchivedEvent,
  TaskAssignedEvent,
  TaskContentChangedEvent,
  TaskCreatedEvent,
  TaskStatusChangedEvent,
  TaskUnassignedEvent,
  TaskUpdatedEvent,
  SummaryCreatedEvent,
  SummaryDeletedEvent,
  SummaryUpdatedEvent,
  GitHubWebhookAcceptedEvent,
  HelpContentChangedEvent,
  HelpContentChangedEventPayload,
};
export type SummaryEvents =
  | SummaryCreatedEvent
  | SummaryUpdatedEvent
  | SummaryDeletedEvent;
export type SummaryCreatedEventType = SummaryCreatedEvent;
export type SummaryUpdatedEventType = SummaryUpdatedEvent;
export type SummaryDeletedEventType = SummaryDeletedEvent;
export type SubfacetEvents = SubfacetCreatedEvent | SubfacetDeprecatedEvent;

export type ConversationEvents =
  | ConversationCreatedEvent
  | ConversationUpdatedEvent
  | ConversationDeletedEvent
  | ConversationStatusChangedEvent;

export type MessageEvents =
  | MessageCreatedEvent
  | MessageUpdatedEvent
  | MessageRealtimeEvent
  | MessageDeletedEvent;

export type OnboardingReplyMessageCreatedEvent = Omit<
  MessageCreatedEvent,
  'payload'
> & {
  payload: MessageCreatedEvent['payload'] & {
    onboardingReplyDelivery: OnboardingReplyDelivery;
  };
};

export const hasOnboardingReplyDelivery = (
  event: MessageCreatedEvent,
): event is OnboardingReplyMessageCreatedEvent =>
  'onboardingReplyDelivery' in event.payload &&
  typeof (event.payload as { onboardingReplyDelivery?: unknown })
    .onboardingReplyDelivery === 'object' &&
  (event.payload as { onboardingReplyDelivery?: unknown })
    .onboardingReplyDelivery !== null;

export const hasRepositoryImportReplyDelivery = (
  event: MessageCreatedEvent,
): boolean =>
  'repositoryImportReplyDelivery' in event.payload &&
  typeof (event.payload as { repositoryImportReplyDelivery?: unknown })
    .repositoryImportReplyDelivery === 'object' &&
  (event.payload as { repositoryImportReplyDelivery?: unknown })
    .repositoryImportReplyDelivery !== null;
export type MentionEvents = MentionCreatedEvent | MentionRemovedEvent;

export type JobEvents = JobStatusChanged;
export type JobStatusChanged = QueueJobEvent;

export type LLMEvents =
  | LlmRequestEvent
  | LlmProgressEvent
  | LlmCompleteEvent
  | LlmAnalysisQueueEvent
  | LlmInitiativeCreationQueueEvent;

export type ProjectEvents =
  | ProjectCreatedEvent
  | ProjectDeletedEvent
  | ProjectUpdatedEvent
  | ProjectStatusChangedEvent;

export type OrganizationEvents = OrganizationClosedEvent;

export type InitiativeEvents =
  | InitiativeCreatedEvent
  | InitiativeUpdatedEvent
  | InitiativeContentChangedEvent
  | InitiativeStatusChangedEvent
  | InitiativeArchivedEvent
  | InitiativeProjectLinkedEvent
  | InitiativeProjectUnlinkedEvent;

export type TaskEvents =
  | TaskCreatedEvent
  | TaskUpdatedEvent
  | TaskContentChangedEvent
  | TaskStatusChangedEvent
  | TaskArchivedEvent
  | TaskAssignedEvent
  | TaskUnassignedEvent;

export type AgentEvents =
  | AgentRequestEvent
  | AgentProgressEvent
  | AgentCompleteEvent
  | AgentErrorEvent;
export type FlowNodeEvents = FlowNodeStartEvent | FlowNodeCompleteEvent;
export type NonInteractiveFlowNodeEvents =
  | NonInteractiveFlowNodeStartEvent
  | NonInteractiveFlowNodeCompleteEvent
  | NonInteractiveFlowNodeErrorEvent;

export type ArtifactEvents =
  | ArtifactCreatedEvent
  | ArtifactUpdatedEvent
  | ArtifactDeletedEvent
  | ArtifactArchivedEvent
  | ArtifactRestoredEvent
  | ArtifactGenerationRequestedEvent;
export type ImplementationHintEvents =
  | ImplementationHintCreatedEvent
  | ImplementationHintUpdatedEvent
  | ImplementationHintDeletedEvent;
export type AgentSessionEvents =
  | AgentSessionCreatedEvent
  | AgentSessionDeletedEvent
  | AgentSessionStatusChangedEvent;
export type ReportEvents = ReportCreatedEvent;
export type SummaryEventTypes = SummaryEvents;

export type DesignDocEvents =
  | DesignDocCreatedEvent
  | DesignDocUpdatedEvent
  | DesignDocContentChangedEvent
  | DesignDocStatusChangedEvent
  | DesignDocArchivedEvent
  | DesignDocRestoredEvent;
export type ServiceEntityEvents =
  | ServiceCreatedEvent
  | ServiceUpdatedEvent
  | ServiceArchivedEvent;
export type QueueEvent = QueueJobEvent;

export type MessageProcessorEvents = MessageProcessorErrorEvent;

export type SystemNotificationEventPayload = NotificationPushEventPayload &
  Partial<ExecutionContext> &
  Pick<ExecutionContext, 'organizationId'> & {
    reportId?: string;
    message?: string;
    severity?: WebSocketSystemNotificationEvent.SeverityEnum;
  };

export interface SystemNotificationEvent {
  id: string;
  type: typeof EVENT_TYPES.SYSTEM.NOTIFICATION;
  aggregateId: string;
  payload: SystemNotificationEventPayload;
}

export interface SystemLifecycleEvent
  extends Omit<GeneratedSystemEvent, 'type'> {
  type: Exclude<GeneratedSystemEvent['type'], 'system.notification'>;
}

export type SystemEvents = SystemNotificationEvent | SystemLifecycleEvent;

// ---------------------------------------------------------------------------
// Proposal events
// ---------------------------------------------------------------------------

export type { ProposalApprovedEvent, ProposalApprovedEventPayload };

export type ProposalEvents = ProposalApprovedEvent;

export type { ProposalGroupLifecycleEvent, ProposalGroupLifecycleEventPayload };
export type ProposalGroupEvents = ProposalGroupLifecycleEvent;

export type {
  EvalRunUpdatedEvent,
  EvalRunUpdatedEventPayload,
  EvalAttemptUpdatedEvent,
  EvalAttemptUpdatedEventPayload,
};
export type EvalEvents = EvalRunUpdatedEvent | EvalAttemptUpdatedEvent;

export type GitHubWebhookEvents = GitHubWebhookAcceptedEvent;
export type HelpEvents = HelpContentChangedEvent;

// ---------------------------------------------------------------------------
// Work-item type registry events
// ---------------------------------------------------------------------------

/**
 * Cross-instance signal that a work_item_type row changed. It is a pure
 * cache-invalidation nudge, telling every instance's
 * WorkItemTypeRegistryService to re-warm its snapshot from Postgres (the system
 * of record). Hand-defined rather than generated because it never crosses the
 * public API boundary. The `organizationId` payload exists only to satisfy the
 * structural contract every ServiceEvent shares (extractEventIds reads it); the
 * signal itself is delivered to all instances regardless of org.
 */
export interface WorkItemTypeConfigChangedEvent {
  id: string;
  type: typeof EVENT_TYPES.WORK_ITEM_TYPE.CONFIG_CHANGED;
  /** The affected work-item type key, or 'ALL' for a full refresh. */
  aggregateId: string;
  payload: Partial<ExecutionContext> & Pick<ExecutionContext, 'organizationId'>;
}

export type WorkItemTypeEvents = WorkItemTypeConfigChangedEvent;

// ---------------------------------------------------------------------------
// Machine security events
// ---------------------------------------------------------------------------

/**
 * Emitted when a paired machine's credential is revoked. This is the
 * producer-side signal for the machine security event feed; the feed's
 * persistence and read endpoint are owned by a separate task, so this event
 * only records that the revocation happened. Hand-defined (not generated)
 * because it does not cross the public API boundary yet. `aggregateId` is the
 * revoked machine's id; the payload carries the owner and revocation time so a
 * consumer can attribute the event without a follow-up lookup.
 */
export interface MachineRevokedEvent {
  id: string;
  type: typeof EVENT_TYPES.MACHINE.REVOKED;
  aggregateId: string;
  payload: {
    machineId: string;
    userId: string;
    revokedAt: string;
  };
}

export type MachineEvents = MachineRevokedEvent;

// ---------------------------------------------------------------------------
// Union of all domain event families
// ---------------------------------------------------------------------------

export type ServiceEvent =
  | ConversationEvents
  | MessageEvents
  | MentionEvents
  | ProjectEvents
  | OrganizationEvents
  | InitiativeEvents
  | TaskEvents
  | ArtifactEvents
  | DesignDocEvents
  | ServiceEntityEvents
  | ImplementationHintEvents
  | AgentSessionEvents
  | ReportEvents
  | QueueEvent
  | LLMEvents
  | NonInteractiveFlowNodeEvents
  | AgentEvents
  | FlowNodeEvents
  | SystemEvents
  | MessageProcessorEvents
  | SummaryEvents
  | SubfacetEvents
  | ProposalEvents
  | ProposalGroupEvents
  | EvalEvents
  | GitHubWebhookEvents
  | HelpEvents
  | WorkItemTypeEvents
  | MachineEvents;

export const isMessageCreatedEvent = (
  event: ServiceEvent,
): event is MessageCreatedEvent => {
  return event.type === EVENT_TYPES.MESSAGE.CREATED;
};

export const isMentionCreatedEvent = (
  event: ServiceEvent,
): event is MentionCreatedEvent => {
  return event.type === EVENT_TYPES.MENTION.CREATED;
};

export const isMentionRemovedEvent = (
  event: ServiceEvent,
): event is MentionRemovedEvent => {
  return event.type === EVENT_TYPES.MENTION.REMOVED;
};

export const isMessageUpdatedEvent = (
  event: ServiceEvent,
): event is MessageUpdatedEvent => {
  return event.type === EVENT_TYPES.MESSAGE.UPDATED;
};

export const isMessageRealtimeEvent = (
  event: ServiceEvent,
): event is MessageRealtimeEvent => {
  return event.type === EVENT_TYPES.MESSAGE.REALTIME;
};

export const isMessageDeletedEvent = (
  event: ServiceEvent,
): event is MessageDeletedEvent => {
  return event.type === EVENT_TYPES.MESSAGE.DELETED;
};

export const isConversationCreatedEvent = (
  event: ServiceEvent,
): event is ConversationCreatedEvent => {
  return event.type === EVENT_TYPES.CONVERSATION.CREATED;
};

export const isConversationUpdatedEvent = (
  event: ServiceEvent,
): event is ConversationUpdatedEvent => {
  return event.type === EVENT_TYPES.CONVERSATION.UPDATED;
};

export const isConversationDeletedEvent = (
  event: ServiceEvent,
): event is ConversationDeletedEvent => {
  return event.type === EVENT_TYPES.CONVERSATION.DELETED;
};

export const isConversationStatusChangedEvent = (
  event: ServiceEvent,
): event is ConversationStatusChangedEvent => {
  return event.type === EVENT_TYPES.CONVERSATION.STATUS_CHANGED;
};

export const isConversationEvents = (
  event: ServiceEvent,
): event is ConversationEvents => {
  return (
    isConversationCreatedEvent(event) ||
    isConversationUpdatedEvent(event) ||
    isConversationDeletedEvent(event) ||
    isConversationStatusChangedEvent(event)
  );
};

export const isProjectCreatedEvent = (
  event: ServiceEvent,
): event is ProjectCreatedEvent => {
  return event.type === EVENT_TYPES.PROJECT.CREATED;
};

export const isProjectUpdatedEvent = (
  event: ServiceEvent,
): event is ProjectUpdatedEvent => {
  return event.type === EVENT_TYPES.PROJECT.UPDATED;
};

export const isProjectDeletedEvent = (
  event: ServiceEvent,
): event is ProjectDeletedEvent => {
  return event.type === EVENT_TYPES.PROJECT.DELETED;
};

export const isProjectStatusChangedEvent = (
  event: ServiceEvent,
): event is ProjectStatusChangedEvent => {
  return event.type === EVENT_TYPES.PROJECT.STATUS_CHANGED;
};

export const isProjectEvents = (
  event: ServiceEvent,
): event is ProjectEvents => {
  return (
    isProjectCreatedEvent(event) ||
    isProjectDeletedEvent(event) ||
    isProjectUpdatedEvent(event) ||
    isProjectStatusChangedEvent(event)
  );
};

export const isOrganizationEvents = (
  event: ServiceEvent,
): event is OrganizationEvents => {
  return event.type === EVENT_TYPES.ORGANIZATION.CLOSED;
};

export const isSystemNotificationEvent = (
  event: ServiceEvent,
): event is SystemNotificationEvent => {
  return event.type === EVENT_TYPES.SYSTEM.NOTIFICATION;
};

export const isArtifactCreatedEvent = (
  event: ServiceEvent,
): event is ArtifactCreatedEvent => {
  return event.type === EVENT_TYPES.ARTIFACT.CREATED;
};

export const isArtifactUpdatedEvent = (
  event: ServiceEvent,
): event is ArtifactUpdatedEvent => {
  return event.type === EVENT_TYPES.ARTIFACT.UPDATED;
};

export const isArtifactGenerationRequestedEvent = (
  event: ServiceEvent,
): event is ArtifactGenerationRequestedEvent => {
  return event.type === EVENT_TYPES.ARTIFACT.GENERATION_REQUESTED;
};

export const isArtifactEvents = (
  event: ServiceEvent,
): event is ArtifactEvents => {
  return (
    isArtifactCreatedEvent(event) ||
    isArtifactUpdatedEvent(event) ||
    isArtifactGenerationRequestedEvent(event)
  );
};

export const isImplementationHintCreatedEvent = (
  event: ServiceEvent,
): event is ImplementationHintCreatedEvent => {
  return event.type === EVENT_TYPES.IMPLEMENTATION_HINT.CREATED;
};

export const isImplementationHintUpdatedEvent = (
  event: ServiceEvent,
): event is ImplementationHintUpdatedEvent => {
  return event.type === EVENT_TYPES.IMPLEMENTATION_HINT.UPDATED;
};

export const isImplementationHintDeletedEvent = (
  event: ServiceEvent,
): event is ImplementationHintDeletedEvent => {
  return event.type === EVENT_TYPES.IMPLEMENTATION_HINT.DELETED;
};

export const isImplementationHintEvents = (
  event: ServiceEvent,
): event is ImplementationHintEvents => {
  return (
    isImplementationHintCreatedEvent(event) ||
    isImplementationHintUpdatedEvent(event) ||
    isImplementationHintDeletedEvent(event)
  );
};

export const isAgentSessionStatusChangedEvent = (
  event: ServiceEvent,
): event is AgentSessionStatusChangedEvent => {
  return event.type === EVENT_TYPES.AGENT_SESSION.STATUS_CHANGED;
};

export const isAgentSessionCreatedEvent = (
  event: ServiceEvent,
): event is AgentSessionCreatedEvent => {
  return event.type === EVENT_TYPES.AGENT_SESSION.CREATED;
};

export const isAgentSessionDeletedEvent = (
  event: ServiceEvent,
): event is AgentSessionDeletedEvent => {
  return event.type === EVENT_TYPES.AGENT_SESSION.DELETED;
};

export const isAgentSessionEvents = (
  event: ServiceEvent,
): event is AgentSessionEvents => {
  return (
    isAgentSessionCreatedEvent(event) ||
    isAgentSessionStatusChangedEvent(event) ||
    isAgentSessionDeletedEvent(event)
  );
};

export const isReportCreatedEvent = (
  event: ServiceEvent,
): event is ReportCreatedEvent => {
  return event.type === EVENT_TYPES.REPORT.CREATED;
};

export const isReportEvents = (event: ServiceEvent): event is ReportEvents => {
  return isReportCreatedEvent(event);
};

export const isSummaryCreatedEvent = (
  event: ServiceEvent,
): event is SummaryCreatedEvent => {
  return event.type === EVENT_TYPES.SUMMARY.CREATED;
};

export const isSummaryUpdatedEvent = (
  event: ServiceEvent,
): event is SummaryUpdatedEvent => {
  return event.type === EVENT_TYPES.SUMMARY.UPDATED;
};

export const isSummaryDeletedEvent = (
  event: ServiceEvent,
): event is SummaryDeletedEvent => {
  return event.type === EVENT_TYPES.SUMMARY.DELETED;
};

export const isSummaryEvents = (
  event: ServiceEvent,
): event is SummaryEvents => {
  return (
    isSummaryCreatedEvent(event) ||
    isSummaryUpdatedEvent(event) ||
    isSummaryDeletedEvent(event)
  );
};

export const isSubfacetCreatedEvent = (
  event: ServiceEvent,
): event is SubfacetCreatedEvent => {
  return event.type === EVENT_TYPES.SUBFACET.CREATED;
};

export const isSubfacetDeprecatedEvent = (
  event: ServiceEvent,
): event is SubfacetDeprecatedEvent => {
  return event.type === EVENT_TYPES.SUBFACET.DEPRECATED;
};

export const isSubfacetEvents = (
  event: ServiceEvent,
): event is SubfacetEvents => {
  return isSubfacetCreatedEvent(event) || isSubfacetDeprecatedEvent(event);
};

export const isJobStatusChangedEvent = (
  event: ServiceEvent,
): event is JobStatusChanged => {
  return event.type === EVENT_TYPES.QUEUE.JOB_STATUS_CHANGED;
};

export const isLLMRequestEvent = (
  event: ServiceEvent,
): event is LlmRequestEvent => {
  return event.type === EVENT_TYPES.LLM.REQUEST;
};

export const isLLMProgressEvent = (
  event: ServiceEvent,
): event is LlmProgressEvent => {
  return event.type === EVENT_TYPES.LLM.PROGRESS;
};

export const isLLMCompleteEvent = (
  event: ServiceEvent,
): event is LlmCompleteEvent => {
  return event.type === EVENT_TYPES.LLM.COMPLETE;
};

export const isLLMEvents = (event: ServiceEvent): event is LLMEvents => {
  return (
    isLLMRequestEvent(event) ||
    isLLMProgressEvent(event) ||
    isLLMCompleteEvent(event)
  );
};

export const isInitiativeCreatedEvent = (
  event: ServiceEvent,
): event is InitiativeCreatedEvent => {
  return event.type === EVENT_TYPES.INITIATIVE.CREATED;
};

export const isInitiativeUpdatedEvent = (
  event: ServiceEvent,
): event is InitiativeUpdatedEvent => {
  return event.type === EVENT_TYPES.INITIATIVE.UPDATED;
};

export const isInitiativeContentChangedEvent = (
  event: ServiceEvent,
): event is InitiativeContentChangedEvent => {
  return event.type === EVENT_TYPES.INITIATIVE.CONTENT_CHANGED;
};

export const isInitiativeStatusChangedEvent = (
  event: ServiceEvent,
): event is InitiativeStatusChangedEvent => {
  return event.type === EVENT_TYPES.INITIATIVE.STATUS_CHANGED;
};

export const isInitiativeArchivedEvent = (
  event: ServiceEvent,
): event is InitiativeArchivedEvent => {
  return event.type === EVENT_TYPES.INITIATIVE.ARCHIVED;
};

export const isInitiativeProjectLinkedEvent = (
  event: ServiceEvent,
): event is InitiativeProjectLinkedEvent => {
  return event.type === EVENT_TYPES.INITIATIVE.PROJECT_LINKED;
};

export const isInitiativeProjectUnlinkedEvent = (
  event: ServiceEvent,
): event is InitiativeProjectUnlinkedEvent => {
  return event.type === EVENT_TYPES.INITIATIVE.PROJECT_UNLINKED;
};

export const isInitiativeEvents = (
  event: ServiceEvent,
): event is InitiativeEvents => {
  return (
    isInitiativeCreatedEvent(event) ||
    isInitiativeUpdatedEvent(event) ||
    isInitiativeContentChangedEvent(event) ||
    isInitiativeStatusChangedEvent(event) ||
    isInitiativeArchivedEvent(event) ||
    isInitiativeProjectLinkedEvent(event) ||
    isInitiativeProjectUnlinkedEvent(event)
  );
};

export const isTaskCreatedEvent = (
  event: ServiceEvent,
): event is TaskCreatedEvent => {
  return event.type === EVENT_TYPES.TASK.CREATED;
};

export const isTaskUpdatedEvent = (
  event: ServiceEvent,
): event is TaskUpdatedEvent => {
  return event.type === EVENT_TYPES.TASK.UPDATED;
};

export const isTaskContentChangedEvent = (
  event: ServiceEvent,
): event is TaskContentChangedEvent => {
  return event.type === EVENT_TYPES.TASK.CONTENT_CHANGED;
};

export const isTaskStatusChangedEvent = (
  event: ServiceEvent,
): event is TaskStatusChangedEvent => {
  return event.type === EVENT_TYPES.TASK.STATUS_CHANGED;
};

export const isTaskArchivedEvent = (
  event: ServiceEvent,
): event is TaskArchivedEvent => {
  return event.type === EVENT_TYPES.TASK.ARCHIVED;
};

export const isTaskAssignedEvent = (
  event: ServiceEvent,
): event is TaskAssignedEvent => {
  return event.type === EVENT_TYPES.TASK.ASSIGNED;
};

export const isTaskUnassignedEvent = (
  event: ServiceEvent,
): event is TaskUnassignedEvent => {
  return event.type === EVENT_TYPES.TASK.UNASSIGNED;
};

export const isTaskEvents = (event: ServiceEvent): event is TaskEvents => {
  return (
    isTaskCreatedEvent(event) ||
    isTaskUpdatedEvent(event) ||
    isTaskContentChangedEvent(event) ||
    isTaskStatusChangedEvent(event) ||
    isTaskArchivedEvent(event) ||
    isTaskAssignedEvent(event) ||
    isTaskUnassignedEvent(event)
  );
};

export const isAgentRequestEvent = (
  event: ServiceEvent,
): event is AgentRequestEvent => {
  return event.type === EVENT_TYPES.AGENT.REQUEST;
};

export const isAgentProgressEvent = (
  event: ServiceEvent,
): event is AgentProgressEvent => {
  return event.type === EVENT_TYPES.AGENT.PROGRESS;
};

export const isAgentCompleteEvent = (
  event: ServiceEvent,
): event is AgentCompleteEvent => {
  return event.type === EVENT_TYPES.AGENT.COMPLETE;
};

export const isAgentErrorEvent = (
  event: ServiceEvent,
): event is AgentErrorEvent => {
  return event.type === EVENT_TYPES.AGENT.ERROR;
};

export const isAgentEvents = (event: ServiceEvent): event is AgentEvents => {
  return (
    isAgentRequestEvent(event) ||
    isAgentProgressEvent(event) ||
    isAgentCompleteEvent(event) ||
    isAgentErrorEvent(event)
  );
};

export const isDesignDocCreatedEvent = (
  event: ServiceEvent,
): event is DesignDocCreatedEvent => {
  return event.type === EVENT_TYPES.DESIGN_DOC.CREATED;
};

export const isDesignDocUpdatedEvent = (
  event: ServiceEvent,
): event is DesignDocUpdatedEvent => {
  return event.type === EVENT_TYPES.DESIGN_DOC.UPDATED;
};

export const isDesignDocContentChangedEvent = (
  event: ServiceEvent,
): event is DesignDocContentChangedEvent => {
  return event.type === EVENT_TYPES.DESIGN_DOC.CONTENT_CHANGED;
};

export const isDesignDocStatusChangedEvent = (
  event: ServiceEvent,
): event is DesignDocStatusChangedEvent => {
  return event.type === EVENT_TYPES.DESIGN_DOC.STATUS_CHANGED;
};

export const isDesignDocArchivedEvent = (
  event: ServiceEvent,
): event is DesignDocArchivedEvent => {
  return event.type === EVENT_TYPES.DESIGN_DOC.ARCHIVED;
};

export const isDesignDocRestoredEvent = (
  event: ServiceEvent,
): event is DesignDocRestoredEvent => {
  return event.type === EVENT_TYPES.DESIGN_DOC.RESTORED;
};

export const isDesignDocEvents = (
  event: ServiceEvent,
): event is DesignDocEvents => {
  return (
    isDesignDocCreatedEvent(event) ||
    isDesignDocUpdatedEvent(event) ||
    isDesignDocContentChangedEvent(event) ||
    isDesignDocStatusChangedEvent(event) ||
    isDesignDocArchivedEvent(event) ||
    isDesignDocRestoredEvent(event)
  );
};

export const isServiceCreatedEvent = (
  event: ServiceEvent,
): event is ServiceCreatedEvent => {
  return event.type === EVENT_TYPES.SERVICE.CREATED;
};

export const isServiceUpdatedEvent = (
  event: ServiceEvent,
): event is ServiceUpdatedEvent => {
  return event.type === EVENT_TYPES.SERVICE.UPDATED;
};

export const isServiceArchivedEvent = (
  event: ServiceEvent,
): event is ServiceArchivedEvent => {
  return event.type === EVENT_TYPES.SERVICE.ARCHIVED;
};

export const isServiceEntityEvents = (
  event: ServiceEvent,
): event is ServiceEntityEvents => {
  return (
    isServiceCreatedEvent(event) ||
    isServiceUpdatedEvent(event) ||
    isServiceArchivedEvent(event)
  );
};

export const isProposalApprovedEvent = (
  event: ServiceEvent,
): event is ProposalApprovedEvent => {
  return event.type === EVENT_TYPES.PROPOSAL.APPROVED;
};

export const isProposalEvents = (
  event: ServiceEvent,
): event is ProposalEvents => {
  return isProposalApprovedEvent(event);
};

export const isProposalGroupEvents = (
  event: ServiceEvent,
): event is ProposalGroupEvents => {
  return event.type === EVENT_TYPES.PROPOSAL_GROUP.LIFECYCLE;
};

export const isGitHubWebhookEvents = (
  event: ServiceEvent,
): event is GitHubWebhookEvents => {
  return event.type === EVENT_TYPES.GITHUB_WEBHOOK.ACCEPTED;
};

export const isHelpEvents = (event: ServiceEvent): event is HelpEvents => {
  return event.type === EVENT_TYPES.HELP.CONTENT_CHANGED;
};

export const isWorkItemTypeConfigChangedEvent = (
  event: ServiceEvent,
): event is WorkItemTypeConfigChangedEvent => {
  return event.type === EVENT_TYPES.WORK_ITEM_TYPE.CONFIG_CHANGED;
};

export const isMachineRevokedEvent = (
  event: ServiceEvent,
): event is MachineRevokedEvent => {
  return event.type === EVENT_TYPES.MACHINE.REVOKED;
};
