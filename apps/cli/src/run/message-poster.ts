/**
 * Message-write transport owner. Generic create/update/complete remain
 * projection-only; executable workflow completion uses its typed API client.
 * FIFO queue serialization for concurrent operation safety.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { messageWriteFailureSchema } from './message-write-diagnostics';
import { MessageStatus, MessageType, SystemMessageDataTypeEnum } from '../shared/api/index';
import type {
  CreateSystemMessage,
  CreateUserMessage,
  SubmitExecutableUserMessageRequestDto,
  UpdateMessageDto,
} from '../shared/api/generated/api';
import type { ServerLogger } from '../server/logger';
import type {
  MessagePosterApiClient,
  MessagePosterCreateOutOfBandArgs,
  MessagePosterExternalAgentCompletionArgs,
  MessageStamp,
  CreateMessageBody,
} from './types';

/**
 * PostOperation — discriminated union for queued operations
 *
 * Each variant carries the operation-specific parameters needed for execution.
 * The queue drains serially, preserving FIFO ordering across all operation types.
 */
type PostOperation =
  | {
      type: 'createOutOfBand';
      args: MessagePosterCreateOutOfBandArgs;
      resolve: (messageId: string) => void;
      reject: (error: unknown) => void;
    }
  | {
      type: 'update';
      organizationId: string;
      projectId: string;
      messageId: string;
      data: UpdateMessageDto;
      stamp: MessageStamp | null;
    }
  | {
      type: 'externalAgentCompletion';
      args: MessagePosterExternalAgentCompletionArgs;
      resolve: (messageId: string) => void;
      reject: (error: unknown) => void;
    }
  | {
      type: 'complete';
      organizationId: string;
      projectId: string;
      messageId: string;
      data: UpdateMessageDto;
      stamp: MessageStamp | null;
    };

const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 8000, 8000, 8000, 8000] as const;
const MAX_PERSISTED_MESSAGES = 500;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isTransientError = (error: unknown): boolean => {
  if (!isRecord(error)) return true;
  const response = isRecord(error['response']) ? error['response'] : null;
  if (!response) return true;
  const status = typeof response['status'] === 'number' ? response['status'] : null;
  if (status === null) return true;
  return status !== 400 && status !== 401 && status !== 403 && status !== 409;
};

// Agents are instructed to write `@[type:id|title]` mentions, but sometimes
// emit them as `@\[type:id|title]` (markdown-escaped). The UI only renders
// the unescaped form as a clickable link, so strip the escape on the way out.
const AGENT_MENTION_ESCAPE_RE = /@\\+\[/g;

const stripAgentMentionEscapes = <T>(value: T): T => {
  if (typeof value === 'string') {
    return value.replace(AGENT_MENTION_ESCAPE_RE, '@[') as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => stripAgentMentionEscapes(v)) as unknown as T;
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = stripAgentMentionEscapes(v);
    }
    return out as unknown as T;
  }
  return value;
};

const SYSTEM_MESSAGE_DATA_TYPES: ReadonlySet<string> = new Set(
  Object.values(SystemMessageDataTypeEnum),
);

const isSystemMessageData = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  typeof value['type'] === 'string' &&
  SYSTEM_MESSAGE_DATA_TYPES.has(value['type']);

/**
 * Merge `providerSessionId` / `promptHandler` onto a SystemMessageData payload
 * so every Turn-authored SYSTEM message records which SDK session and prompt
 * handler produced it. A `null` stamp leaves `data` unchanged. Individual
 * `null` fields on the stamp are treated as omit-from-data — the
 * user-decision-dispatch path posts without a Turn and lands here with both
 * fields null.
 */
const stampSystemMessageData = <T>(data: T, stamp: MessageStamp | null): T => {
  if (!stamp) return data;
  if (!isSystemMessageData(data)) return data;
  const next: Record<string, unknown> = { ...data };
  if (stamp.providerSessionId !== null) next['providerSessionId'] = stamp.providerSessionId;
  if (stamp.promptHandler !== null) next['promptHandler'] = stamp.promptHandler;
  return next as T;
};

export const stampCreateBody = <T extends { type: MessageType; data: unknown }>(
  dto: T,
  stamp: MessageStamp | null,
): T => {
  if (!stamp) return dto;
  if (dto.type !== MessageType.System) return dto;
  return { ...dto, data: stampSystemMessageData(dto.data, stamp) };
};

export const stampUpdateData = (
  data: UpdateMessageDto,
  stamp: MessageStamp | null,
): UpdateMessageDto => {
  if (!stamp) return data;
  if (!data.data) return data;
  return { ...data, data: stampSystemMessageData(data.data, stamp) };
};

const summarizeMessageData = (data: unknown): Record<string, unknown> => {
  if (!isRecord(data)) return { shape: 'non-object' };
  const inner = isRecord(data['data']) ? data['data'] : null;
  const uiElements = inner && Array.isArray(inner['uiElements']) ? inner['uiElements'] : null;
  return {
    status: data['status'],
    dataType: inner?.['type'],
    processResponseType: inner?.['processResponseType'],
    title: inner?.['title'],
    detectedIntent: inner?.['detectedIntent'],
    actionHint: inner?.['actionHint'],
    uiElementCount: uiElements?.length,
    uiElementTypes: uiElements?.map((el) => (isRecord(el) ? el['type'] : null)),
  };
};

const extractMessageId = (response: unknown): string | null => {
  if (!isRecord(response)) return null;
  const data = isRecord(response['data']) ? response['data'] : null;
  const inner = data && isRecord(data['data']) ? data['data'] : null;
  const id = inner?.['id'];
  return typeof id === 'string' && id.trim().length > 0 ? id : null;
};

interface PersistedMessage {
  organizationId: string;
  projectId: string;
  messageDto: CreateSystemMessage | CreateUserMessage | SubmitExecutableUserMessageRequestDto;
  timestamp: string;
}

const persistFailedMessage = async (
  filePath: string,
  entry: PersistedMessage,
  logger: ServerLogger,
): Promise<void> => {
  try {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    let lineCount = 0;
    try {
      const existing = await fs.readFile(filePath, 'utf-8');
      lineCount = existing.split('\n').filter(Boolean).length;
    } catch {
      // File doesn't exist yet.
    }

    if (lineCount >= MAX_PERSISTED_MESSAGES) {
      logger.warn('local.message_poster.persist_cap_reached', { lineCount });
      return;
    }

    await fs.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (error) {
    logger.error('local.message_poster.persist_failed', { error });
  }
};

function isSystemCreateBody(
  dto: CreateMessageBody,
): dto is Omit<CreateSystemMessage, 'conversationId' | 'parentMessageId'> {
  return dto.type === MessageType.System;
}

export interface MessagePosterDependencies {
  /** Fixed for the lifetime of this execution, including queued retries. */
  readonly inert?: boolean;
  apiClient: MessagePosterApiClient;
  logger: ServerLogger;
  dataDir: string;
}

export class MessagePoster {
  private readonly failedMessagesPath: string;
  private readonly queue: PostOperation[] = [];
  private isProcessing = false;
  private isCleanupCalled = false;

  public inertSibling(): MessagePoster {
    return new MessagePoster({ ...this.dependencies, inert: true });
  }

  public constructor(private readonly dependencies: MessagePosterDependencies) {
    this.failedMessagesPath = path.join(dependencies.dataDir, 'failed-messages.jsonl');
  }

  private async callWithRetry<T>(
    call: () => Promise<T>,
    context: {
      organizationId: string;
      projectId: string;
      conversationId: string | null;
      operation?: 'external_agent_completion';
      agentSessionId?: string;
      effectId?: string;
      workflowNodeId?: string;
      pendingTriggerMessageId?: string;
      action?: string;
    },
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        return await call();
      } catch (error) {
        const transient = isTransientError(error);
        const diagnostics = messageWriteFailureSchema.safeParse(error);
        this.dependencies.logger.warn('local.message_poster.attempt_failed', {
          ...context,
          attempt: attempt + 1,
          retryScheduled: transient && attempt < RETRY_DELAYS_MS.length,
          transient,
          ...(diagnostics.success ? diagnostics.data : { diagnosticsUnavailable: true }),
        });
        if (!transient) throw error;
        lastError = error;
        if (attempt < RETRY_DELAYS_MS.length) {
          this.dependencies.logger.warn('local.message_poster.retry', {
            ...context,
            attempt: attempt + 1,
            delayMs: RETRY_DELAYS_MS[attempt],
          });
          await delay(RETRY_DELAYS_MS[attempt]!);
        }
      }
    }
    throw lastError;
  }

  /**
   * Enqueue an operation and trigger drain.
   *
   * Pushes the operation onto the queue and immediately triggers drain.
   * The drain function processes entries serially, preserving FIFO ordering.
   */
  private enqueue(operation: PostOperation): void {
    this.queue.push(operation);
    // Trigger async drain without awaiting
    // Only trigger if not already processing and cleanup hasn't been called
    if (!this.isProcessing && !this.isCleanupCalled) {
      this.drain().catch((error) => {
        this.dependencies.logger.error('local.message_poster.drain_error', { error });
      });
    }
  }

  /**
   * Drain the queue serially.
   *
   * Processes queue entries one at a time, preserving FIFO ordering.
   * While operations are pending, sets isProcessing to prevent concurrent drains.
   * Each operation type invokes the corresponding existing postWithRetry or apiClient call.
   * Stops processing if cleanup is called, leaving remaining entries for cleanup to persist.
   */
  private async drain(): Promise<void> {
    if (this.isProcessing) {
      return; // Already draining, will process this entry when the current drain completes
    }

    while (this.queue.length > 0 && !this.isProcessing && !this.isCleanupCalled) {
      this.isProcessing = true;
      const operation = this.queue.shift()!; // Remove from front of queue

      try {
        switch (operation.type) {
          case 'createOutOfBand': {
            const messageId = await this.executeCreateOutOfBand(operation.args);
            operation.resolve(messageId);
            break;
          }
          case 'externalAgentCompletion': {
            const submit = this.dependencies.apiClient.submitExternalAgentCompletion;
            if (!submit) {
              throw new Error('External-agent completion client is not configured.');
            }
            const messageId = await this.callWithRetry(() => submit(operation.args), {
              organizationId: operation.args.organizationId,
              projectId: operation.args.projectId,
              conversationId: operation.args.request['conversationId'],
              operation: 'external_agent_completion',
              agentSessionId: operation.args.agentSessionId,
              effectId: operation.args.effectId,
              workflowNodeId: operation.args.request['workflowNodeId'],
              pendingTriggerMessageId: operation.args.request['pendingTriggerMessageId'],
              action: operation.args.request['action'],
            });
            operation.resolve(messageId);
            break;
          }
          case 'update': {
            await this.executeUpdate(
              operation.organizationId,
              operation.projectId,
              operation.messageId,
              operation.data,
              operation.stamp,
            );
            break;
          }
          case 'complete': {
            await this.executeComplete(
              operation.organizationId,
              operation.projectId,
              operation.messageId,
              operation.data,
              operation.stamp,
            );
            break;
          }
        }
      } catch (error) {
        if (operation.type === 'createOutOfBand' || operation.type === 'externalAgentCompletion') {
          operation.reject(error);
        } else {
          // Update/complete are fire-and-forget, just log
          this.dependencies.logger.error('local.message_poster.operation_failed', {
            type: operation.type,
            error,
          });
        }
      } finally {
        this.isProcessing = false;
      }
    }
  }

  /**
   * Execute createOutOfBand operation with retry.
   *
   * Posts the message, extracts the messageId from the response, and returns it.
   * Retries on transient errors, persists on final failure.
   */
  private async executeCreateOutOfBand(args: MessagePosterCreateOutOfBandArgs): Promise<string> {
    const baseDto = {
      ...args.dto,
      conversationId: args.conversationId,
    } as CreateSystemMessage | CreateUserMessage | SubmitExecutableUserMessageRequestDto;
    const stampedDto = stampCreateBody(baseDto, args.stamp);
    const dto =
      stampedDto.type === MessageType.System ? stripAgentMentionEscapes(stampedDto) : stampedDto;

    this.dependencies.logger.info('local.message_poster.create_out_of_band', {
      conversationId: args.conversationId,
      projectId: args.projectId,
      providerSessionId: args.stamp?.providerSessionId,
      promptHandler: args.stamp?.promptHandler,
      proposalIds: 'proposalIds' in dto ? dto.proposalIds : undefined,
      reportIds: 'reportIds' in dto ? dto.reportIds : undefined,
      messageType: args.dto.type,
      dto: summarizeMessageData(dto),
    });

    const response = await this.postWithRetry(args.organizationId, args.projectId, dto);
    const messageId = extractMessageId(response);
    if (!messageId) {
      throw new Error('API response did not contain a message ID');
    }

    this.dependencies.logger.info('local.message_poster.created', {
      messageId,
      conversationId: args.conversationId,
      proposalIds: 'proposalIds' in dto ? dto.proposalIds : undefined,
      reportIds: 'reportIds' in dto ? dto.reportIds : undefined,
    });
    return messageId;
  }

  /**
   * Execute update operation with direct API call.
   *
   * Updates an in-progress message with intermediate content.
   * No retry — update is fire-and-forget for completion messages.
   */
  private async executeUpdate(
    organizationId: string,
    projectId: string,
    messageId: string,
    data: UpdateMessageDto,
    stamp: MessageStamp | null,
  ): Promise<void> {
    const stamped = stampUpdateData(data, stamp);
    const sanitized = stripAgentMentionEscapes(stamped);
    this.dependencies.logger.info('local.message_poster.update', {
      messageId,
      data: summarizeMessageData(sanitized),
    });
    try {
      await this.dependencies.apiClient.updateMessage({
        id: messageId,
        projectId,
        organizationId,
        updateMessageDto: sanitized,
      });
      this.dependencies.logger.info('local.message_poster.updated', { messageId });
    } catch (error) {
      this.dependencies.logger.error('local.message_poster.update_failed', { messageId, error });
      throw error;
    }
  }

  /**
   * Execute complete operation with direct API call.
   *
   * Completes a message with final content and status transition.
   * No retry — complete is fire-and-forget for completion messages.
   */
  private async executeComplete(
    organizationId: string,
    projectId: string,
    messageId: string,
    data: UpdateMessageDto,
    stamp: MessageStamp | null,
  ): Promise<void> {
    const stamped = stampUpdateData(data, stamp);
    const withStatus = stripAgentMentionEscapes({
      ...stamped,
      status: stamped.status ?? MessageStatus.Completed,
    });
    this.dependencies.logger.info('local.message_poster.complete', {
      messageId,
      data: summarizeMessageData(withStatus),
    });
    try {
      await this.dependencies.apiClient.updateMessage({
        id: messageId,
        projectId,
        organizationId,
        updateMessageDto: withStatus,
      });
      this.dependencies.logger.info('local.message_poster.completed', { messageId });
    } catch (error) {
      this.dependencies.logger.error('local.message_poster.complete_failed', { messageId, error });
      throw error;
    }
  }

  private async postWithRetry(
    organizationId: string,
    projectId: string,
    dto: CreateSystemMessage | CreateUserMessage | SubmitExecutableUserMessageRequestDto,
  ): Promise<unknown> {
    const conversationId = 'conversationId' in dto ? (dto.conversationId ?? null) : null;
    try {
      return await this.callWithRetry(
        () =>
          this.dependencies.apiClient.postMessage({
            organizationId,
            projectId,
            createMessageDto: dto,
          }),
        { organizationId, projectId, conversationId },
      );
    } catch (error) {
      if (isTransientError(error)) {
        await persistFailedMessage(
          this.failedMessagesPath,
          {
            organizationId,
            projectId,
            messageDto: dto,
            timestamp: new Date().toISOString(),
          },
          this.dependencies.logger,
        );
      }
      throw error;
    }
  }

  public async createOutOfBand(args: MessagePosterCreateOutOfBandArgs): Promise<string> {
    if (this.dependencies.inert) {
      const dto = args.dto;
      if (!isSystemCreateBody(dto)) {
        throw new Error('Inert execution cannot submit executable user input.');
      }
      args = {
        ...args,
        dto: { ...dto, type: MessageType.System, data: { ...dto.data, ragEnabled: false } },
      };
    }
    return new Promise<string>((resolve, reject) => {
      this.enqueue({
        type: 'createOutOfBand',
        args,
        resolve,
        reject,
      });
    });
  }

  public async submitExternalAgentCompletion(
    args: MessagePosterExternalAgentCompletionArgs,
  ): Promise<string> {
    if (this.dependencies.inert) {
      throw new Error('Inert execution cannot complete live workflow work.');
    }
    return new Promise<string>((resolve, reject) => {
      this.enqueue({
        type: 'externalAgentCompletion',
        args,
        resolve,
        reject,
      });
    });
  }

  public async update(
    organizationId: string,
    projectId: string,
    messageId: string,
    data: UpdateMessageDto,
    stamp: MessageStamp | null,
  ): Promise<void> {
    this.enqueue({
      type: 'update',
      organizationId,
      projectId,
      messageId,
      data: this.dependencies.inert ? { ...data, data: { ...data.data, ragEnabled: false } } : data,
      stamp,
    });
    // Fire-and-forget: return immediately without awaiting
  }

  public async complete(
    organizationId: string,
    projectId: string,
    messageId: string,
    data: UpdateMessageDto,
    stamp: MessageStamp | null,
  ): Promise<void> {
    this.enqueue({
      type: 'complete',
      organizationId,
      projectId,
      messageId,
      data: this.dependencies.inert ? { ...data, data: { ...data.data, ragEnabled: false } } : data,
      stamp,
    });
    // Fire-and-forget: return immediately without awaiting
  }

  public async cleanup(): Promise<void> {
    // Signal to drain to stop after current operation
    this.isCleanupCalled = true;

    // Wait for any in-flight operation to complete
    while (this.isProcessing) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Persist any remaining queue entries to failed-messages.jsonl
    while (this.queue.length > 0) {
      const operation = this.queue.shift()!;

      // Only createOutOfBand operations have data worth persisting
      if (operation.type === 'createOutOfBand') {
        const baseDto = {
          ...operation.args.dto,
          conversationId: operation.args.conversationId,
        } as CreateSystemMessage | CreateUserMessage | SubmitExecutableUserMessageRequestDto;
        const stampedDto = stampCreateBody(baseDto, operation.args.stamp);
        const dto =
          stampedDto.type === MessageType.System
            ? stripAgentMentionEscapes(stampedDto)
            : stampedDto;

        await persistFailedMessage(
          this.failedMessagesPath,
          {
            organizationId: operation.args.organizationId,
            projectId: operation.args.projectId,
            messageDto: dto,
            timestamp: new Date().toISOString(),
          },
          this.dependencies.logger,
        );

        // Reject the pending promise since we're not actually executing it
        operation.reject(
          new Error('MessagePoster cleanup: operation persisted instead of executed'),
        );
      } else if (operation.type === 'externalAgentCompletion') {
        operation.reject(new Error('MessagePoster cleanup: completion was not executed'));
      }
      // Update and complete are fire-and-forget, no persistence needed
    }
  }
}
