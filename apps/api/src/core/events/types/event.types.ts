import {
  ConversationId,
  DesignDocId,
  InitiativeId,
  MachineId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from 'src/types';

export interface OnboardingReplyDelivery {
  workflowId?: WorkflowId;
  nodeId: string;
}

export interface RepositoryImportReplyDelivery {
  workflowId?: WorkflowId;
  nodeId: string;
}

export const EVENT_TYPES = {
  MESSAGE: {
    CREATED: 'message.created',
    UPDATED: 'message.updated',
    REALTIME: 'message.realtime',
    DELETED: 'message.deleted',
  },
  MENTION: {
    CREATED: 'mention.created',
    REMOVED: 'mention.removed',
  },
  CONVERSATION: {
    CREATED: 'conversation.created',
    UPDATED: 'conversation.updated',
    STATUS_CHANGED: 'conversation.status_changed',
    DELETED: 'conversation.deleted',
  },
  PROJECT: {
    CREATED: 'project.created',
    DELETED: 'project.deleted',
    UPDATED: 'project.updated',
    STATUS_CHANGED: 'project.status_changed',
  },
  ORGANIZATION: {
    CLOSED: 'organization.closed',
  },
  INITIATIVE: {
    CREATED: 'initiative.created',
    UPDATED: 'initiative.updated',
    CONTENT_CHANGED: 'initiative.content_changed',
    STATUS_CHANGED: 'initiative.status_changed',
    ARCHIVED: 'initiative.archived',
    PROJECT_LINKED: 'initiative.project_linked',
    PROJECT_UNLINKED: 'initiative.project_unlinked',
  },
  TASK: {
    CREATED: 'task.created',
    UPDATED: 'task.updated',
    CONTENT_CHANGED: 'task.content_changed',
    STATUS_CHANGED: 'task.status_changed',
    ARCHIVED: 'task.archived',
    ASSIGNED: 'task.assigned',
    UNASSIGNED: 'task.unassigned',
  },
  ARTIFACT: {
    CREATED: 'artifact.created',
    UPDATED: 'artifact.updated',
    DELETED: 'artifact.deleted',
    ARCHIVED: 'artifact.archived',
    RESTORED: 'artifact.restored',
    EMBEDDING_GENERATED: 'artifact.embedding_generated',
    GENERATION_REQUESTED: 'artifact.generation_requested',
  },
  QUEUE: {
    JOB_CREATED: 'queue.job_created',
    JOB_STARTED: 'queue.job_started',
    JOB_COMPLETED: 'queue.job_completed',
    JOB_FAILED: 'queue.job_failed',
    JOB_RETRIED: 'queue.job_retried',
    JOB_STATUS_CHANGED: 'queue.job_status_changed',
  },
  SYSTEM: {
    NOTIFICATION: 'system.notification',
    ALERT: 'system.alert',
    MAINTENANCE: 'system.maintenance',
  },
  LLM: {
    REQUEST: 'llm.request',
    PROGRESS: 'llm.progress',
    COMPLETE: 'llm.complete',
  },
  NON_INTERACTIVE_FLOW_NODE: {
    START: 'non_interactive_flow_node.start',
    COMPLETE: 'non_interactive_flow_node.complete',
    ERROR: 'non_interactive_flow_node.error',
  },
  AGENT: {
    REQUEST: 'agent.request',
    PROGRESS: 'agent.progress',
    COMPLETE: 'agent.complete',
    ERROR: 'agent.error',
  },
  FLOW_NODE: {
    START: 'flow_node.start',
    COMPLETE: 'flow_node.complete',
    ERROR: 'flow_node.error',
  },
  MESSAGE_PROCESSOR: {
    ERROR: 'message_processor.error',
  },
  DESIGN_DOC: {
    CREATED: 'design_doc.created',
    UPDATED: 'design_doc.updated',
    CONTENT_CHANGED: 'design_doc.content_changed',
    STATUS_CHANGED: 'design_doc.status_changed',
    ARCHIVED: 'design_doc.archived',
    RESTORED: 'design_doc.restored',
  },
  IMPLEMENTATION_HINT: {
    CREATED: 'implementation_hint.created',
    UPDATED: 'implementation_hint.updated',
    DELETED: 'implementation_hint.deleted',
  },
  AGENT_SESSION: {
    CREATED: 'agent_session.created',
    DELETED: 'agent_session.deleted',
    STATUS_CHANGED: 'agent_session.status_changed',
  },
  SERVICE: {
    CREATED: 'service.created',
    UPDATED: 'service.updated',
    ARCHIVED: 'service.archived',
  },
  REPORT: {
    CREATED: 'report.created',
  },
  SUMMARY: {
    CREATED: 'summary.created',
    UPDATED: 'summary.updated',
    DELETED: 'summary.deleted',
  },
  SUBFACET: {
    CREATED: 'subfacet.created',
    DEPRECATED: 'subfacet.deprecated',
  },
  PROPOSAL: {
    APPROVED: 'proposal.approved',
  },
  PROPOSAL_GROUP: {
    LIFECYCLE: 'proposal_group.lifecycle',
  },
  EVAL_RUN: {
    UPDATED: 'eval_run.updated',
  },
  EVAL_ATTEMPT: {
    UPDATED: 'eval_attempt.updated',
  },
  GITHUB_WEBHOOK: {
    ACCEPTED: 'github.webhook.accepted',
  },
  HELP: {
    CONTENT_CHANGED: 'help.content_changed',
  },
  WORK_ITEM_TYPE: {
    // Cross-instance signal that a work_item_type row changed and every
    // instance's in-memory registry snapshot must be refreshed from Postgres.
    CONFIG_CHANGED: 'work_item_type.config_changed',
  },
  MACHINE: {
    // A paired machine's credential was revoked. Producer-side signal for the
    // machine security event feed; the feed's persistence/read side is owned
    // by a separate task.
    REVOKED: 'machine.revoked',
  },
} as const;

export const JOB_TYPES = {
  ARTIFACTS: { GENERATE: 'generate' },
  AGENT: {
    EXECUTE: 'agent.execute',
  },
  INTEGRATION: {
    SYNC: 'sync',
    TEST_CONNECTION: 'test_connection',
    WEBHOOK: 'webhook',
  },
  FLOW_NODE: {
    EXECUTE: 'flow_node.execute',
  },
  NON_INTERACTIVE_FLOW_NODE: {
    EXECUTE: 'non_interactive_flow_node.execute',
  },
} as const;

export const JOB_STATUS = {
  WAITING: 'waiting',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  FAILED: 'failed',
  RETRIED: 'retried',
} as const;
export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];
export const JOB_STATUS_TO_EVENT_TYPE = {
  [JOB_STATUS.WAITING]: EVENT_TYPES.QUEUE.JOB_CREATED,
  [JOB_STATUS.ACTIVE]: EVENT_TYPES.QUEUE.JOB_STARTED,
  [JOB_STATUS.COMPLETED]: EVENT_TYPES.QUEUE.JOB_COMPLETED,
  [JOB_STATUS.FAILED]: EVENT_TYPES.QUEUE.JOB_FAILED,
  [JOB_STATUS.RETRIED]: EVENT_TYPES.QUEUE.JOB_RETRIED,
} as const;
export type MessageEventType =
  (typeof EVENT_TYPES.MESSAGE)[keyof typeof EVENT_TYPES.MESSAGE];
export type MentionEventType =
  (typeof EVENT_TYPES.MENTION)[keyof typeof EVENT_TYPES.MENTION];
export type ConversationEventType =
  (typeof EVENT_TYPES.CONVERSATION)[keyof typeof EVENT_TYPES.CONVERSATION];
export type ProjectEventType =
  (typeof EVENT_TYPES.PROJECT)[keyof typeof EVENT_TYPES.PROJECT];
export type OrganizationEventType =
  (typeof EVENT_TYPES.ORGANIZATION)[keyof typeof EVENT_TYPES.ORGANIZATION];
export type InitiativeEventType =
  (typeof EVENT_TYPES.INITIATIVE)[keyof typeof EVENT_TYPES.INITIATIVE];
export type TaskEventType =
  (typeof EVENT_TYPES.TASK)[keyof typeof EVENT_TYPES.TASK];
export type ArtifactEventType =
  (typeof EVENT_TYPES.ARTIFACT)[keyof typeof EVENT_TYPES.ARTIFACT];
export type QueueEventType =
  (typeof EVENT_TYPES.QUEUE)[keyof typeof EVENT_TYPES.QUEUE];
export type SystemEventType =
  (typeof EVENT_TYPES.SYSTEM)[keyof typeof EVENT_TYPES.SYSTEM];
export type LLMEventType =
  (typeof EVENT_TYPES.LLM)[keyof typeof EVENT_TYPES.LLM];
export type NonInteractiveFlowNodeEventType =
  (typeof EVENT_TYPES.NON_INTERACTIVE_FLOW_NODE)[keyof typeof EVENT_TYPES.NON_INTERACTIVE_FLOW_NODE];
export type AgentEventType =
  (typeof EVENT_TYPES.AGENT)[keyof typeof EVENT_TYPES.AGENT];
export type FlowNodeEventType =
  (typeof EVENT_TYPES.FLOW_NODE)[keyof typeof EVENT_TYPES.FLOW_NODE];
export type MessageProcessorEventType =
  (typeof EVENT_TYPES.MESSAGE_PROCESSOR)[keyof typeof EVENT_TYPES.MESSAGE_PROCESSOR];
export type DesignDocEventType =
  (typeof EVENT_TYPES.DESIGN_DOC)[keyof typeof EVENT_TYPES.DESIGN_DOC];
export type ImplementationHintEventType =
  (typeof EVENT_TYPES.IMPLEMENTATION_HINT)[keyof typeof EVENT_TYPES.IMPLEMENTATION_HINT];
export type AgentSessionEventType =
  (typeof EVENT_TYPES.AGENT_SESSION)[keyof typeof EVENT_TYPES.AGENT_SESSION];
export type ServiceLifecycleEventType =
  (typeof EVENT_TYPES.SERVICE)[keyof typeof EVENT_TYPES.SERVICE];
export type ReportEventType =
  (typeof EVENT_TYPES.REPORT)[keyof typeof EVENT_TYPES.REPORT];
export type SummaryEventType =
  (typeof EVENT_TYPES.SUMMARY)[keyof typeof EVENT_TYPES.SUMMARY];
export type SubfacetEventType =
  (typeof EVENT_TYPES.SUBFACET)[keyof typeof EVENT_TYPES.SUBFACET];
export type ProposalEventType =
  (typeof EVENT_TYPES.PROPOSAL)[keyof typeof EVENT_TYPES.PROPOSAL];
export type ProposalGroupEventType =
  (typeof EVENT_TYPES.PROPOSAL_GROUP)[keyof typeof EVENT_TYPES.PROPOSAL_GROUP];
export type EvalRunEventType =
  (typeof EVENT_TYPES.EVAL_RUN)[keyof typeof EVENT_TYPES.EVAL_RUN];
export type EvalAttemptEventType =
  (typeof EVENT_TYPES.EVAL_ATTEMPT)[keyof typeof EVENT_TYPES.EVAL_ATTEMPT];
export type GitHubWebhookEventType =
  (typeof EVENT_TYPES.GITHUB_WEBHOOK)[keyof typeof EVENT_TYPES.GITHUB_WEBHOOK];
export type HelpEventType =
  (typeof EVENT_TYPES.HELP)[keyof typeof EVENT_TYPES.HELP];
export type WorkItemTypeEventType =
  (typeof EVENT_TYPES.WORK_ITEM_TYPE)[keyof typeof EVENT_TYPES.WORK_ITEM_TYPE];
export type MachineEventType =
  (typeof EVENT_TYPES.MACHINE)[keyof typeof EVENT_TYPES.MACHINE];

export type ServiceEventType =
  | MessageEventType
  | MentionEventType
  | ConversationEventType
  | ProjectEventType
  | OrganizationEventType
  | InitiativeEventType
  | TaskEventType
  | ArtifactEventType
  | QueueEventType
  | LLMEventType
  | NonInteractiveFlowNodeEventType
  | AgentEventType
  | SystemEventType
  | FlowNodeEventType
  | MessageProcessorEventType
  | DesignDocEventType
  | ImplementationHintEventType
  | AgentSessionEventType
  | ServiceLifecycleEventType
  | ReportEventType
  | SummaryEventType
  | SubfacetEventType
  | ProposalEventType
  | ProposalGroupEventType
  | EvalRunEventType
  | EvalAttemptEventType
  | GitHubWebhookEventType
  | HelpEventType
  | WorkItemTypeEventType
  | MachineEventType;

export type ArtifactJobType =
  (typeof JOB_TYPES.ARTIFACTS)[keyof typeof JOB_TYPES.ARTIFACTS];
export type AgentJobType =
  (typeof JOB_TYPES.AGENT)[keyof typeof JOB_TYPES.AGENT];
export type IntegrationJobType =
  (typeof JOB_TYPES.INTEGRATION)[keyof typeof JOB_TYPES.INTEGRATION];
export type FLowNodeJobType =
  (typeof JOB_TYPES.FLOW_NODE)[keyof typeof JOB_TYPES.FLOW_NODE];
export type NonInteractiveFlowNodeJobType =
  (typeof JOB_TYPES.NON_INTERACTIVE_FLOW_NODE)[keyof typeof JOB_TYPES.NON_INTERACTIVE_FLOW_NODE];

export type JobType =
  | ArtifactJobType
  | AgentJobType
  | IntegrationJobType
  | FLowNodeJobType
  | NonInteractiveFlowNodeJobType;

export interface BaseEvent {
  type: string;
  organizationId?: OrganizationId;
}

export const JOB_CHANNELS = {
  ARTIFACTS: 'artifacts',
  LLM: 'llm',
  AGENT: 'agent',
  INTEGRATION: 'integration',
  FLOW_NODE: 'flow_node',
  NON_INTERACTIVE_FLOW_NODE: 'non_interactive_flow_node',
} as const;

export type QueueName = (typeof JOB_CHANNELS)[keyof typeof JOB_CHANNELS];
export interface ClientConnection {
  id: string;
  userId?: UserId;
  organizationId?: OrganizationId;
  organizationIds: OrganizationId[];
  projectIds: ProjectId[];
  conversationIds: ConversationId[];
  initiativeIds: InitiativeId[];
  designDocIds: DesignDocId[];
  agentSessionIds: string[];
  taskMonitorIds: string[];
  clientType?: 'cli' | 'browser';
  machineId?: MachineId;
  verifiedMachine?: boolean;
  authorizationProtocolVersion?: 1 | 2;
  connectedAt: Date;
  lastActivity: Date;
}
export interface EventSubscription {
  connectionId: string;
  eventTypes: string[];
  organizationId?: OrganizationId;
  projectIds?: ProjectId[];
  conversationIds?: ConversationId[];
  initiativeIds?: InitiativeId[];
  designDocIds?: DesignDocId[];
}
export interface BroadcastOptions {
  organizationId?: OrganizationId;
  projectId?: ProjectId;
  conversationId?: ConversationId;
  initiativeId?: InitiativeId;
  designDocId?: DesignDocId;
  userId?: UserId;
  excludeConnection?: string;
  excludeUserId?: string;
  source: string;
}

export type QueueStats = {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
};
