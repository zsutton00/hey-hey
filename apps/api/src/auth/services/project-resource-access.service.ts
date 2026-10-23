import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectAccessService } from './project-access.service';

export type ProjectResource =
  | 'project'
  | 'task'
  | 'designDoc'
  | 'conversation'
  | 'message'
  | 'service'
  | 'proposal'
  | 'proposalGroup'
  | 'agentSession'
  | 'report'
  | 'artifact'
  | 'initiative'
  | 'validationSession'
  | 'integration'
  | 'implementationHint'
  | 'execution'
  | 'notification'
  | 'llmRecord'
  | 'tag';

export const ENTITY_RESOURCES: Record<string, ProjectResource> = {
  PROJECT: 'project',
  TASK: 'task',
  FEATURE: 'task',
  GOAL: 'task',
  BUG: 'task',
  PLAN: 'task',
  PLAN_STAGE: 'task',
  CONTRACT: 'task',
  DIAGRAM: 'task',
  DIAGRAM_ELEMENT: 'task',
  DESIGN_DOC: 'designDoc',
  CONVERSATION: 'conversation',
  MESSAGE: 'message',
  SERVICE: 'service',
  PROPOSAL: 'proposal',
  AGENT_SESSION: 'agentSession',
  REPORT: 'report',
  ARTIFACT: 'artifact',
  INITIATIVE: 'initiative',
  VALIDATION_SESSION: 'validationSession',
  IMPLEMENTATION_HINT: 'implementationHint',
};

@Injectable()
export class ProjectResourceAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async assertSuggestion(
    userId: string,
    organizationId: string,
    type: string,
    suggestionId: string,
  ): Promise<void> {
    const owner = await this.prisma.db.suggestionDecision.findUnique({
      where: {
        organizationId_type_suggestionId: {
          organizationId,
          type,
          suggestionId,
        },
      },
      select: { sourceConversationId: true, sourceMessageId: true },
    });
    if (owner?.sourceConversationId)
      await this.assertResource(
        userId,
        organizationId,
        'conversation',
        owner.sourceConversationId,
      );
    if (owner?.sourceMessageId)
      await this.assertResource(
        userId,
        organizationId,
        'message',
        owner.sourceMessageId,
      );
  }

  async accessibleTagIds(
    userId: string,
    organizationId: string,
  ): Promise<string[]> {
    await this.access.assertOrganization(userId, organizationId);
    const candidates = await this.prisma.db.tag.findMany({
      where: { organizationId },
      select: { id: true, entityType: true, entityId: true },
    });
    const ids: string[] = [];
    for (const candidate of candidates) {
      const resource = ENTITY_RESOURCES[candidate.entityType];
      try {
        if (resource)
          await this.assertResource(
            userId,
            organizationId,
            resource,
            candidate.entityId,
          );
        ids.push(candidate.id);
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    return ids;
  }

  async assertResource(
    userId: string,
    organizationId: string,
    kind: ProjectResource,
    id: string,
    expectedProjectId?: string,
  ): Promise<void> {
    if (kind === 'project') {
      if (expectedProjectId && expectedProjectId !== id)
        throw new ForbiddenException('Project ownership mismatch');
      return this.access.assertProject(userId, organizationId, id);
    }
    const where = { id, organizationId };
    const select = { projectId: true } as const;
    let owner: { projectId: string | null } | null;
    switch (kind) {
      case 'implementationHint': {
        const row = await this.prisma.db.implementationHint.findFirst({
          where: { id, service: { organizationId } },
          select: { service: { select } },
        });
        owner = row?.service ?? null;
        break;
      }
      case 'tag': {
        const row = await this.prisma.db.tag.findFirst({
          where,
          select: { entityId: true, entityType: true },
        });
        if (!row) throw new ForbiddenException('Tag is not accessible');
        const resource = ENTITY_RESOURCES[row.entityType];
        if (resource)
          return this.assertResource(
            userId,
            organizationId,
            resource,
            row.entityId,
            expectedProjectId,
          );
        return this.access.assertOrganization(userId, organizationId);
      }
      case 'llmRecord':
        owner = await this.prisma.db.lLMPromptResponse.findFirst({
          where,
          select,
        });
        break;
      case 'execution':
        owner = await this.prisma.db.flowExecution.findFirst({ where, select });
        break;
      case 'notification':
        owner = await this.prisma.db.notification.findFirst({
          where: { ...where, userId },
          select,
        });
        break;
      case 'integration':
        owner = await this.prisma.db.integration.findFirst({ where, select });
        break;
      case 'task':
        owner = await this.prisma.db.task.findFirst({ where, select });
        break;
      case 'designDoc':
        owner = await this.prisma.db.designDoc.findFirst({ where, select });
        break;
      case 'conversation':
        owner = await this.prisma.db.conversation.findFirst({ where, select });
        break;
      case 'service':
        owner = await this.prisma.db.service.findFirst({ where, select });
        break;
      case 'proposal':
        owner = await this.prisma.db.proposal.findFirst({ where, select });
        break;
      case 'proposalGroup':
        owner = await this.prisma.db.proposalGroup.findFirst({ where, select });
        break;
      case 'agentSession':
        owner = await this.prisma.db.agentSession.findFirst({ where, select });
        break;
      case 'report':
        owner = await this.prisma.db.report.findFirst({ where, select });
        break;
      case 'artifact':
        owner = await this.prisma.db.artifact.findFirst({ where, select });
        break;
      case 'initiative': {
        const row = await this.prisma.db.initiative.findFirst({
          where,
          select: { originatingProjectId: true },
        });
        owner = row ? { projectId: row.originatingProjectId } : null;
        break;
      }
      case 'message': {
        const row = await this.prisma.db.message.findFirst({
          where: { id, conversation: { organizationId } },
          select: { projectId: true, conversation: { select } },
        });
        if (row && row.projectId !== row.conversation.projectId)
          throw new ForbiddenException('Message ownership mismatch');
        owner = row;
        break;
      }
      case 'validationSession': {
        const row = await this.prisma.db.validationSession.findFirst({
          where,
          select: { task: { select } },
        });
        owner = row?.task ?? null;
        break;
      }
    }
    if (
      !owner ||
      (expectedProjectId && owner.projectId !== expectedProjectId)
    ) {
      throw new ForbiddenException(
        'Resource is not accessible in this project',
      );
    }
    if (owner.projectId)
      await this.access.assertProject(userId, organizationId, owner.projectId);
    else await this.access.assertOrganization(userId, organizationId);
  }
}
