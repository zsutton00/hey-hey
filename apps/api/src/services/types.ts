import { Prisma, Proposal } from '@prisma/client';
import { SystemMessageData } from 'src/generated';
import { ConversationId, MessageId, ProjectId, WorkflowId } from 'src/types';

export type MessageWithRelations = Omit<
  Prisma.MessageGetPayload<{
    include: { responses: true; parentMessage: true };
  }>,
  | 'id'
  | 'projectId'
  | 'conversationId'
  | 'parentMessageId'
  | 'responses'
  | 'parentMessage'
> & {
  id: MessageId;
  projectId: ProjectId;
  conversationId: ConversationId;
  parentMessageId: MessageId | null;
  data: SystemMessageData | Prisma.JsonValue;
  responses: MessageWithRelations[];
  parentMessage: MessageWithRelations | null;
  proposals?: Proposal[];
};

export type ResolvedUser = {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MessageQueryResult = {
  executionStatus?: import('../generated').MessageExecutionStatus | null;
  executionOperationId?: string | null;
  executionAdmissionId?: string | null;
  executionAdmissionDisposition?:
    | import('@prisma/client').MessageExecutionAdmissionDisposition
    | null;
  executionCancellationRequested?: boolean;

  id: string;
  projectId: ProjectId;
  status: string;
  userId: string | null;
  data: unknown;
  conversationId: ConversationId;
  parentMessageId: MessageId | null;
  createdAt: Date | null;
  contentUpdatedAt?: Date | null;
  type: string;
  conversation?: { workflowId: WorkflowId | null };
  responses?: MessageQueryResult[];
  parentMessage?: MessageQueryResult | null;
  user?: ResolvedUser | null;
  proposals?: Proposal[];
};
