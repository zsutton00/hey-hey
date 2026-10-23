import { Injectable, Logger } from '@nestjs/common';
import { EntityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveAncestorPlanWorkItem } from '../plan/resolve-plan-work-item';
import { TaskService } from '../tasks/task.service';
import { DesignDocService } from '../design-doc/design-doc.service';
import type {
  DesignDocId,
  InitiativeId,
  OrganizationId,
  PlanId,
  TaskId,
  WorkflowAboutType,
} from '../../types';

export type RelationshipResolution = {
  resolvedContext: {
    planId?: PlanId;
    initiativeId?: InitiativeId;
    taskId?: TaskId;
    designDocId?: DesignDocId;
  };
  additionalHeaders: Record<string, string>;
};

type DesignDocLink = {
  entityType: string;
  entityId: string;
  createdAt: string;
};

@Injectable()
export class EntityRelationshipResolverService {
  private readonly logger = new Logger(EntityRelationshipResolverService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly taskService: TaskService,
    private readonly designDocService: DesignDocService,
  ) {}

  async resolveForWorkflowAbout(params: {
    organizationId: OrganizationId;
    conversationId?: string;
    workflowAboutType?: WorkflowAboutType;
    workflowAboutId?: string;
  }): Promise<RelationshipResolution> {
    const {
      organizationId,
      conversationId,
      workflowAboutType,
      workflowAboutId,
    } = params;

    const conversationPlanId = conversationId
      ? await this.resolvePlanFromConversation(organizationId, conversationId)
      : undefined;

    if (!workflowAboutType || !workflowAboutId) {
      const emptyResult = {
        resolvedContext: conversationPlanId
          ? { planId: conversationPlanId }
          : {},
        additionalHeaders: this.buildHeaderIds(
          conversationPlanId ? { planId: conversationPlanId } : {},
        ),
      };
      this.logResolution(
        organizationId,
        workflowAboutType,
        workflowAboutId,
        emptyResult,
      );
      return emptyResult;
    }

    switch (workflowAboutType) {
      case 'design-doc':
        return this.resolveAndLog(
          organizationId,
          workflowAboutType,
          workflowAboutId,
          this.resolveDesignDocContext(
            organizationId,
            workflowAboutId as DesignDocId,
            conversationPlanId,
          ),
        );
      case 'task':
        return this.resolveAndLog(
          organizationId,
          workflowAboutType,
          workflowAboutId,
          this.resolveTaskContext(
            organizationId,
            workflowAboutId as TaskId,
            conversationPlanId,
          ),
        );
      case 'initiative':
        return this.resolveAndLog(
          organizationId,
          workflowAboutType,
          workflowAboutId,
          this.resolveInitiativeContext(
            organizationId,
            workflowAboutId as InitiativeId,
            conversationPlanId,
          ),
        );
      default:
        const fallback = { resolvedContext: {}, additionalHeaders: {} };
        this.logResolution(
          organizationId,
          workflowAboutType,
          workflowAboutId,
          fallback,
        );
        return fallback;
    }
  }

  private resolvePlanContext(planId: PlanId): RelationshipResolution {
    return {
      resolvedContext: { planId },
      additionalHeaders: this.buildHeaderIds({ planId }),
    };
  }

  private async resolveInitiativeContext(
    organizationId: OrganizationId,
    initiativeId: InitiativeId,
    conversationPlanId?: PlanId,
  ): Promise<RelationshipResolution> {
    const planId = conversationPlanId;

    return {
      resolvedContext: { initiativeId, planId },
      additionalHeaders: this.buildHeaderIds({ initiativeId, planId }),
    };
  }

  private async resolveTaskContext(
    organizationId: OrganizationId,
    taskId: TaskId,
    conversationPlanId?: PlanId,
  ): Promise<RelationshipResolution> {
    const task = await this.taskService.findOneForAdapter(
      taskId,
      organizationId,
    );
    const initiativeId = task?.initiativeId as InitiativeId | undefined;

    const planId =
      conversationPlanId ??
      ((await resolveAncestorPlanWorkItem(
        this.prisma.db,
        organizationId,
        taskId,
      )) as PlanId | undefined);

    return {
      resolvedContext: { taskId, initiativeId, planId },
      additionalHeaders: this.buildHeaderIds({ taskId, initiativeId, planId }),
    };
  }

  private async resolveDesignDocContext(
    organizationId: OrganizationId,
    designDocId: DesignDocId,
    conversationPlanId?: PlanId,
  ): Promise<RelationshipResolution> {
    const chain = await this.buildDesignDocChain(organizationId, designDocId);

    const taskId = await this.resolveTaskFromDesignDocChain(
      organizationId,
      chain,
    );

    const initiativeId = taskId
      ? await this.resolveInitiativeFromTask(organizationId, taskId)
      : undefined;

    const planId =
      conversationPlanId ??
      (taskId
        ? ((await resolveAncestorPlanWorkItem(
            this.prisma.db,
            organizationId,
            taskId,
          )) as PlanId | undefined)
        : undefined);

    return {
      resolvedContext: { designDocId, taskId, initiativeId, planId },
      additionalHeaders: this.buildHeaderIds({ taskId, initiativeId, planId }),
    };
  }

  private async resolveInitiativeFromTask(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<InitiativeId | undefined> {
    const task = await this.taskService.findOneForAdapter(
      taskId,
      organizationId,
    );
    return task?.initiativeId as InitiativeId | undefined;
  }

  private async buildDesignDocChain(
    organizationId: OrganizationId,
    designDocId: DesignDocId,
  ): Promise<DesignDocId[]> {
    const chain: DesignDocId[] = [];
    const visited = new Set<string>();
    let current: DesignDocId | undefined = designDocId;

    while (current && !visited.has(current)) {
      chain.push(current);
      visited.add(current);
      const parentId = await this.findOldestParentDesignDocId(
        organizationId,
        current,
      );
      current = parentId ?? undefined;
    }

    return chain;
  }

  private async findOldestParentDesignDocId(
    organizationId: OrganizationId,
    childDesignDocId: DesignDocId,
  ): Promise<DesignDocId | undefined> {
    const child = await this.prisma.db.designDoc.findFirst({
      where: {
        id: childDesignDocId,
        organizationId,
        parentEntityType: 'DESIGN_DOC',
        parentEntityId: { not: null },
      },
      select: { parentEntityId: true },
    });

    return (child?.parentEntityId as DesignDocId | undefined) ?? undefined;
  }

  private async resolveTaskFromDesignDocChain(
    organizationId: OrganizationId,
    chain: DesignDocId[],
  ): Promise<TaskId | undefined> {
    for (const docId of chain) {
      const links = await this.designDocService.getLinks(docId, organizationId);
      const link = this.pickOldestLink(links, 'task');
      if (link) {
        return link.entityId as TaskId;
      }
    }
    return undefined;
  }

  private pickOldestLink(
    links: DesignDocLink[],
    entityType: string,
  ): DesignDocLink | undefined {
    let selected: DesignDocLink | undefined;
    for (const link of links) {
      if (link.entityType !== entityType) {
        continue;
      }
      if (!selected) {
        selected = link;
        continue;
      }
      const selectedTime = Date.parse(selected.createdAt);
      const candidateTime = Date.parse(link.createdAt);
      if (candidateTime < selectedTime) {
        selected = link;
      }
    }

    return selected;
  }

  private buildHeaderIds(params: {
    planId?: PlanId;
    initiativeId?: InitiativeId;
    taskId?: TaskId;
  }): Record<string, string> {
    const headers: Record<string, string> = {};

    if (params.planId) {
      headers['X-Plan-ID'] = params.planId;
    }
    if (params.initiativeId) {
      headers['X-Initiative-ID'] = params.initiativeId;
    }
    if (params.taskId) {
      headers['X-Task-ID'] = params.taskId;
    }

    return headers;
  }

  private async resolveAndLog(
    organizationId: OrganizationId,
    workflowAboutType: WorkflowAboutType,
    workflowAboutId: string,
    resolution: Promise<RelationshipResolution>,
  ): Promise<RelationshipResolution> {
    const resolved = await resolution;
    this.logResolution(
      organizationId,
      workflowAboutType,
      workflowAboutId,
      resolved,
    );
    return resolved;
  }

  private logResolution(
    organizationId: OrganizationId,
    workflowAboutType: WorkflowAboutType | undefined,
    workflowAboutId: string | undefined,
    resolution: RelationshipResolution,
  ): void {
    const { planId, initiativeId, taskId, designDocId } =
      resolution.resolvedContext;
    this.logger.debug('[EntityRelationshipResolver] resolved entity context', {
      organizationId,
      workflowAboutType,
      workflowAboutId,
      planId,
      initiativeId,
      taskId,
      designDocId,
    });
  }

  private async resolvePlanFromConversation(
    organizationId: OrganizationId,
    conversationId: string,
  ): Promise<PlanId | undefined> {
    const conversation = await this.prisma.db.conversation.findFirst({
      where: { id: conversationId, organizationId },
      select: { workflowAboutId: true, workflowAboutType: true },
    });
    if (
      conversation?.workflowAboutType !== 'task' ||
      !conversation.workflowAboutId
    )
      return undefined;
    return (await resolveAncestorPlanWorkItem(
      this.prisma.db,
      organizationId,
      conversation.workflowAboutId,
    )) as PlanId | undefined;
  }
}
