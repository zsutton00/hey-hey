import { EntityType } from '@prisma/client';
import { EntityRelationshipResolverService } from '../entity-relationship-resolver.service';
import type { DesignDocLinkResponseDto } from '../../../generated/model/designDocLinkResponseDto';
import type { TaskService } from '../../tasks/task.service';
import type { DesignDocService } from '../../design-doc/design-doc.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type {
  DesignDocId,
  InitiativeId,
  OrganizationId,
  PlanId,
  TaskId,
} from '../../../types';

describe('EntityRelationshipResolverService', () => {
  const organizationId = 'org-1' as OrganizationId;
  const designDocId = 'doc-1' as DesignDocId;
  const parentDesignDocId = 'doc-parent' as DesignDocId;
  const taskId = 'task-1' as TaskId;
  const initiativeId = 'init-1' as InitiativeId;
  const planId = 'plan-1' as PlanId;

  const buildLink = (
    overrides: Partial<DesignDocLinkResponseDto>,
  ): DesignDocLinkResponseDto =>
    ({
      id: overrides.id ?? 'link-1',
      designDocId: overrides.designDocId ?? designDocId,
      organizationId,
      entityType: overrides.entityType ?? 'task',
      entityId: overrides.entityId ?? taskId,
      createdAt: overrides.createdAt ?? '2025-01-01T00:00:00.000Z',
      updatedAt: overrides.updatedAt ?? '2025-01-01T00:00:00.000Z',
    }) as DesignDocLinkResponseDto;

  const createMocks = () => {
    const designDocFindFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      db: {
        designDoc: { findFirst: designDocFindFirst },
        conversation: { findFirst: jest.fn().mockResolvedValue(null) },
        task: {
          findFirst: jest
            .fn()
            .mockResolvedValue({
              id: taskId,
              type: 'STANDARD',
              parentTaskId: null,
              projectId: 'project',
            }),
        },
      },
    } as unknown as jest.Mocked<PrismaService>;

    const taskService = {
      findOneForAdapter: jest.fn(),
    } as unknown as jest.Mocked<TaskService>;

    const designDocService = {
      getLinks: jest.fn(),
    } as unknown as jest.Mocked<DesignDocService>;

    return {
      prisma,
      taskService,
      designDocService,
      designDocFindFirst,
    };
  };

  it('resolves task and initiative from the design doc parent link', async () => {
    const { prisma, taskService, designDocService } = createMocks();

    designDocService.getLinks.mockResolvedValue([
      buildLink({ entityId: taskId }),
    ]);

    taskService.findOneForAdapter.mockResolvedValue({
      initiativeId,
    } as never);

    const resolver = new EntityRelationshipResolverService(
      prisma,
      taskService,
      designDocService,
    );

    const result = await resolver.resolveForWorkflowAbout({
      organizationId,
      workflowAboutType: 'design-doc',
      workflowAboutId: designDocId,
    });

    expect(result.resolvedContext.taskId).toBe(taskId);
    expect(result.resolvedContext.initiativeId).toBe(initiativeId);
    expect(result.additionalHeaders).toEqual({
      'X-Initiative-ID': initiativeId,
      'X-Task-ID': taskId,
    });
  });

  it('walks up to the parent design doc when no task is linked', async () => {
    const { prisma, taskService, designDocService, designDocFindFirst } =
      createMocks();

    designDocFindFirst.mockResolvedValueOnce({
      parentEntityId: parentDesignDocId,
    });

    designDocService.getLinks.mockResolvedValueOnce([]).mockResolvedValueOnce([
      buildLink({
        entityId: taskId,
        designDocId: parentDesignDocId,
      }),
    ]);

    taskService.findOneForAdapter.mockResolvedValue({
      initiativeId,
    } as never);

    const resolver = new EntityRelationshipResolverService(
      prisma,
      taskService,
      designDocService,
    );

    const result = await resolver.resolveForWorkflowAbout({
      organizationId,
      workflowAboutType: 'design-doc',
      workflowAboutId: designDocId,
    });

    expect(result.resolvedContext.taskId).toBe(taskId);
    expect(designDocService.getLinks).toHaveBeenCalledTimes(2);
  });

  it('prefers conversation-linked plan when available', async () => {
    const { prisma, taskService, designDocService } = createMocks();

    (prisma.db.conversation.findFirst as jest.Mock).mockResolvedValue({
      workflowAboutType: 'task',
      workflowAboutId: planId,
    });
    (prisma.db.task.findFirst as jest.Mock).mockResolvedValue({
      id: planId,
      type: 'PLAN',
      parentTaskId: null,
      projectId: 'project',
    });
    designDocService.getLinks.mockResolvedValue([]);

    const resolver = new EntityRelationshipResolverService(
      prisma,
      taskService,
      designDocService,
    );

    const result = await resolver.resolveForWorkflowAbout({
      organizationId,
      conversationId: 'conv-1',
      workflowAboutType: 'design-doc',
      workflowAboutId: designDocId,
    });

    expect(result.resolvedContext.planId).toBe(planId);
    expect(result.additionalHeaders['X-Plan-ID']).toBe(planId);
  });
});
