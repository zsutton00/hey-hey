type Brand<K, T> = K & { __brand: T };

export type ProjectId = Brand<string, "ProjectId">;
export type UserId = Brand<string, "UserId">;
export type OrganizationId = Brand<string, "OrganizationId">;
export type ConversationId = Brand<string, "ConversationId">;
export type WorkflowId = Brand<string, "WorkflowId">;
export type MessageId = Brand<string, "MessageId">;
export type ArtifactId = Brand<string, "ArtifactId">;
export type ReportId = Brand<string, "ReportId">;
export type InteractionTypeId = Brand<string, "InteractionTypeId">;
export type OrganizationMemberId = Brand<string, "OrganizationMemberId">;
export type RequestId = Brand<string, "RequestId">;
export type JobId = Brand<string, "JobId">;
export type InitiativeId = Brand<string, "InitiativeId">;
export type TaskId = Brand<string, "TaskId">;
export type IntegrationId = Brand<string, "IntegrationId">;
export type LlmId = Brand<string, "LlmId">;
export type ImplementationHintId = Brand<string, "ImplementationHintId">;
export type ValidationSessionId = Brand<string, "ValidationSessionId">;
export type MachineId = Brand<string, "MachineId">;
export type DesignDocId = Brand<string, "DesignDocId">;
export type DesignDocLinkId = Brand<string, "DesignDocLinkId">;
export type AgentSessionId = Brand<string, "AgentSessionId">;
export type ServiceId = Brand<string, "ServiceId">;
export type PlanId = Brand<string, "PlanId">;
export type PlanRelationshipId = Brand<string, "PlanRelationshipId">;
export type ProposalId = Brand<string, "ProposalId">;
export type SubfacetId = Brand<string, "SubfacetId">;
export type PrivateBetaAccessRequestId = Brand<
  string,
  "PrivateBetaAccessRequestId"
>;
export type FlowExecutionId = Brand<string, "FlowExecutionId">;
export type FeatureFlagId = Brand<string, "FeatureFlagId">;
export type ApiKeyId = Brand<string, "ApiKeyId">;
export type EntitySummaryId = Brand<string, "EntitySummaryId">;
export type EntitySubfacetId = Brand<string, "EntitySubfacetId">;
export type MockLlmSessionId = Brand<string, "MockLlmSessionId">;
export type BrowserSessionId = Brand<string, "BrowserSessionId">;
export type BrowserSessionFamilyId = Brand<string, "BrowserSessionFamilyId">;
export type RefreshGenerationId = Brand<string, "RefreshGenerationId">;
export type RefreshGenerationNumber = Brand<number, "RefreshGenerationNumber">;
export type RefreshSecretHash = Brand<string, "RefreshSecretHash">;
export type PasswordChangeCredentialId = Brand<
  string,
  "PasswordChangeCredentialId"
>;
export type PasswordChangeCredentialIdentifier = Brand<
  string,
  "PasswordChangeCredentialIdentifier"
>;
