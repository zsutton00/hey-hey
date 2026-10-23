import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type AgentSession,
  AgentSessionType,
  EntityType,
  ProposalStatus,
} from '@prisma/client';
import { AgentSessionDto, WorkStatus } from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ConversationId,
  InitiativeId,
  OrganizationId,
  PlanId,
  ProjectId,
  TaskId,
  UserId,
} from '../../types';
import { AgentSessionService } from '../agent-session.service';
import { ConversationService } from '../conversation.service';
import { TaskService } from '../tasks/task.service';
import { PlanFromDesignDocLauncherService } from './plan-from-design-doc-launcher.service';
import { resolvePlanGenerationDesignDoc } from './resolve-plan-generation-seed';
import { PlanDesignDocLinksService } from '../design-doc/plan-design-doc-links.service';
import { TriggerEmitter } from '../../core/websockets/trigger-emitter.service';
import { ProposalService } from '../proposal/proposal.service';
import { ReportService } from '../reports/report.service';
import { ORDINARY_PROPOSAL_VISIBILITY_WHERE } from '../proposal/proposal-visibility';

@Injectable()
export class WorkItemPlanGenerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AgentSessionService,
    private readonly conversations: ConversationService,
    private readonly tasks: TaskService,
    private readonly launcher: PlanFromDesignDocLauncherService,
    private readonly triggers: TriggerEmitter,
    private readonly proposals: ProposalService,
    private readonly reports: ReportService,
    private readonly designDocLinks: PlanDesignDocLinksService,
  ) {}

  private async lockPlan(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    projectId: ProjectId,
    planId: TaskId,
  ) {
    // Serialize prepare/reset, including retries, on the existing work item.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM tasks WHERE id = ${planId}
      AND organization_id = ${organizationId} AND project_id = ${projectId} FOR UPDATE`);
    const plan = await tx.task.findFirst({
      where: {
        id: planId,
        organizationId,
        projectId,
        type: 'PLAN',
        archivedAt: null,
      },
    });
    if (!plan) throw new NotFoundException('Plan work item not found');
    return plan;
  }

  async prepare(
    organizationId: OrganizationId,
    projectId: ProjectId,
    planId: TaskId,
    userId: UserId,
  ): Promise<AgentSessionDto> {
    const sessionId = await this.prisma.$transaction(async (tx) => {
      const plan = await this.lockPlan(tx, organizationId, projectId, planId);
      if (plan.status !== WorkStatus.Backlog)
        throw new ConflictException('Only a draft Plan can prepare generation');
      const existing = await tx.agentSession.findFirst({
        where: {
          organizationId,
          projectId,
          type: AgentSessionType.PLAN_GENERATION,
          conversation: {
            is: {
              workflowAboutId: planId,
              workflowName: 'plan-from-design-doc',
              status: { not: 'DELETED' },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        if (existing.userId !== userId)
          throw new ForbiddenException(
            'Generation session belongs to another user',
          );
        return existing.id;
      }
      const document = await resolvePlanGenerationDesignDoc(
        tx,
        organizationId,
        projectId,
        planId,
        this.designDocLinks,
      );
      const setup =
        await this.launcher.materializeForExistingWorkItemInTransaction(tx, {
          organizationId,
          projectId,
          planId: planId as string as PlanId,
          planTitle: plan.name,
          ...(plan.parentTaskId
            ? { parentFeatureId: plan.parentTaskId as TaskId }
            : {}),
          requestorId: userId,
          designDocMarkdown: document.sections
            .map((section) => section.materializedMarkdown ?? '')
            .filter(Boolean)
            .join('\n\n'),
        });
      return setup.agentSessionId;
    });
    return this.sessions.findOne(organizationId, sessionId);
  }

  async reset(
    organizationId: OrganizationId,
    projectId: ProjectId,
    planId: TaskId,
    userId: UserId,
  ): Promise<void> {
    const postCommit = await this.prisma.$transaction(
      async (tx) => {
        const plan = await this.lockPlan(tx, organizationId, projectId, planId);
        const sessions = await tx.agentSession.findMany({
          where: {
            organizationId,
            projectId,
            type: AgentSessionType.PLAN_GENERATION,
            OR: [
              { entityId: planId, entityType: 'TASK' },
              {
                conversation: {
                  is: {
                    workflowAboutId: planId,
                    workflowName: 'plan-from-design-doc',
                  },
                },
              },
            ],
          },
        });
        if (sessions.some((session) => session.userId !== userId)) {
          throw new ForbiddenException(
            'Generation session belongs to another user',
          );
        }
        for (const session of sessions) {
          await this.retireSession(
            tx,
            organizationId,
            projectId,
            userId,
            session,
          );
        }
        const stages = await tx.task.findMany({
          where: {
            organizationId,
            projectId,
            parentTaskId: planId,
            type: 'PLAN_STAGE',
            archivedAt: null,
          },
          select: { id: true },
        });
        for (const stage of stages) {
          const children = await tx.task.findMany({
            where: {
              organizationId,
              projectId,
              parentTaskId: stage.id,
              archivedAt: null,
            },
            select: { id: true },
          });
          for (const child of children)
            await this.tasks.removeInTransaction(
              tx,
              organizationId,
              child.id as TaskId,
            );
          await this.tasks.removeInTransaction(
            tx,
            organizationId,
            stage.id as TaskId,
          );
        }
        const updated = await this.tasks.updateInTransaction(
          tx,
          organizationId,
          plan.initiativeId as InitiativeId | null,
          planId,
          { status: WorkStatus.Backlog },
          userId,
        );
        return updated.postCommit;
      },
      { timeout: 60_000 },
    );
    await this.tasks.runUpdatePostCommit(organizationId, planId, postCommit);
  }

  private async retireSession(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    session: Pick<AgentSession, 'id' | 'conversationId'>,
  ) {
    const conversationId = session.conversationId as ConversationId | null;
    if (conversationId) {
      await this.triggers.emitStopRunControl({
        runId: session.id,
        conversationId,
        actingUserId: userId,
        organizationId,
        projectId,
      });
      const drafts = await tx.proposal.findMany({
        where: {
          organizationId,
          conversationId,
          status: ProposalStatus.DRAFT,
          ...ORDINARY_PROPOSAL_VISIBILITY_WHERE,
        },
        select: { id: true },
      });
      for (const draft of drafts)
        await this.proposals.delete(draft.id, organizationId, projectId);
      await this.conversations.deleteConversation(
        conversationId,
        organizationId,
        userId,
        'Plan generation reset',
      );
    }
    await this.reports.deleteReportsAttachedToEntity({
      organizationId,
      projectId,
      entityId: session.id,
      entityType: EntityType.AGENT_SESSION,
    });
    await this.sessions.remove(organizationId, session.id);
  }
}
