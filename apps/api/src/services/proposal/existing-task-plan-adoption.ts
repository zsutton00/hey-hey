import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { Prisma, type Proposal } from '@prisma/client';
import { createHash } from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import { z } from 'zod';
import { WorkStatus } from '@hey-hey/contracts/api/models';
import type {
  PrismaService,
  AnyTransactionClient,
} from '../../prisma/prisma.service';
import type { OrganizationId, ProjectId, TaskId, UserId } from '../../types';
import type { TaskService } from '../tasks/task.service';
import type { DesignDocService } from '../design-doc/design-doc.service';
import { AgentEdgeEndpointEntityType } from '../../generated/graphs/model/agentEdgeEndpointEntityType';
import type { PendingEdgeService } from './pending-edge.service';
import { existingTaskPlanEligibilityIssues } from './existing-task-plan-eligibility';
import { planFromExistingTasksUpdatesSchema } from './proposal-validation.engine';
import {
  proposalApprovalFailureMessage,
  serializeProposalApprovalFailure,
  toProposalApprovalFailureDiagnostic,
} from './proposal-approval-failure-diagnostic';

const logger = new Logger('ExistingTaskPlanAdoption');
const edgeNamespace = '5f2f0ba3-e79a-4ed7-b5b8-20599639ca72';
const deliverySchema = z.object({
  kind: z.literal('existing-task-plan-delivery.v1'),
  edges: z.array(
    z.object({
      id: z.string().uuid(),
      sourceEntityId: z.string(),
      sourceEntityType: z.literal(AgentEdgeEndpointEntityType.Task),
      targetEntityId: z.string(),
      targetEntityType: z.enum([
        AgentEdgeEndpointEntityType.Task,
        AgentEdgeEndpointEntityType.DesignDoc,
      ]),
      edgeType: z.enum(['DEPENDS_ON', 'DERIVES_FROM']),
    }),
  ),
  postCommits: z.array(
    z.object({
      taskId: z.string(),
      postCommit: z.object({
        updateOriginalArtifact: z.boolean().optional(),
        statusChange: z
          .object({
            previousStatus: z.nativeEnum(WorkStatus),
            newStatus: z.nativeEnum(WorkStatus),
          })
          .optional(),
      }),
    }),
  ),
});

/** All entity writes share the approval transaction; Graph publication is durable and retryable. */
export async function adoptExistingTaskPlan(
  tx: AnyTransactionClient,
  proposal: Proposal,
  tasks: TaskService,
  documents: DesignDocService,
): Promise<string> {
  const payload = planFromExistingTasksUpdatesSchema.parse(proposal.updates);
  const organizationId = proposal.organizationId as OrganizationId;
  const projectId = proposal.projectId as ProjectId;
  // Use the same project lock as ordinary task writes before reading eligibility.
  await tx.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${organizationId}:${projectId}`}, 0))::text`,
  );
  const issues = await existingTaskPlanEligibilityIssues(
    tx,
    payload,
    organizationId,
    projectId,
  );
  if (issues.length > 0) {
    logger.warn('Plan adoption rejected', { proposalId: proposal.id, issues });
    throw new ConflictException({ message: issues[0]!.reason, issues });
  }
  const taskIds = payload.stages.flatMap((stage) => stage.taskIds);

  const plan = await tasks.createInTransaction(
    tx,
    organizationId,
    null,
    {
      name: payload.planTitle,
      type: 'PLAN',
      parentTaskId: payload.parentFeatureId,
      assigneeId: proposal.requestorId,
      status: WorkStatus.Backlog,
      sections: [
        { key: 'outcome', content: payload.planTitle },
        { key: 'description', content: payload.designDocMarkdown },
        {
          key: 'planConfiguration',
          content: {
            schemaVersion: 'plan-configuration.v1',
            planType: 'STANDARD',
            worktreeBranch: null,
          },
        },
      ],
    },
    projectId,
  );
  const doc = await documents.createInTransaction(tx, {
    name: payload.planTitle,
    template: 'PLAN_DOCUMENT',
    status: 'READY',
    projectId,
    organizationId,
    parentEntityType: 'TASK',
    parentEntityId: plan.id,
    sections: [
      { key: 'content', order: 0, content: payload.designDocMarkdown },
    ],
  });
  const edges: z.infer<typeof deliverySchema>['edges'] = [];
  function edge(
    source: string,
    target: string,
    edgeType: 'DEPENDS_ON' | 'DERIVES_FROM',
    targetEntityType:
      | typeof AgentEdgeEndpointEntityType.Task
      | typeof AgentEdgeEndpointEntityType.DesignDoc = AgentEdgeEndpointEntityType.Task,
  ) {
    edges.push({
      id: uuidv5(
        `${proposal.id}:${source}:${target}:${edgeType}`,
        edgeNamespace,
      ),
      sourceEntityId: source,
      sourceEntityType: AgentEdgeEndpointEntityType.Task,
      targetEntityId: target,
      targetEntityType,
      edgeType,
    });
  }
  edge(plan.id, doc.id, 'DERIVES_FROM', AgentEdgeEndpointEntityType.DesignDoc);
  const postCommits: z.infer<typeof deliverySchema>['postCommits'] = [];
  let previousStageId: string | undefined;
  for (const stage of payload.stages) {
    const createdStage = await tasks.createInTransaction(
      tx,
      organizationId,
      null,
      {
        name: stage.title,
        type: 'PLAN_STAGE',
        parentTaskId: plan.id,
        status: WorkStatus.Backlog,
        sections: stage.summary
          ? [{ key: 'description', content: stage.summary }]
          : [],
      },
      projectId,
    );
    if (previousStageId) {
      edge(createdStage.id, previousStageId, 'DEPENDS_ON');
    }
    previousStageId = createdStage.id;
    for (const id of stage.taskIds) {
      const { postCommit } = await tasks.updateInTransaction(
        tx,
        organizationId,
        null,
        id as TaskId,
        { parentTaskId: createdStage.id },
        proposal.requestorId as UserId,
      );
      postCommits.push({ taskId: id, postCommit });
    }
  }
  for (const entry of payload.taskPrerequisites ?? []) {
    for (const dependency of entry.dependsOnTaskIds) {
      edge(entry.taskId, dependency, 'DEPENDS_ON');
    }
  }
  await tx.workItemChangeSetMaterialization.create({
    data: {
      proposalId: proposal.id,
      organizationId,
      projectId,
      rootWorkItemId: plan.id,
      validationRevision: createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex'),
      priorProjectionRevision: 'existing-task-plan.v1',
      operationSet: payload,
      workItemIdMappings: {},
      relationshipIdMappings: {},
      priorProjection: {},
      targetProjection: {
        kind: 'existing-task-plan-delivery.v1',
        edges,
        postCommits,
      } as unknown as Prisma.InputJsonValue,
      affectedWorkItemIds: [plan.id, ...taskIds],
      affectedRelationshipIds: edges.map((entry) => entry.id),
    },
  });
  return plan.id;
}

/** Stable edge IDs and a locked final publication make retries preserve task and Plan identities. */
export async function publishExistingTaskPlan(
  db: PrismaService,
  proposal: Proposal,
  tasks: TaskService,
  pendingEdges: PendingEdgeService,
  publishApproved: (
    tx: AnyTransactionClient,
    proposal: Proposal,
    id: string,
  ) => Promise<void>,
): Promise<Proposal> {
  const intent = await db.db.workItemChangeSetMaterialization.findUnique({
    where: { proposalId: proposal.id },
  });
  if (!intent?.rootWorkItemId) {
    throw new BadRequestException(
      'Existing-task Plan delivery state is missing.',
    );
  }
  if (intent.status === 'PUBLISHED') {
    return db.db.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
  }
  const delivery = deliverySchema.parse(intent.targetProjection);
  const organizationId = proposal.organizationId as OrganizationId;
  const projectId = proposal.projectId as ProjectId;
  await db.db.workItemChangeSetMaterialization.updateMany({
    where: { id: intent.id, status: { not: 'PUBLISHED' } },
    data: {
      status: 'APPLYING',
      attemptCount: { increment: 1 },
      lastAttemptedAt: new Date(),
    },
  });
  try {
    await pendingEdges.materializeEdges(
      organizationId,
      projectId,
      delivery.edges,
      proposal.conversationId,
    );
    for (const entry of delivery.postCommits) {
      await tasks.runUpdatePostCommit(
        organizationId,
        entry.taskId as TaskId,
        entry.postCommit,
      );
    }
    return await db.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM work_item_change_set_materializations WHERE id = ${intent.id} FOR UPDATE`;
      const current =
        await tx.workItemChangeSetMaterialization.findUniqueOrThrow({
          where: { id: intent.id },
        });
      if (current.status === 'PUBLISHED') {
        return tx.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
      }
      const updated = await tx.proposal.update({
        where: { id: proposal.id },
        data: {
          targetEntityType: 'TASK',
          targetEntityId: intent.rootWorkItemId!,
        },
      });
      await publishApproved(tx, updated, intent.rootWorkItemId!);
      await tx.workItemChangeSetMaterialization.update({
        where: { id: intent.id },
        data: {
          status: 'PUBLISHED',
          completedAt: new Date(),
          publishedAt: new Date(),
          lastError: null,
        },
      });
      return updated;
    });
  } catch (error) {
    const diagnostic = toProposalApprovalFailureDiagnostic(error);
    await db.db.workItemChangeSetMaterialization.updateMany({
      where: { id: intent.id, status: { not: 'PUBLISHED' } },
      data: {
        status: 'PREPARED',
        lastError: serializeProposalApprovalFailure(
          proposalApprovalFailureMessage(error),
          diagnostic,
        ),
      },
    });
    throw error;
  }
}
