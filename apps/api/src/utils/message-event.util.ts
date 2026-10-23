import { BadRequestException } from '@nestjs/common';
import { EVENT_TYPES } from '../core/events/types/event.types';
import type {
  AgentTrigger,
  CreateSystemMessage,
  CreateUserMessage,
  ExternalAgentNodeCompletion,
  MessageCreatedEventPayload,
  MessageCreatedParentMessage,
  MessageCreatedUserMessage,
  MessageDeletedEventPayload,
  MessageMention,
  MessageUpdatedEventPayload,
  MentionCreatedEventPayload,
  MentionRemovedEventPayload,
  SystemMessageData,
  UserMessageData,
} from '../generated';
import type {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../types';
import { MessageContentExtractor } from './message-content-extractor';
import { getContentFromMessageData } from './message-content.util';

const IS_PROBABLY_JSON = /^(\[.*\]|\{.*\})$/;

type CreateMessageInput = CreateUserMessage | CreateSystemMessage;

type ParentMessageRecord = {
  id: MessageId;
  type: string;
  data?: SystemMessageData | UserMessageData | null;
};

type MessageUpdateInput = {
  status?: string;
  data?: Record<string, unknown>;
  parentMessageId?: string;
};

type LoggerLike = {
  debug?: (message: string, meta?: Record<string, unknown>) => void;
};

export function buildParentMessageSummary(params: {
  parentMessage: ParentMessageRecord | null | undefined;
  parentMessageId: MessageId | null | undefined;
}): MessageCreatedParentMessage | null {
  if (!params.parentMessageId) {
    return null;
  }

  if (!params.parentMessage) {
    throw new BadRequestException(
      `[publishMessageCreatedEvent] Missing parent message for ${params.parentMessageId}`,
    );
  }

  if (params.parentMessage.id !== params.parentMessageId) {
    throw new BadRequestException(
      `[publishMessageCreatedEvent] Parent message mismatch for ${params.parentMessageId}`,
    );
  }

  const parentContent = getContentFromMessageData(
    params.parentMessage.type as 'USER' | 'SYSTEM',
    params.parentMessage.data ?? undefined,
  );

  if (!parentContent) {
    return null;
  }

  return {
    id: params.parentMessageId,
    content: parentContent,
  };
}

export function extractMessageEventContent(params: {
  createMessage?: CreateMessageInput;
  update?: MessageUpdateInput;
  parentMessageContent?: string | null;
  /** Eval output is retained but never processed, whatever its data says. */
  inert?: boolean;
  logger?: LoggerLike;
}): { userMessage?: string; systemMessage?: string; shouldProcess: boolean } {
  const result = extractUnforcedMessageEventContent(params);
  return params.inert ? { ...result, shouldProcess: false } : result;
}

function extractUnforcedMessageEventContent(params: {
  createMessage?: CreateMessageInput;
  update?: MessageUpdateInput;
  parentMessageContent?: string | null;
  logger?: LoggerLike;
}): { userMessage?: string; systemMessage?: string; shouldProcess: boolean } {
  const { createMessage, update, parentMessageContent, logger } = params;

  if (createMessage?.type === 'USER') {
    const userMessage = MessageContentExtractor.extractMessageContent(
      createMessage as CreateUserMessage,
    );
    const combinedLength =
      userMessage.length + (parentMessageContent?.length ?? 0);
    const shouldProcess =
      !IS_PROBABLY_JSON.test(userMessage) && combinedLength > 50;
    logger?.debug?.('[extractContent] extracting content for user message', {
      createMessage,
      parentMessageContent,
      combinedLength,
      userMessage,
      shouldProcess,
    });

    return {
      userMessage,
      shouldProcess,
    };
  }

  if (update?.status === 'completed' || update?.status === 'streaming_ready') {
    return {
      systemMessage: '',
      shouldProcess: false,
    };
  }

  const updateData =
    update?.data && typeof update.data === 'object' ? update.data : undefined;
  if (updateData && hasStringField(updateData, 'response')) {
    const systemMessage = updateData.response;
    const ragEnabled = hasBooleanField(updateData, 'ragEnabled')
      ? updateData.ragEnabled
      : undefined;
    const shouldProcess =
      !IS_PROBABLY_JSON.test(systemMessage) && systemMessage.length > 50;
    logger?.debug?.(
      '[extractContent] extracting content for system message update',
      {
        createMessage,
        systemMessage,
        shouldProcess,
      },
    );
    return {
      systemMessage,
      shouldProcess: ragEnabled === false ? false : shouldProcess,
    };
  }

  if (createMessage?.data && createMessage.data.type === 'ROUTING') {
    return {
      shouldProcess: false,
      systemMessage: '',
    };
  }

  const createData =
    createMessage?.data && typeof createMessage.data === 'object'
      ? createMessage.data
      : undefined;
  const ragEnabled =
    createData && hasBooleanField(createData, 'ragEnabled')
      ? createData.ragEnabled
      : undefined;
  const shouldProcess = createMessage !== undefined && ragEnabled !== false;
  logger?.debug?.(
    '[extractContent] extracting content for system message creation',
    {
      createMessage,
      ragEnabled,
      shouldProcess,
    },
  );

  return {
    systemMessage: '',
    shouldProcess,
  };
}

export function buildMessageCreatedEventPayload(
  params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    workflowId?: WorkflowId;
    conversationId: ConversationId;
    message: CreateMessageInput;
    parentMessage?: ParentMessageRecord | null;
    nodeId?: string;
    mentions?: MessageMention[];
  },
  logger?: LoggerLike,
): MessageCreatedEventPayload {
  const parentMessageSummary =
    params.message.type === 'USER'
      ? buildParentMessageSummary({
          parentMessage: params.parentMessage,
          parentMessageId: params.message.parentMessageId,
        })
      : null;

  const content = extractMessageEventContent({
    createMessage: params.message,
    parentMessageContent: parentMessageSummary?.content,
    inert: hasRagDisabled(params.message.data),
    logger,
  });

  const messageRest =
    params.message.type === 'SYSTEM'
      ? (({
          data: _createdData,
          proposalIds: _proposalIds,
          reportIds: _reportIds,
          ...rest
        }) => rest)(params.message as CreateSystemMessage)
      : (({ data: _createdData, ...rest }) => rest)(params.message);
  const messagePayload: MessageCreatedEventPayload['message'] =
    params.message.type === 'USER'
      ? (Object.assign(
          {},
          messageRest,
          content,
          parentMessageSummary ? { parentMessage: parentMessageSummary } : {},
        ) as MessageCreatedUserMessage)
      : Object.assign({}, messageRest, content);

  const data = extractMessageDataObject(params.message);
  const messageDataType = data?.type;

  return {
    payloadType: EVENT_TYPES.MESSAGE.CREATED,
    organizationId: params.organizationId,
    projectId: params.projectId,
    workflowId: params.workflowId,
    conversationId: params.conversationId,
    nodeId: params.nodeId,
    message: messagePayload,
    messageDataType:
      typeof messageDataType === 'string' ? messageDataType : undefined,
    completesExternalAgentNode: data?.completesExternalAgentNode,
    triggersAgent: data?.triggersAgent,
    triggerNotification: data?.triggerNotification,
    mentions: params.mentions,
  };
}

export function buildMentionCreatedEventPayload(params: {
  organizationId: OrganizationId;
  projectId: ProjectId;
  workflowId?: WorkflowId;
  sourceEntityId: string;
  sourceEntityType: MentionCreatedEventPayload.SourceEntityTypeEnum;
  conversationId?: ConversationId;
  messageId?: MessageId;
  workflowAboutId?: string;
  workflowAboutType?: string;
  entityId: string;
  entityType: MentionCreatedEventPayload.EntityTypeEnum;
  nodeId?: string;
  userId?: UserId;
}): MentionCreatedEventPayload {
  return {
    payloadType: EVENT_TYPES.MENTION.CREATED,
    organizationId: params.organizationId,
    projectId: params.projectId,
    workflowId: params.workflowId,
    sourceEntityId: params.sourceEntityId,
    sourceEntityType: params.sourceEntityType,
    conversationId: params.conversationId,
    messageId: params.messageId,
    workflowAboutId: params.workflowAboutId,
    workflowAboutType: params.workflowAboutType,
    entityId: params.entityId,
    entityType: params.entityType,
    nodeId: params.nodeId,
    userId: params.userId,
  };
}

export function buildMentionRemovedEventPayload(params: {
  organizationId: OrganizationId;
  projectId: ProjectId;
  workflowId?: WorkflowId;
  sourceEntityId: string;
  sourceEntityType: MentionRemovedEventPayload.SourceEntityTypeEnum;
  conversationId?: ConversationId;
  entityId: string;
  entityType: MentionRemovedEventPayload.EntityTypeEnum;
  userId?: UserId;
}): MentionRemovedEventPayload {
  return {
    payloadType: EVENT_TYPES.MENTION.REMOVED,
    organizationId: params.organizationId,
    projectId: params.projectId,
    workflowId: params.workflowId,
    sourceEntityId: params.sourceEntityId,
    sourceEntityType: params.sourceEntityType,
    conversationId: params.conversationId,
    entityId: params.entityId,
    entityType: params.entityType,
    userId: params.userId,
  };
}

export function buildMessageUpdatedEventPayload(
  params: {
    workflowId?: WorkflowId;
    nodeId?: string;
    organizationId: OrganizationId;
    projectId: ProjectId;
    conversationId: ConversationId;
    update: Omit<MessageUpdatedEventPayload['update'], 'contentChanged'> & {
      data?: Record<string, unknown>;
    };
    /** True when the message was produced under an eval attempt. */
    inert?: boolean;
  },
  logger?: LoggerLike,
): MessageUpdatedEventPayload {
  const { systemMessage, shouldProcess } = extractMessageEventContent({
    update: params.update,
    inert: params.inert,
    logger,
  });

  const { data: _updateData, ...updateRest } = params.update;
  const updatePayload: MessageUpdatedEventPayload['update'] = {
    ...(updateRest as MessageUpdatedEventPayload['update']),
    // `data` is stripped from the event, so consumers need this to tell
    // content edits apart from status/execution bookkeeping.
    contentChanged: params.update.data !== undefined,
    shouldProcess,
    ...(systemMessage !== undefined ? { systemMessage } : {}),
  };

  const data = extractRoutingFields(params.update.data);

  return {
    payloadType: EVENT_TYPES.MESSAGE.UPDATED,
    workflowId: params.workflowId,
    nodeId: params.nodeId,
    organizationId: params.organizationId,
    projectId: params.projectId,
    conversationId: params.conversationId,
    update: updatePayload,
    messageDataType: typeof data?.type === 'string' ? data.type : undefined,
    completesExternalAgentNode: data?.completesExternalAgentNode,
    triggersAgent: data?.triggersAgent,
  };
}

export function buildMessageDeletedEventPayload(params: {
  organizationId: OrganizationId;
  projectId: ProjectId;
  conversationId: ConversationId;
  workflowId?: WorkflowId;
  deletedBy: string;
}): MessageDeletedEventPayload {
  return {
    payloadType: EVENT_TYPES.MESSAGE.DELETED,
    organizationId: params.organizationId,
    projectId: params.projectId,
    conversationId: params.conversationId,
    workflowId: params.workflowId,
    deletedBy: params.deletedBy,
  };
}

function hasStringField(
  data: object,
  key: 'response',
): data is { response: string } {
  return typeof (data as { response?: unknown }).response === 'string';
}

function hasBooleanField(
  data: object,
  key: 'ragEnabled',
): data is { ragEnabled: boolean } {
  return typeof (data as { ragEnabled?: unknown }).ragEnabled === 'boolean';
}

type RoutingFields = {
  type?: string;
  completesExternalAgentNode?: ExternalAgentNodeCompletion;
  triggersAgent?: AgentTrigger;
  triggerNotification?: boolean;
};

function extractMessageDataObject(
  message: CreateMessageInput,
): RoutingFields | undefined {
  return extractRoutingFields(
    (message as CreateMessageInput).data as Record<string, unknown> | undefined,
  );
}

function extractRoutingFields(
  data: Record<string, unknown> | undefined,
): RoutingFields | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  const bag = data as RoutingFields;
  return {
    type: typeof bag.type === 'string' ? bag.type : undefined,
    completesExternalAgentNode: bag.completesExternalAgentNode,
    triggersAgent: bag.triggersAgent,
    triggerNotification:
      typeof bag.triggerNotification === 'boolean'
        ? bag.triggerNotification
        : undefined,
  };
}

/** Eval output is written with ragEnabled false, which USER messages would otherwise ignore. */
export function hasRagDisabled(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { ragEnabled?: unknown }).ragEnabled === false
  );
}
