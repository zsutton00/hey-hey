import { Injectable, Logger } from '@nestjs/common';
import { WorkStatus } from '@prisma/client';
import {
  ConversationStatus,
  CreateConversationDto,
  InitiationType,
  MaterializedWorkItemSection,
  WorkflowName,
} from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../../types';
import { ArtifactService } from '../artifacts/artifact.service';
import { ConversationService } from '../conversation.service';
import { InitiativeService } from './initiative.service';
import { InitiativeDraft } from './types';
import { materializedSectionsToContentMap } from '../../utils/work-item-section.util';

export interface InitiativeGenerationResult {
  conversationIds: ConversationId[];
  initiatives: InitiativeDraft[];
}

export interface IntegrationInsights {
  workPatterns: Array<{
    pattern: string;
    frequency: number;
    confidence: number;
  }>;
  teamActivity: Array<{
    userId: string;
    activityLevel: 'high' | 'medium' | 'low';
    areas: string[];
  }>;
  techStack: string[];
}

export interface InitiativeFinalizationRequest {
  conversationId: ConversationId;
  organizationId: OrganizationId;
  projectId?: ProjectId;
  selectedInitiativeIds?: string[];
}

export interface InitiativeFinalizationResult {
  finalizedInitiatives: Array<{
    id: string;
    draftId: string;
    name: string;
    status: WorkStatus;
  }>;
  conversationUpdated: boolean;
  cleanupCompleted: boolean;
}

@Injectable()
export class InitiativeLifecycleService {
  private readonly logger = new Logger(InitiativeLifecycleService.name);

  constructor(
    private conversationService: ConversationService,
    private prisma: PrismaService,
    private artifactService: ArtifactService,
    private initiativeService: InitiativeService,
  ) {}

  /**
   * Get initiative creation conversation
   */
  async getInitiativeCreationConversation(
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ) {
    return await this.conversationService.getConversation(
      conversationId,
      organizationId,
    );
  }

  /**
   * Find existing refinement conversation for an initiative
   * Looks for conversations associated with the initiative or project
   */
  async findConversationForInitiative(
    initiativeId: string,
    _organizationId: OrganizationId,
    projectId: ProjectId,
  ) {
    this.logger.debug(`Finding conversation for initiative ${initiativeId}`);

    // First, try to find conversations for this project associated with this initiative
    this.logger.debug(
      '[findConversationForInitiative] searching for conversations by initiative',
      {
        initiativeId,
        projectId,
      },
    );
    const conversations = await this.prisma.db.conversation.findMany({
      where: {
        projectId,
        status: {
          in: [
            ConversationStatus.InProgress,
            ConversationStatus.GeneratingResponse,
          ],
        },
        workflowAboutId: initiativeId,
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: 1,
    });

    if (conversations.length > 0) {
      return conversations[0];
    }

    // If no conversation found with the initiative, try finding by project and category
    this.logger.debug(
      '[findConversationForInitiative] searching for project conversations',
      {
        projectId,
      },
    );
    const projectConversations = await this.prisma.db.conversation.findMany({
      where: {
        projectId,
        status: {
          in: [
            ConversationStatus.InProgress,
            ConversationStatus.GeneratingResponse,
          ],
        },
        // Look for initiative-related conversations by workflowName
        OR: [
          { workflowName: 'initiative-generation' },
          { workflowName: 'initiative-refinement' },
          { workflowAboutId: { not: null }, workflowAboutType: 'initiative' },
        ],
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: 1,
    });

    return projectConversations.length > 0 ? projectConversations[0] : null;
  }

  /**
   * Create a new refinement conversation for an initiative
   * This allows starting refinement from an existing initiative
   */
  async createRefinementConversation(
    initiativeId: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
    planId?: string,
    userId?: UserId,
  ) {
    this.logger.debug(
      `Creating refinement conversation for initiative ${initiativeId}`,
    );

    // First, get the initiative details from the database
    this.logger.debug(
      '[createRefinementConversation] fetching initiative details',
      {
        initiativeId,
        organizationId,
      },
    );
    const initiative = await this.prisma.db.initiative.findFirst({
      where: {
        id: initiativeId,
        organizationId,
      },
    });

    if (!initiative) {
      throw new Error(`Initiative ${initiativeId} not found`);
    }

    const sectionRows = await this.prisma.db.initiativeSection.findMany({
      where: { initiativeId: initiative.id },
      select: {
        id: true,
        key: true,
        order: true,
        materializedMarkdown: true,
      },
    });
    const sectionContent = materializedSectionsToContentMap(
      sectionRows as MaterializedWorkItemSection[],
    );

    // Create an InitiativeDraft from the existing initiative
    const initiativeDraft: InitiativeDraft = {
      id: initiative.id,
      name: initiative.name,
      description: sectionContent.description,
      details: sectionContent.details,
      acceptanceCriteria: sectionContent.acceptanceCriteria,
      priority: initiative.priority?.toLowerCase() as
        | 'low'
        | 'medium'
        | 'high'
        | 'critical',
      tags: initiative.tags || [],
      reasoning: initiative.reasoning ?? undefined,
      influences: [] as InitiativeDraft['influences'], // No influences for existing initiatives
    };

    // Create conversation for initiative refinement
    const conversationData: CreateConversationDto = {
      projectId,
      organizationId,
      workflowId: 'initiative-refinement' as WorkflowId,
      initiatedBy: InitiationType.User,
      workflowName: 'initiative-refinement',
      workflowAboutId: initiativeId,
      workflowAboutType: 'initiative',
      context: {},
    };

    const conversation = await this.conversationService.createConversation(
      conversationData,
      organizationId,
      ...(userId ? [{ createdBy: userId }] : []),
    );

    return {
      conversation,
      initiatives: [initiativeDraft],
    };
  }
}
