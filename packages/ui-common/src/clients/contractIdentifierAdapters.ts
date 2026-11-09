import type {
  AgentSessionId,
  ConversationId,
  InitiativeId,
  MessageId,
  OrganizationId,
  PlanId,
  ProjectId,
  ProposalId,
  ServiceId,
  TaskId,
  UserId,
  WorkflowId,
} from "@hey-hey/contracts/brands";

/** Preserve the app's resolved identifier at a generated-contract boundary. */
export const toOpenApiAgentSessionId = (value: string): AgentSessionId =>
  value as AgentSessionId;

export const toOpenApiConversationId = (value: string): ConversationId =>
  value as ConversationId;

export const toOpenApiInitiativeId = (value: string): InitiativeId =>
  value as InitiativeId;

export const toOpenApiMessageId = (value: string): MessageId =>
  value as MessageId;

export const toOpenApiOrganizationId = (value: string): OrganizationId =>
  value as OrganizationId;

export const toOpenApiPlanId = (value: string): PlanId => value as PlanId;

export const toOpenApiProjectId = (value: string): ProjectId =>
  value as ProjectId;

export const toOpenApiProposalId = (value: string): ProposalId =>
  value as ProposalId;

export const toOpenApiServiceId = (value: string): ServiceId =>
  value as ServiceId;

export const toOpenApiTaskId = (value: string): TaskId => value as TaskId;

export const toOpenApiUserId = (value: string): UserId => value as UserId;

export const toOpenApiWorkflowId = (value: string): WorkflowId =>
  value as WorkflowId;
