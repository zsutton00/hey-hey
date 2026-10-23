/**
 * Concrete Initiative Refinement Service
 *
 * Implements the generic refinement interface for initiatives, providing
 * initiative-specific implementations while leveraging shared refinement logic.
 */

import { Injectable } from '@nestjs/common';
import {
  ConversationResponseDto,
  InitiativeSectionUpdateSource,
  InitiativeResponseDto,
  UpdateInitiativeDto,
  WorkItemSectionInput,
} from '../../generated';
import {
  InitiativeRefinableEntity,
  toInitiativeRefinableEntity,
} from '../../types/initiative-refinement-adapter.types';
import { InitiativeId, OrganizationId, ProjectId, UserId } from '../../types';
import {
  EntityType,
  RefinementLevel,
} from '../../types/refinable-entity.types';
import {
  getCurrentSectionFromStatus,
  getNextSection,
} from '../../utils/work-item.util';
import {
  BaseRefinementService,
  WorkItemRefinementService,
} from '../base/base-refinement.service';
import { InitiativeLifecycleService } from './initiative-lifecycle.service';
import { InitiativeService } from './initiative.service';
import { Priority, WorkStatus } from '@prisma/client';

/**
 * Initiative-specific refinement service implementation
 * Extends BaseRefinementService with initiative-specific behavior
 */
@Injectable()
export class InitiativeRefinementService
  extends BaseRefinementService<InitiativeRefinableEntity>
  implements WorkItemRefinementService<InitiativeRefinableEntity>
{
  constructor(
    private readonly initiativeService: InitiativeService,
    private readonly initiativeLifecycleService: InitiativeLifecycleService,
  ) {
    super('InitiativeRefinementService');
  }

  // Abstract method implementations from BaseRefinementService

  protected getEntityType(): EntityType {
    return 'initiative';
  }

  protected getWorkItemService(): WorkItemRefinementService<InitiativeRefinableEntity> {
    return this;
  }

  protected getCurrentLevelFromStatus(status: string): RefinementLevel {
    return getCurrentSectionFromStatus(status);
  }

  protected getNextLevel(
    currentLevel: RefinementLevel,
  ): RefinementLevel | null {
    return getNextSection(
      currentLevel as 'description' | 'details' | 'acceptanceCriteria',
    );
  }

  // WorkItemRefinementService interface implementations

  async findOneForAdapter(
    id: string,
    organizationId: OrganizationId,
  ): Promise<InitiativeRefinableEntity | null> {
    const initiative = await this.initiativeService.findOneForAdapter(
      id,
      organizationId,
    );
    if (!initiative) {
      return null;
    }
    return toInitiativeRefinableEntity(initiative);
  }

  async updateForAdapter(
    id: string,
    updates: Partial<InitiativeRefinableEntity>,
    organizationId: OrganizationId,
  ): Promise<InitiativeRefinableEntity> {
    const sectionUpdates: WorkItemSectionInput[] = [];
    if (updates.description !== undefined) {
      sectionUpdates.push({
        key: 'description',
        content: updates.description ?? '',
      });
    }
    if (updates.details !== undefined) {
      sectionUpdates.push({
        key: 'details',
        content: updates.details ?? '',
      });
    }
    if (updates.acceptanceCriteria !== undefined) {
      sectionUpdates.push({
        key: 'acceptanceCriteria',
        content: updates.acceptanceCriteria ?? '',
      });
    }

    // Convert the updates from InitiativeRefinableEntity to InitiativeResponseDto format
    const updatesDto: Partial<Omit<InitiativeResponseDto, 'sections'>> & {
      sections?: WorkItemSectionInput[];
      sectionUpdateSource?: InitiativeSectionUpdateSource;
    } = {
      ...(updates.name && { name: updates.name }),
      ...(updates.status && { status: updates.status as WorkStatus }),
      ...(updates.priority !== undefined && {
        priority: updates.priority as Priority,
      }),
      ...(updates.assigneeId !== undefined && {
        assigneeId: updates.assigneeId as UserId,
      }),
    };
    if (sectionUpdates.length > 0) {
      updatesDto.sections = sectionUpdates;
      updatesDto.sectionUpdateSource =
        InitiativeSectionUpdateSource.AgentSuggested;
    }

    const updated = await this.initiativeService.updateForAdapter(
      id,
      updatesDto as UpdateInitiativeDto,
      organizationId,
    );
    return toInitiativeRefinableEntity(updated);
  }

  async applySectionUpdates(
    organizationId: OrganizationId,
    initiativeId: InitiativeId,
    updates: Array<{ key: string; content: string }>,
  ): Promise<InitiativeResponseDto> {
    return this.initiativeService.applySectionUpdates(
      organizationId,
      initiativeId,
      updates as Array<{ key: any; content: string }>,
      { sectionUpdateSource: InitiativeSectionUpdateSource.AgentSuggested },
    );
  }

  async createRefinementConversation(
    entityId: string,
    _entityType = 'initiative',
    organizationId: OrganizationId,
    projectId?: string,
    planId?: string,
  ): Promise<{
    conversation: ConversationResponseDto;
    entities: InitiativeRefinableEntity[];
  }> {
    this.logger.log(
      `Creating refinement conversation for initiative ${entityId}`,
      {
        entityId,
        organizationId,
        projectId,
      },
    );

    // Validate that the initiative exists
    const initiative = await this.findOneForAdapter(entityId, organizationId);
    if (!initiative) {
      throw new Error(
        `Initiative ${entityId} not found in organization ${organizationId}`,
      );
    }

    if (!projectId) {
      throw new Error(
        'Project ID is required for initiative refinement conversations',
      );
    }

    // Use the existing initiative lifecycle service to create the conversation
    const result =
      await this.initiativeLifecycleService.createRefinementConversation(
        entityId,
        organizationId,
        projectId as ProjectId,
        planId,
      );

    // Convert the result to match our interface
    // The lifecycle service returns { conversation, initiatives }
    // but we need to adapt this to our generic interface
    if (!result.conversation) {
      throw new Error(
        `Failed to create refinement conversation for initiative ${entityId}`,
      );
    }

    return {
      conversation: result.conversation,
      entities: result.initiatives ? [initiative] : [initiative],
    };
  }

  async getActiveRefinementConversation(
    initiativeId: InitiativeId,
    organizationId: OrganizationId,
  ): Promise<string | null> {
    return this.initiativeService.getActiveRefinementConversation(
      initiativeId,
      organizationId,
    );
  }
}
