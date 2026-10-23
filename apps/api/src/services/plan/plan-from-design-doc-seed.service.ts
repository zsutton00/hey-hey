import { resolveConversationPlanWorkItem } from './resolve-plan-work-item';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationId, DesignDocId, PlanId, TaskId } from '../../types';
import { OrganizationId, ProjectId } from '../../types';
import { resolvePlanGenerationDesignDoc } from './resolve-plan-generation-seed';
import { PlanDesignDocLinksService } from '../design-doc/plan-design-doc-links.service';

export interface PlanFromDesignDocSeed {
  planId: PlanId;
  planTitle: string;
  designDocId: DesignDocId;
  parentFeatureId?: TaskId;
}

@Injectable()
export class PlanFromDesignDocSeedService {
  private readonly logger = new Logger(PlanFromDesignDocSeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly designDocLinks: PlanDesignDocLinksService,
  ) {}

  async resolve(
    conversationId: ConversationId,
  ): Promise<PlanFromDesignDocSeed> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        workflowAboutId: true,
        workflowAboutType: true,
        organizationId: true,
        projectId: true,
      },
    });

    if (!conversation?.projectId)
      throw new NotFoundException('Plan conversation project not found');
    const organizationId = conversation.organizationId as OrganizationId;
    const projectId = conversation.projectId as ProjectId;
    const plan = await resolveConversationPlanWorkItem(
      this.prisma.db,
      organizationId,
      projectId,
      conversationId,
    );
    const document = await resolvePlanGenerationDesignDoc(
      this.prisma.db,
      organizationId,
      projectId,
      plan.id,
      this.designDocLinks,
    );
    return {
      planId: plan.id as PlanId,
      planTitle: plan.name,
      designDocId: document.id as DesignDocId,
      ...(plan.parentTaskId
        ? { parentFeatureId: plan.parentTaskId as TaskId }
        : {}),
    };
  }
}
