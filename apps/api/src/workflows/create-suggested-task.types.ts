import {
  ConversationId,
  InitiativeId,
  MessageId,
  OrganizationId,
  ProjectId,
  TaskId,
} from 'src/types';

export type CreateSuggestedTaskWorkflowInput = {
  organizationId: OrganizationId;
  projectId: ProjectId;
  initiativeId: InitiativeId;
  name: string;
  description?: string;
  parentTaskId?: TaskId;
  sourceConversationId: ConversationId;
  sourceMessageId: MessageId;
  trigger?: string;
};

export type CreateSuggestedTaskRunResult = {
  workflowId: string;
  taskIds?: string[];
  error?: string;
};
