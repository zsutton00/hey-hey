import type {
  AgentSessionId,
  ArtifactId,
  ConversationId,
  DesignDocId,
  InitiativeId,
  MachineId,
  MessageId,
  OrganizationId,
  OrganizationMemberId,
  PlanId,
  PlanRelationshipId,
  ProjectId,
  ProposalId,
  ReportId,
  ServiceId,
  TaskId,
  UserId,
  WorkflowId,
} from '@hey-hey/contracts/brands';

/** Preserve resolved CLI identifiers when they cross a generated API boundary. */
export const toOpenApiAgentSessionId = (value: string): AgentSessionId =>
  value as AgentSessionId;

export const toOpenApiArtifactId = (value: string): ArtifactId =>
  value as ArtifactId;

export const toOpenApiConversationId = (value: string): ConversationId =>
  value as ConversationId;

export const toOpenApiDesignDocId = (value: string): DesignDocId =>
  value as DesignDocId;

export const toOpenApiInitiativeId = (value: string): InitiativeId =>
  value as InitiativeId;

export const toOpenApiMachineId = (value: string): MachineId =>
  value as MachineId;

export const toOpenApiMessageId = (value: string): MessageId =>
  value as MessageId;

export const toOpenApiOrganizationId = (value: string): OrganizationId =>
  value as OrganizationId;

export const toOpenApiOrganizationMemberId = (
  value: string,
): OrganizationMemberId => value as OrganizationMemberId;

export const toOpenApiPlanId = (value: string): PlanId => value as PlanId;

export const toOpenApiPlanRelationshipId = (
  value: string,
): PlanRelationshipId => value as PlanRelationshipId;

export const toOpenApiProjectId = (value: string): ProjectId =>
  value as ProjectId;

export const toOpenApiProposalId = (value: string): ProposalId =>
  value as ProposalId;

export const toOpenApiReportId = (value: string): ReportId =>
  value as ReportId;

export const toOpenApiServiceId = (value: string): ServiceId =>
  value as ServiceId;

export const toOpenApiTaskId = (value: string): TaskId => value as TaskId;

export const toOpenApiUserId = (value: string): UserId => value as UserId;

export const toOpenApiWorkflowId = (value: string): WorkflowId =>
  value as WorkflowId;
