import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { GoalAudience } from 'src/generated/model/goalAudience';
import { PrismaService } from 'src/prisma/prisma.service';
import { TaskId } from 'src/types';

/**
 * GoalMembership is a flat join between goal-typed tasks and users. The
 * presence of any row collapses a goal's audience to MEMBERS; absence
 * leaves it as PROJECT. project_members remains the source of truth for
 * who is allowed to be added — addMember rejects callers who try to add
 * a user that is not in the goal's project.
 */
@Injectable()
export class GoalMembershipService {
  private readonly logger = new Logger(GoalMembershipService.name);

  constructor(private readonly prisma: PrismaService) {}

  async isMember(goalId: TaskId, userId: string): Promise<boolean> {
    this.logger.log('isMember called', { goalId, userId });
    const row = await this.prisma.db.goalMembership.findUnique({
      where: { goalId_userId: { goalId, userId } },
      select: { id: true },
    });
    return row !== null;
  }

  async listMembers(goalId: TaskId): Promise<string[]> {
    this.logger.log('listMembers called', { goalId });
    const rows = await this.prisma.db.goalMembership.findMany({
      where: { goalId },
      select: { userId: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => r.userId);
  }

  async audienceFor(goalId: TaskId): Promise<GoalAudience> {
    this.logger.log('audienceFor called', { goalId });
    const count = await this.prisma.db.goalMembership.count({
      where: { goalId },
    });
    return count === 0 ? GoalAudience.Project : GoalAudience.Members;
  }

  async addMember(goalId: TaskId, userId: string): Promise<void> {
    this.logger.log('addMember called', { goalId, userId });

    const goal = await this.prisma.db.task.findFirst({
      where: { id: goalId, archivedAt: null },
      select: { id: true, type: true, projectId: true },
    });
    if (!goal) {
      throw new NotFoundException(`Goal with ID ${goalId} not found.`);
    }
    if (goal.type !== WORK_ITEM_TYPE_KEYS.Goal) {
      throw new BadRequestException(
        'addMember requires a GOAL-typed task as the source.',
      );
    }

    const projectMember = await this.prisma.db.projectMember.findFirst({
      where: { projectId: goal.projectId, userId },
      select: { id: true },
    });
    if (!projectMember) {
      throw new BadRequestException(
        `User ${userId} is not a member of the goal's project; ` +
          'add them to the project before assigning to a goal.',
      );
    }

    await this.prisma.db.goalMembership.upsert({
      where: { goalId_userId: { goalId, userId } },
      create: { goalId, userId },
      update: {},
    });

    this.logger.log('addMember upserted', { goalId, userId });
  }

  async removeMember(goalId: TaskId, userId: string): Promise<void> {
    this.logger.log('removeMember called', { goalId, userId });
    await this.prisma.db.goalMembership.deleteMany({
      where: { goalId, userId },
    });
    this.logger.log('removeMember completed', { goalId, userId });
  }
}
