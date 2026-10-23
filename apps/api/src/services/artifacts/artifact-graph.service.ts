import { Injectable, Logger } from '@nestjs/common';
import { isQaPairData } from 'src/utils/artifact-formatting.util';
import { errorToLoggable } from 'src/utils/logging.util';
import { ArtifactData } from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationId } from '../../types';
import { ArtifactDataValidators } from './artifact-data.validators';
import { MessageContentExtractor } from 'src/utils/message-content-extractor';
import { FlowUserMessage } from 'src/types/flow-internal.types';
import {
  TIMELINE_MESSAGE_WHERE,
  timelineCreatedAt,
} from 'src/utils/message-timeline.util';

export interface ResolvedMessage {
  id: string;
  content: string;
  type: 'USER' | 'SYSTEM';
  timestamp: Date;
  conversationId: string;
  data?: object;
}

export interface ResolvedConversation {
  id: string;
  title: string;
  status: string;
  projectId: string;
  messageCount: number;
  createdAt: Date;
}

export interface ResolvedArtifact {
  id: string;
  type: string;
  title?: string;
  data: ArtifactData;
  projectId: string;
  organizationId: string;
  createdAt: Date;
}

export interface QuestionContext {
  question: string;
  answer: string;
  systemMessage?: ResolvedMessage;
  userMessage?: ResolvedMessage;
  questionField?: string;
  confidence?: number;
  conversationContext?: ResolvedConversation;
}

@Injectable()
export class ArtifactGraphService {
  private readonly logger = new Logger(ArtifactGraphService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly validators: ArtifactDataValidators,
  ) {}

  // Bulk resolve all references in artifact data
  async resolveAllReferences(
    artifactData: ArtifactData,
    organizationId: OrganizationId,
    correlationId?: string,
  ): Promise<{
    messages: ResolvedMessage[];
    conversations: ResolvedConversation[];
    artifacts: ResolvedArtifact[];
    questionContext?: QuestionContext;
  }> {
    this.logger.debug(
      '[resolveAllReferences] Starting bulk reference resolution',
      {
        artifactType: artifactData.type,
        organizationId,
        correlationId,
      },
    );

    try {
      // Extract all reference IDs
      const referenceIds = this.validators.extractReferenceIds(artifactData);

      const promises: Promise<unknown>[] = [];
      const results = {
        messages: [] as ResolvedMessage[],
        conversations: [] as ResolvedConversation[],
        artifacts: [] as ResolvedArtifact[],
        questionContext: undefined as QuestionContext | undefined,
      };

      // Resolve system and user messages for QA pairs
      if (isQaPairData(artifactData)) {
        if (artifactData.systemMessageId) {
          promises.push(
            this.resolveSystemMessage(
              artifactData.systemMessageId,
              organizationId,
              correlationId,
            ).then((msg: ResolvedMessage | null) => {
              if (msg) {
                results.messages.push(msg);
              }
            }),
          );
        }
        if (artifactData.userMessageId) {
          promises.push(
            this.resolveUserMessage(
              artifactData.userMessageId,
              organizationId,
              correlationId,
            ).then((msg: ResolvedMessage | null) => {
              if (msg) {
                results.messages.push(msg);
              }
            }),
          );
        }
        // Get full question context
        promises.push(
          this.resolveQuestionContext(
            { data: artifactData },
            organizationId,
            correlationId,
          ).then((context: QuestionContext | null) => {
            results.questionContext = context || undefined;
          }),
        );
      }

      // Resolve related artifacts if any
      const artifactIds = referenceIds.filter(
        (id) =>
          // Filter out message IDs (assuming they have different format)
          id.length > 10, // Simple heuristic
      );

      if (artifactIds.length > 0) {
        promises.push(
          this.resolveRelatedArtifacts(
            artifactIds,
            organizationId,
            correlationId,
          ).then((artifacts: ResolvedArtifact[]) => {
            results.artifacts.push(...artifacts);
          }),
        );
      }

      await Promise.all(promises);

      this.logger.debug(
        '[resolveAllReferences] Bulk reference resolution completed',
        {
          messagesResolved: results.messages.length,
          conversationsResolved: results.conversations.length,
          artifactsResolved: results.artifacts.length,
          hasQuestionContext: !!results.questionContext,
          correlationId,
        },
      );

      return results;
    } catch (error) {
      this.logger.error(
        '[resolveAllReferences] Bulk reference resolution failed',
        {
          artifactType: artifactData.type,
          organizationId,
          error:
            error instanceof Error ? error.message : errorToLoggable(error),
          correlationId,
        },
      );

      return {
        messages: [],
        conversations: [],
        artifacts: [],
      };
    }
  }

  async resolveSystemMessage(
    messageId: string,
    organizationId: OrganizationId,
    correlationId?: string,
  ): Promise<ResolvedMessage | null> {
    try {
      const message = await this.prisma.db.message.findFirst({
        where: {
          id: messageId,
          type: 'SYSTEM',
          ...TIMELINE_MESSAGE_WHERE,
          conversation: {
            organizationId,
          },
        },
      });

      if (!message) {
        return null;
      }

      return this.mapMessage(message, 'SYSTEM');
    } catch (error) {
      this.logger.warn('[resolveSystemMessage] Failed to resolve message', {
        messageId,
        organizationId,
        correlationId,
        error: errorToLoggable(error),
      });
      return null;
    }
  }

  async resolveUserMessage(
    messageId: string,
    organizationId: OrganizationId,
    correlationId?: string,
  ): Promise<ResolvedMessage | null> {
    try {
      const message = await this.prisma.db.message.findFirst({
        where: {
          id: messageId,
          type: 'USER',
          ...TIMELINE_MESSAGE_WHERE,
          conversation: {
            organizationId,
          },
        },
      });

      if (!message) {
        return null;
      }

      return this.mapMessage(message, 'USER');
    } catch (error) {
      this.logger.warn('[resolveUserMessage] Failed to resolve message', {
        messageId,
        organizationId,
        correlationId,
        error: errorToLoggable(error),
      });
      return null;
    }
  }

  async resolveQuestionContext(
    params: { data: ArtifactData },
    organizationId: OrganizationId,
    correlationId?: string,
  ): Promise<QuestionContext | null> {
    if (!isQaPairData(params.data)) {
      return null;
    }

    try {
      const systemMessage = params.data.systemMessageId
        ? await this.resolveSystemMessage(
            params.data.systemMessageId,
            organizationId,
            correlationId,
          )
        : null;
      const userMessage = params.data.userMessageId
        ? await this.resolveUserMessage(
            params.data.userMessageId,
            organizationId,
            correlationId,
          )
        : null;

      return {
        question: params.data.question,
        answer: params.data.answer,
        questionField: params.data.questionField,
        confidence: params.data.confidence,
        systemMessage: systemMessage ?? undefined,
        userMessage: userMessage ?? undefined,
      };
    } catch (error) {
      this.logger.warn('[resolveQuestionContext] Failed to resolve context', {
        organizationId,
        correlationId,
        error: errorToLoggable(error),
      });
      return null;
    }
  }

  async resolveRelatedArtifacts(
    artifactIds: string[],
    organizationId: OrganizationId,
    correlationId?: string,
  ): Promise<ResolvedArtifact[]> {
    if (artifactIds.length === 0) {
      return [];
    }

    try {
      const artifacts = await this.prisma.db.artifact.findMany({
        where: {
          id: { in: artifactIds },
          organizationId,
        },
      });

      return artifacts.map((artifact) => ({
        id: artifact.id,
        type: artifact.type,
        title: artifact.title ?? undefined,
        data: artifact.data,
        projectId: artifact.projectId,
        organizationId: artifact.organizationId,
        createdAt: artifact.createdAt,
      }));
    } catch (error) {
      this.logger.warn(
        '[resolveRelatedArtifacts] Failed to resolve artifacts',
        {
          organizationId,
          correlationId,
          error: errorToLoggable(error),
        },
      );
      return [];
    }
  }

  private mapMessage(
    message: {
      id: string;
      createdAt: Date | null;
      conversationId: string;
      data: unknown | null;
    },
    type: ResolvedMessage['type'],
  ): ResolvedMessage {
    const data = message.data ?? undefined;
    const content = this.extractMessageContent(type, data);

    return {
      id: message.id,
      content,
      type,
      timestamp: timelineCreatedAt(message),
      conversationId: message.conversationId,
      data: data ?? undefined,
    };
  }

  private extractMessageContent(
    type: ResolvedMessage['type'],
    data: unknown,
  ): string {
    if (type === 'USER') {
      return MessageContentExtractor.extractMessageContent({
        data,
      } as FlowUserMessage);
    }

    if (data && typeof data === 'object') {
      const response = (data as { response?: string }).response;
      if (response && typeof response === 'string') {
        return response;
      }
    }

    if (typeof data === 'string') {
      return data;
    }

    return '[System message content unavailable]';
  }
}
