import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { GoalMembershipService } from '../goal-membership.service';
import { PrismaService } from '../../../prisma/prisma.service';
import * as TestUtils from '../../../utils/testUtils';
import { TaskId } from '../../../types';

const GOAL_ID = '00000000-0000-4000-8000-000000000010' as TaskId;
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const USER_ID = '00000000-0000-4000-8000-000000000020';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000021';

describe('GoalMembershipService', () => {
  let service: GoalMembershipService;
  let prisma: ReturnType<typeof TestUtils.createMockPrismaService>;

  beforeEach(() => {
    prisma = TestUtils.createMockPrismaService();
    service = new GoalMembershipService(prisma as unknown as PrismaService);
  });

  describe('isMember', () => {
    it('returns true when a membership row exists', async () => {
      (prisma.db.goalMembership.findUnique as jest.Mock).mockResolvedValue({
        id: 'gm-1',
      });

      await expect(service.isMember(GOAL_ID, USER_ID)).resolves.toBe(true);
      expect(prisma.db.goalMembership.findUnique).toHaveBeenCalledWith({
        where: { goalId_userId: { goalId: GOAL_ID, userId: USER_ID } },
        select: { id: true },
      });
    });

    it('returns false when no membership row exists', async () => {
      (prisma.db.goalMembership.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(service.isMember(GOAL_ID, USER_ID)).resolves.toBe(false);
    });
  });

  describe('listMembers', () => {
    it('returns user IDs ordered by createdAt ascending', async () => {
      (prisma.db.goalMembership.findMany as jest.Mock).mockResolvedValue([
        { userId: USER_ID },
        { userId: OTHER_USER_ID },
      ]);

      await expect(service.listMembers(GOAL_ID)).resolves.toEqual([
        USER_ID,
        OTHER_USER_ID,
      ]);
      expect(prisma.db.goalMembership.findMany).toHaveBeenCalledWith({
        where: { goalId: GOAL_ID },
        select: { userId: true },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('returns an empty array when no members exist', async () => {
      (prisma.db.goalMembership.findMany as jest.Mock).mockResolvedValue([]);

      await expect(service.listMembers(GOAL_ID)).resolves.toEqual([]);
    });
  });

  describe('audienceFor', () => {
    it('returns PROJECT when no membership rows exist', async () => {
      (prisma.db.goalMembership.count as jest.Mock).mockResolvedValue(0);

      await expect(service.audienceFor(GOAL_ID)).resolves.toBe('PROJECT');
    });

    it('returns MEMBERS when one or more membership rows exist', async () => {
      (prisma.db.goalMembership.count as jest.Mock).mockResolvedValue(1);

      await expect(service.audienceFor(GOAL_ID)).resolves.toBe('MEMBERS');
    });
  });

  describe('addMember', () => {
    it('throws NotFoundException when the goal is missing', async () => {
      (prisma.db.task.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.addMember(GOAL_ID, USER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws BadRequestException when the source task is not a GOAL', async () => {
      (prisma.db.task.findFirst as jest.Mock).mockResolvedValue({
        id: GOAL_ID,
        type: WORK_ITEM_TYPE_KEYS.Feature,
        projectId: PROJECT_ID,
      });

      await expect(service.addMember(GOAL_ID, USER_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the user is not a project member', async () => {
      (prisma.db.task.findFirst as jest.Mock).mockResolvedValue({
        id: GOAL_ID,
        type: WORK_ITEM_TYPE_KEYS.Goal,
        projectId: PROJECT_ID,
      });
      (prisma.db.projectMember.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.addMember(GOAL_ID, USER_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.db.goalMembership.upsert).not.toHaveBeenCalled();
    });

    it('upserts the membership row when the user is a project member', async () => {
      (prisma.db.task.findFirst as jest.Mock).mockResolvedValue({
        id: GOAL_ID,
        type: WORK_ITEM_TYPE_KEYS.Goal,
        projectId: PROJECT_ID,
      });
      (prisma.db.projectMember.findFirst as jest.Mock).mockResolvedValue({
        id: 'pm-1',
      });

      await service.addMember(GOAL_ID, USER_ID);

      expect(prisma.db.goalMembership.upsert).toHaveBeenCalledWith({
        where: { goalId_userId: { goalId: GOAL_ID, userId: USER_ID } },
        create: { goalId: GOAL_ID, userId: USER_ID },
        update: {},
      });
    });

    it('is idempotent — calling twice still routes through upsert', async () => {
      (prisma.db.task.findFirst as jest.Mock).mockResolvedValue({
        id: GOAL_ID,
        type: WORK_ITEM_TYPE_KEYS.Goal,
        projectId: PROJECT_ID,
      });
      (prisma.db.projectMember.findFirst as jest.Mock).mockResolvedValue({
        id: 'pm-1',
      });

      await service.addMember(GOAL_ID, USER_ID);
      await service.addMember(GOAL_ID, USER_ID);

      expect(prisma.db.goalMembership.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe('removeMember', () => {
    it('deletes the membership row when present', async () => {
      (prisma.db.goalMembership.deleteMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      await service.removeMember(GOAL_ID, USER_ID);

      expect(prisma.db.goalMembership.deleteMany).toHaveBeenCalledWith({
        where: { goalId: GOAL_ID, userId: USER_ID },
      });
    });

    it('is a no-op when the membership row is missing', async () => {
      (prisma.db.goalMembership.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      await expect(
        service.removeMember(GOAL_ID, USER_ID),
      ).resolves.toBeUndefined();
    });
  });
});
