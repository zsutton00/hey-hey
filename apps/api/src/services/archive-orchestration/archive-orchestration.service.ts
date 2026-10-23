import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { ConversationService } from '../conversation.service';
import { ArtifactService } from '../artifacts/artifact.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ArtifactSourceType,
  ConversationStatus,
  WorkflowName,
} from '../../generated';
import { ConversationId, DesignDocId, OrganizationId } from '../../types';

type ConversationRecord = {
  id: ConversationId;
  status: ConversationStatus;
};

interface ArchiveDesignDocParams {
  designDocId: DesignDocId;
  organizationId: OrganizationId;
  archivedBy?: string;
}

interface RestoreDesignDocParams {
  designDocId: DesignDocId;
  organizationId: OrganizationId;
  restoredBy?: string;
}

@Injectable()
export class ArchiveOrchestrationService {
  private readonly logger = new Logger(ArchiveOrchestrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly artifactService: ArtifactService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async archiveDesignDocDependencies({
    designDocId,
    organizationId,
    archivedBy,
  }: ArchiveDesignDocParams): Promise<void> {
    this.logger.log('Archiving design doc dependencies', {
      designDocId,
      organizationId,
    });

    const conversations = await this.findConversationsForDesignDoc(
      designDocId,
      organizationId,
      {
        excludeDeleted: true,
      },
    );

    if (!conversations.length) {
      this.logger.debug('No conversations found for design doc archive', {
        designDocId,
        organizationId,
      });
      return;
    }

    const conversationService = this.getConversationService();
    for (const conversation of conversations) {
      await conversationService.deleteConversation(
        conversation.id,
        organizationId,
        archivedBy,
        'Design document archived',
        false,
      );
    }

    await this.artifactService.archiveBySource({
      organizationId,
      sourceType: ArtifactSourceType.Conversation,
      sourceIds: conversations.map((conversation) => conversation.id),
    });
  }

  async restoreDesignDocDependencies({
    designDocId,
    organizationId,
    restoredBy,
  }: RestoreDesignDocParams): Promise<void> {
    this.logger.log('Restoring design doc dependencies', {
      designDocId,
      organizationId,
    });

    const conversations = await this.findConversationsForDesignDoc(
      designDocId,
      organizationId,
      {
        onlyDeleted: true,
      },
    );

    if (!conversations.length) {
      this.logger.debug('No conversations found for design doc restore', {
        designDocId,
        organizationId,
      });
      return;
    }

    const conversationService = this.getConversationService();
    for (const conversation of conversations) {
      await conversationService.restoreConversation(
        conversation.id,
        organizationId,
        restoredBy,
      );
    }

    await this.artifactService.restoreArchivedBySource({
      organizationId,
      sourceType: ArtifactSourceType.Conversation,
      sourceIds: conversations.map((conversation) => conversation.id),
    });
  }

  private async findConversationsForDesignDoc(
    designDocId: DesignDocId,
    organizationId: OrganizationId,
    options: { excludeDeleted?: boolean; onlyDeleted?: boolean },
  ): Promise<ConversationRecord[]> {
    const where: Prisma.ConversationWhereInput = {
      organizationId,
      workflowAboutId: designDocId,
      workflowAboutType: 'design-doc',
      workflowName: WorkflowName.Adr,
    };

    if (options.onlyDeleted) {
      where.status = ConversationStatus.Deleted;
    } else if (options.excludeDeleted) {
      where.status = { not: ConversationStatus.Deleted };
    }

    const records = await this.prisma.db.conversation.findMany({
      where,
      select: { id: true, status: true },
    });

    return records.map((record) => ({
      id: record.id,
      status: record.status as ConversationStatus,
    }));
  }

  private getConversationService(): ConversationService {
    return this.moduleRef.get(ConversationService, { strict: false });
  }
}
