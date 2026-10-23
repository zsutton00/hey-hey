import {
  ConversationId,
  InitiativeId,
  MessageId,
  OrganizationId,
  ProjectId,
  TaskId,
} from 'src/types';
import type { DesignDocTemplate } from 'src/generated';

export type CreateSuggestedDesignDocWorkflowInput = {
  organizationId: OrganizationId;
  projectId: ProjectId;
  name: string;
  description?: string;
  template: DesignDocTemplate;
  initiativeId?: InitiativeId;
  taskId?: TaskId;
  sourceConversationId: ConversationId;
  sourceMessageId: MessageId;
  trigger?: string;
};

export type CreateSuggestedDesignDocRunResult = {
  workflowId: string;
  designDocId?: string;
  error?: string;
};
