import { Injectable, Logger } from '@nestjs/common';
import { ArtifactRelationType, EntityType } from '@prisma/client';
import { MessageCreatedEvent } from 'src/generated/model/messageCreatedEvent';
import { PrismaService } from 'src/prisma/prisma.service';
import { WorkflowAboutType } from 'src/types';
import { workflowAboutTypeToEntityType } from 'src/utils/workflow-about-type.util';

@Injectable()
export class MentionRelationService {
  private readonly logger = new Logger(MentionRelationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createRelationsForMessage(event: MessageCreatedEvent): Promise<void> {
    const message = event.payload.message;
    if (message.type !== 'USER') {
      return;
    }

    const mentions = event.payload.mentions ?? [];
    if (!mentions.length) {
      return;
    }

    const conversationId =
      event.payload.conversationId ?? message.conversationId;
    if (!conversationId) {
      this.logger.warn('[createRelationsForMessage] Missing conversationId', {
        messageId: event.aggregateId,
      });
      return;
    }

    const conversation = await this.prisma.db.conversation.findUnique({
      where: { id: conversationId },
      select: { workflowAboutId: true, workflowAboutType: true },
    });

    if (!conversation?.workflowAboutId || !conversation.workflowAboutType) {
      this.logger.debug(
        '[createRelationsForMessage] Missing workflow about metadata',
        {
          conversationId,
          workflowAboutId: conversation?.workflowAboutId,
          workflowAboutType: conversation?.workflowAboutType,
        },
      );
      return;
    }

    const aboutEntityType = workflowAboutTypeToEntityType(
      conversation.workflowAboutType as WorkflowAboutType,
    );
    if (!aboutEntityType) {
      this.logger.debug(
        '[createRelationsForMessage] Unsupported workflow about type',
        {
          workflowAboutType: conversation.workflowAboutType,
          conversationId,
        },
      );
      return;
    }

    if (aboutEntityType === EntityType.ARTIFACT) {
      await this.createArtifactMentionRelations(
        conversation.workflowAboutId,
        mentions,
      );
    }
  }

  private async createArtifactMentionRelations(
    workflowAboutId: string,
    mentions: Array<{ entityId: string; entityType: string }>,
  ): Promise<void> {
    const artifactIds = new Set<string>();

    for (const mention of mentions) {
      if (
        mention.entityType === EntityType.ARTIFACT &&
        mention.entityId !== workflowAboutId
      ) {
        artifactIds.add(mention.entityId);
      }
    }

    if (artifactIds.size === 0) {
      return;
    }

    await this.prisma.db.artifactRelation.createMany({
      data: Array.from(artifactIds).map((artifactId) => ({
        sourceId: workflowAboutId,
        targetId: artifactId,
        relationType: ArtifactRelationType.MENTIONED_IN,
      })),
      skipDuplicates: true,
    });
  }
}
