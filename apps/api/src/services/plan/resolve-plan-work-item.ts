import type { Task } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { AnyTransactionClient } from '../../prisma/prisma.service';
import { ConversationId, OrganizationId, ProjectId } from '../../types';

/** Resolve generation ownership from the canonical, scoped Task identity. */
export async function resolveConversationPlanWorkItem(
  tx: AnyTransactionClient,
  organizationId: OrganizationId,
  projectId: ProjectId,
  conversationId: ConversationId,
) {
  const conversation = await tx.conversation.findFirst({
    where: { id: conversationId, organizationId, projectId },
    select: { workflowAboutId: true, workflowAboutType: true },
  });
  if (
    conversation?.workflowAboutType !== 'task' ||
    !conversation.workflowAboutId
  ) {
    throw new NotFoundException(
      'Plan generation conversation must reference a PLAN work item',
    );
  }
  const plan = await tx.task.findFirst({
    where: {
      id: conversation.workflowAboutId,
      organizationId,
      projectId,
      type: 'PLAN',
      archivedAt: null,
    },
    select: { id: true, name: true, parentTaskId: true },
  });
  if (!plan) throw new NotFoundException('Plan work item not found');
  return plan;
}

export async function resolveAncestorPlanWorkItem(
  tx: AnyTransactionClient,
  organizationId: OrganizationId,
  taskId: string,
): Promise<string | undefined> {
  const visited = new Set<string>();
  let currentId: string | null = taskId;
  let projectId: string | undefined;
  while (currentId) {
    if (visited.has(currentId))
      throw new Error('Cycle in work-item parent hierarchy');
    visited.add(currentId);
    const task: Pick<
      Task,
      'id' | 'type' | 'parentTaskId' | 'projectId'
    > | null = await tx.task.findFirst({
      where: {
        id: currentId,
        organizationId,
        ...(projectId ? { projectId } : {}),
      },
      select: { id: true, type: true, parentTaskId: true, projectId: true },
    });
    if (!task)
      throw new NotFoundException(
        `Work item ${currentId} not found in its hierarchy scope`,
      );
    projectId = task.projectId;
    if (task.type === 'PLAN') return task.id;
    currentId = task.parentTaskId;
  }
  return undefined;
}
