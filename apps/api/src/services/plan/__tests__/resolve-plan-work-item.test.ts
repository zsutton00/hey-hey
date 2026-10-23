import {
  resolveAncestorPlanWorkItem,
  resolveConversationPlanWorkItem,
} from '../resolve-plan-work-item';
import { AnyTransactionClient } from '../../../prisma/prisma.service';
import { ConversationId, OrganizationId, ProjectId } from '../../../types';

const org = 'org' as OrganizationId;
const project = 'project' as ProjectId;
const conversationId = 'conversation' as ConversationId;

function fixture() {
  const db = {
    conversation: {
      findFirst: jest
        .fn()
        .mockResolvedValue({
          workflowAboutType: 'task',
          workflowAboutId: 'plan-task',
        }),
    },
    task: {
      findFirst: jest
        .fn()
        .mockResolvedValue({
          id: 'plan-task',
          name: 'Plan',
          type: 'PLAN',
          parentTaskId: null,
          projectId: project,
        }),
    },
  };
  return { db, tx: db as unknown as AnyTransactionClient };
}

describe('canonical Plan ownership', () => {
  it('resolves migrated conversation ownership with no legacy tables', async () => {
    const { db, tx } = fixture();
    await expect(
      resolveConversationPlanWorkItem(tx, org, project, conversationId),
    ).resolves.toMatchObject({ id: 'plan-task' });
    expect(db.task.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'plan-task',
          organizationId: org,
          projectId: project,
          type: 'PLAN',
          archivedAt: null,
        },
      }),
    );
  });

  it('rejects legacy conversation ownership instead of using a fallback', async () => {
    const { db, tx } = fixture();
    db.conversation.findFirst.mockResolvedValue({
      workflowAboutType: 'plan',
      workflowAboutId: 'plan-task',
    });
    await expect(
      resolveConversationPlanWorkItem(tx, org, project, conversationId),
    ).rejects.toThrow('must reference a PLAN work item');
    expect(db.task.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a missing or out-of-scope Plan', async () => {
    const { db, tx } = fixture();
    db.task.findFirst.mockResolvedValue(null);
    await expect(
      resolveConversationPlanWorkItem(tx, org, project, conversationId),
    ).rejects.toThrow('Plan work item not found');
  });

  it('follows canonical parents while preserving project scope', async () => {
    const { db, tx } = fixture();
    db.task.findFirst
      .mockResolvedValueOnce({
        id: 'work',
        type: 'STANDARD',
        parentTaskId: 'stage',
        projectId: project,
      })
      .mockResolvedValueOnce({
        id: 'stage',
        type: 'PLAN_STAGE',
        parentTaskId: 'plan-task',
        projectId: project,
      });
    await expect(resolveAncestorPlanWorkItem(tx, org, 'work')).resolves.toBe(
      'plan-task',
    );
    expect(db.task.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'stage', organizationId: org, projectId: project },
      }),
    );
  });

  it('fails on cyclic parentage', async () => {
    const { db, tx } = fixture();
    db.task.findFirst.mockResolvedValue({
      id: 'work',
      type: 'STANDARD',
      parentTaskId: 'work',
      projectId: project,
    });
    await expect(resolveAncestorPlanWorkItem(tx, org, 'work')).rejects.toThrow(
      'Cycle',
    );
  });
});
