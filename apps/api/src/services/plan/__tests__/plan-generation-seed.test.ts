import { NotFoundException } from '@nestjs/common';
import { PlanFromDesignDocSeedService } from '../plan-from-design-doc-seed.service';
import { resolvePlanGenerationDesignDoc } from '../resolve-plan-generation-seed';
import { ConversationId, OrganizationId, ProjectId } from '../../../types';

const org = 'org' as OrganizationId;
const project = 'project' as ProjectId;
const links = { resolve: jest.fn().mockResolvedValue([]) };

describe('Plan generation work-item seeds', () => {
  it('loads a graph-linked Feature-owned seed without consulting legacy relationships or document ownership', async () => {
    const tx = {
      designDoc: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'feature-owned-doc', sections: [] }),
      },
      planRelationship: { findFirst: jest.fn() },
    };
    await expect(
      resolvePlanGenerationDesignDoc(tx, org, project, 'plan', {
        resolve: jest.fn().mockResolvedValue(['feature-owned-doc']),
      } as never),
    ).resolves.toEqual({ id: 'feature-owned-doc', sections: [] });
    expect(tx.planRelationship.findFirst).not.toHaveBeenCalled();
    expect(tx.designDoc.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ['feature-owned-doc'] },
          organizationId: org,
          projectId: project,
          archivedAt: null,
        },
      }),
    );
  });
  it('resolves a work-item conversation without requiring a legacy Plan row', async () => {
    const db = {
      designDoc: {
        findFirst: jest.fn().mockResolvedValue({ id: 'doc', sections: [] }),
      },
      planRelationship: { findFirst: jest.fn() },
    };
    const prisma = {
      db,
      conversation: {
        findUnique: jest.fn().mockResolvedValue({
          workflowAboutId: 'plan',
          workflowAboutType: 'task',
          organizationId: org,
          projectId: project,
        }),
      },
      task: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            id: 'plan',
            name: 'Canonical Plan',
            parentTaskId: null,
          }),
      },
    };
    Object.assign(db, {
      conversation: { findFirst: prisma.conversation.findUnique },
      task: prisma.task,
    });
    const service = new PlanFromDesignDocSeedService(
      prisma as never,
      links as never,
    );
    await expect(
      service.resolve('conversation' as ConversationId),
    ).resolves.toEqual({
      planId: 'plan',
      planTitle: 'Canonical Plan',
      designDocId: 'doc',
    });
    expect(db.planRelationship.findFirst).not.toHaveBeenCalled();
    expect(prisma.task.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'plan',
          organizationId: org,
          projectId: project,
          type: 'PLAN',
          archivedAt: null,
        },
      }),
    );
  });

  it('rejects legacy conversation ownership after the work-item cutover', async () => {
    const conversation = {
      workflowAboutId: 'plan',
      workflowAboutType: 'plan',
      organizationId: org,
      projectId: project,
    };
    const prisma = {
      conversation: { findUnique: jest.fn().mockResolvedValue(conversation) },
      db: {
        conversation: { findFirst: jest.fn().mockResolvedValue(conversation) },
      },
    };
    const service = new PlanFromDesignDocSeedService(
      prisma as never,
      links as never,
    );
    await expect(
      service.resolve('conversation' as ConversationId),
    ).rejects.toThrow(
      'Plan generation conversation must reference a PLAN work item',
    );
  });

  it('rejects a legacy-only document relationship', async () => {
    const tx = {
      designDoc: { findFirst: jest.fn().mockResolvedValue(null) },
      planRelationship: {
        findFirst: jest.fn().mockResolvedValue({ entityId: 'legacy-doc' }),
      },
    };
    await expect(
      resolvePlanGenerationDesignDoc(tx, org, project, 'plan', links as never),
    ).rejects.toThrow('Plan has no linked design document to generate from');
    expect(tx.planRelationship.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a missing or archived seed document', async () => {
    const tx = {
      designDoc: { findFirst: jest.fn().mockResolvedValue(null) },
      planRelationship: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    await expect(
      resolvePlanGenerationDesignDoc(tx, org, project, 'plan', links as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
