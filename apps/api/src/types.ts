export type {
  ArtifactId,
  ApiKeyId,
  AgentSessionId,
  BrowserSessionFamilyId,
  BrowserSessionId,
  ConversationId,
  DesignDocId,
  DesignDocLinkId,
  EntitySubfacetId,
  EntitySummaryId,
  FeatureFlagId,
  FlowExecutionId,
  ImplementationHintId,
  InitiativeId,
  IntegrationId,
  InteractionTypeId,
  JobId,
  LlmId,
  MachineId,
  MessageId,
  MockLlmSessionId,
  OrganizationId,
  OrganizationMemberId,
  PasswordChangeCredentialId,
  PasswordChangeCredentialIdentifier,
  PlanId,
  PlanRelationshipId,
  ProjectId,
  PrivateBetaAccessRequestId,
  ProposalId,
  RefreshGenerationId,
  RefreshGenerationNumber,
  RefreshSecretHash,
  ReportId,
  RequestId,
  ServiceId,
  SubfacetId,
  TaskId,
  UserId,
  ValidationSessionId,
  WorkflowId,
} from '@hey-hey/contracts/brands';

export type WorkflowAboutType =
  | 'task'
  | 'initiative'
  | 'design-doc'
  | 'agent-session'
  | 'conversation'
  | 'project'
  | 'message'
  | 'proposal';

// Generic Id types

export interface ConversationHistoryEntry {
  role: 'USER' | 'SYSTEM' | 'QUESTION_ANSWER';
  content: string;
}
