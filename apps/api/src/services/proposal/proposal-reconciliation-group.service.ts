import { ConflictException, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Prisma, Proposal } from '@prisma/client';
import { isEqual } from 'lodash';
import {
  PrismaService,
  type AnyTransactionClient,
} from 'src/prisma/prisma.service';
import type { AuthenticatedUser } from 'src/auth/strategies/jwt.strategy';
import type { OrganizationId, ProjectId, ConversationId } from 'src/types';
import type {
  ProposalUpdates,
  WorkItemChangeSetValidationRequest,
} from 'src/generated';
import type { StampedCreateProposalDto } from './proposal.types';
import type {
  ReconciliationProvenance,
  ReconciliationGroupMember,
} from './proposal-reconciliation.service';
import { ProposalGroupAuthoringService } from './proposal-group-authoring.service';
import { ProposalGroupFinalizationService } from './proposal-group-finalization.service';
import { remapReconciliationIdentity as remap } from './proposal-reconciliation-content';
import { WorkItemChangeSetMaterializerService } from './work-item-change-set-materializer.service';
import { ProposalReconciliationService } from './proposal-reconciliation.service';

@Injectable()
export class ProposalReconciliationGroupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModuleRef,
  ) {}

  async remainingCandidate(
    original: Proposal,
    updates: Prisma.JsonValue,
    materialization: Prisma.WorkItemChangeSetMaterializationGetPayload<{
      include: { checkpoints: true };
    }> | null,
  ) {
    const receipts = materialization
      ? await this.prisma.db.proposalReconciliationEffect.findMany({
          where: { materializationId: materialization.id },
        })
      : [];
    // The entity transaction can commit before its checkpoint acknowledgement.
    // Its durable receipt is equally authoritative evidence of a completed effect.
    const delivered = new Set(
      receipts.flatMap((receipt) => receipt.operationIndexes),
    );
    if (materialization) {
      const request =
        materialization.operationSet as unknown as WorkItemChangeSetValidationRequest;
      const identities = materialization.relationshipIdMappings as Record<
        string,
        string
      >;
      for (const checkpoint of materialization.checkpoints) {
        const operation = request.operations[checkpoint.operationIndex]!;
        if (
          operation.op !== 'relationship.create' ||
          checkpoint.status === 'COMPLETED' ||
          delivered.has(checkpoint.operationIndex)
        )
          continue;
        const id = identities[`temporary:${operation.ref.tempId}`];
        if (!id) continue;
        // Graph commits independently. Its reserved identity can prove creation
        // after a lost response without replaying or refreshing the original basis.
        const current = await this.modules
          .get(ProposalReconciliationService, { strict: false })
          .edgeBasis(original, id);
        if (current.version !== 'absent')
          delivered.add(checkpoint.operationIndex);
      }
    }
    const completed =
      materialization?.checkpoints.filter(
        (checkpoint) =>
          checkpoint.status === 'COMPLETED' ||
          delivered.has(checkpoint.operationIndex),
      ) ?? [];
    if (materialization && completed.length) {
      const previous =
        materialization.operationSet as unknown as WorkItemChangeSetValidationRequest;
      const proposed = ('operations' in (updates as Prisma.JsonObject)
        ? updates
        : this.modules
            .get(WorkItemChangeSetMaterializerService, { strict: false })
            .taskProposalChangeSet({
              ...original,
              updates,
            })) as unknown as WorkItemChangeSetValidationRequest;
      if (!proposed || !Array.isArray(proposed.operations)) {
        throw new ConflictException(
          'A partially applied change set must reconcile its remaining operations explicitly.',
        );
      }
      for (const checkpoint of completed) {
        if (
          !isEqual(
            previous.operations[checkpoint.operationIndex],
            proposed.operations[checkpoint.operationIndex],
          )
        ) {
          throw new ConflictException(
            'Completed operations are immutable. Preserve them in the candidate; they will not be replayed.',
          );
        }
      }
      const completedIndexes = new Set(
        completed.map((checkpoint) => checkpoint.operationIndex),
      );
      const workItems = materialization.workItemIdMappings as Record<
        string,
        string
      >;
      const relationships = materialization.relationshipIdMappings as Record<
        string,
        string
      >;
      const completedTemporaryIds = new Set(
        completed.flatMap((checkpoint) => {
          const operation = previous.operations[checkpoint.operationIndex]!;
          return operation.op === 'workItem.create' ||
            operation.op === 'relationship.create'
            ? [`${operation.op}:${operation.ref.tempId}`]
            : [];
        }),
      );
      const resolveCompleted = (
        value: Prisma.JsonValue,
        field = '',
        relationship = false,
      ): Prisma.JsonValue => {
        if (Array.isArray(value))
          return value.map((child) =>
            resolveCompleted(child, field, relationship),
          );
        if (value === null || typeof value !== 'object') return value;
        const edgeRef = field === 'ref' && relationship;
        if (
          value.refType === 'temporary' &&
          typeof value.tempId === 'string' &&
          completedTemporaryIds.has(
            `${edgeRef ? 'relationship.create' : 'workItem.create'}:${value.tempId}`,
          )
        ) {
          const id = (edgeRef ? relationships : workItems)[
            `temporary:${value.tempId}`
          ];
          if (!id)
            throw new ConflictException(
              'The completed operation is missing its durable identity mapping.',
            );
          return { refType: 'existing', id };
        }
        const isRelationship =
          typeof value.op === 'string' && value.op.startsWith('relationship.');
        return Object.fromEntries(
          Object.entries(value).map(([key, child]) => [
            key,
            resolveCompleted(child!, key, isRelationship),
          ]),
        );
      };
      updates = resolveCompleted({
        ...proposed,
        operations: proposed.operations.filter(
          (_operation, operationIndex) => !completedIndexes.has(operationIndex),
        ),
      } as unknown as Prisma.JsonValue);
    }
    return {
      updates,
      hasCompletedEffects: completed.length > 0,
      targetEntityId:
        materialization?.rootWorkItemId ?? original.targetEntityId,
    };
  }

  async replace(input: {
    groupId: string;
    proposalId: string;
    organizationId: OrganizationId;
    projectId: ProjectId;
    user: AuthenticatedUser;
    updates: ProposalUpdates;
    provenance: ReconciliationProvenance;
    requestorContext: StampedCreateProposalDto['requestorContext'];
  }): Promise<{ replacementGroupId: string; replacementProposalId: string }> {
    const group = await this.prisma.db.proposalGroup.findFirstOrThrow({
      where: {
        id: input.groupId,
        organizationId: input.organizationId,
        projectId: input.projectId,
      },
      include: {
        dependencies: true,
        members: {
          orderBy: { memberOrder: 'asc' },
          include: {
            proposal: {
              include: {
                workItemChangeSetMaterialization: {
                  include: { checkpoints: true },
                },
              },
            },
          },
        },
      },
    });
    if (
      group.status === 'BUILDING' ||
      group.members.some((member) => member.executionState === 'APPLYING')
    ) {
      throw new ConflictException(
        'A replacement requires a frozen group with no application in progress.',
      );
    }
    const pending = group.members.filter(
      (member) => member.executionState !== 'APPLIED',
    );
    const identities = new Map<string, string>();
    const remainingCandidates = await Promise.all(
      pending.map((member) =>
        this.remainingCandidate(
          member.proposal,
          (member.proposalId === input.proposalId
            ? input.updates
            : member.proposal.updates) as Prisma.JsonValue,
          member.proposal.workItemChangeSetMaterialization,
        ),
      ),
    );
    const members: ReconciliationGroupMember[] = pending.map(
      (member, index) => {
        const proposalId = randomUUID();
        identities.set(member.proposalId, proposalId);
        const hasCompletedEffects =
          remainingCandidates[index]!.hasCompletedEffects;
        const reservedEntityId =
          member.reservedTargetEntityId && !hasCompletedEffects
            ? randomUUID()
            : null;
        if (reservedEntityId)
          identities.set(member.reservedTargetEntityId!, reservedEntityId);
        return {
          proposalId,
          reservedEntityId,
          sourceProposalId: member.proposalId,
          ...(member.proposalId === input.proposalId
            ? { provenance: input.provenance }
            : {}),
        };
      },
    );
    for (const member of members)
      member.identityMappings = Object.fromEntries(identities);
    const proposals = pending.map((member, index): StampedCreateProposalDto => {
      const original = member.proposal;
      const remaining = remainingCandidates[index]!;
      const updates = remaining.updates;
      return {
        type: original.type,
        action:
          remaining.hasCompletedEffects && original.action === 'CREATE'
            ? 'UPDATE'
            : original.action,
        targetEntityType: original.targetEntityType,
        targetEntityId:
          members[index]!.reservedEntityId ??
          identities.get(original.targetEntityId) ??
          remaining.targetEntityId,
        title: original.title,
        eli5: 'Replacement group for fresh review; completed work is preserved.',
        updates: remap(updates, identities) as ProposalUpdates,
        requestorContext: input.requestorContext,
        ...(original.conversationId
          ? { conversationId: original.conversationId }
          : {}),
        ...(original.edges !== null
          ? {
              edges: remap(
                original.edges,
                identities,
              ) as unknown as StampedCreateProposalDto['edges'],
            }
          : {}),
        influences: [
          {
            entityType: 'PROPOSAL',
            entityId: original.id,
            entityTitle: original.title,
            reasonType: 'derived',
            reasoning:
              'Replacement review preserves the original frozen proposal and its decisions.',
          },
        ],
      };
    });
    const authoring = this.modules.get(ProposalGroupAuthoringService, {
      strict: false,
    });
    const finalization = this.modules.get(ProposalGroupFinalizationService, {
      strict: false,
    });
    let replacement = await authoring.start(
      input.organizationId,
      input.projectId,
      group.conversationId
        ? { originatingConversationId: group.conversationId as ConversationId }
        : {},
    );
    replacement = await authoring.addMembers(
      input.organizationId,
      input.projectId,
      replacement.groupId,
      input.user.userId,
      replacement.currentRevision,
      proposals,
      members,
    );
    const memberIds = new Map(
      pending.map((member, index) => [
        member.id,
        replacement.members[index]!.memberId,
      ]),
    );
    for (const member of pending) {
      const prerequisites = group.dependencies
        .filter((dependency) => dependency.dependentMemberId === member.id)
        .flatMap((dependency) =>
          memberIds.has(dependency.prerequisiteMemberId)
            ? [memberIds.get(dependency.prerequisiteMemberId)!]
            : [],
        );
      if (prerequisites.length)
        replacement = await authoring.replacePrerequisites(
          input.organizationId,
          input.projectId,
          replacement.groupId,
          memberIds.get(member.id)!,
          {
            expectedRevision: replacement.currentRevision,
            prerequisiteMemberIds: new Set(prerequisites),
          },
        );
    }
    const sourceState = group.members.map((member) => ({
      id: member.id,
      executionState: member.executionState,
      updatedAt: member.updatedAt.toISOString(),
    }));
    await this.prisma.db.proposalReconciliationReplacement.createMany({
      data: members.map((member) => ({
        proposalId: member.sourceProposalId,
        replacementProposalId: member.proposalId,
        groupId: group.id,
        replacementGroupId: replacement.groupId,
        sourceState,
      })),
    });
    const result = await finalization.finalize(
      input.organizationId,
      input.projectId,
      replacement.groupId,
      input.user,
      { expectedRevision: replacement.currentRevision },
    );
    if (result.outcome !== 'FINALIZED') throw new ConflictException(result);
    return {
      replacementGroupId: replacement.groupId,
      replacementProposalId: identities.get(input.proposalId)!,
    };
  }
}

export async function lockReconciliationReplacement(
  tx: AnyTransactionClient,
  replacementGroupId: string,
): Promise<string | null> {
  const replacement = await tx.proposalReconciliationReplacement.findFirst({
    where: { replacementGroupId },
  });
  if (!replacement) return null;
  await tx.$queryRaw`SELECT id FROM proposal_group_members WHERE group_id = ${replacement.groupId} ORDER BY id FOR UPDATE`;
  const members: { id: string; executionState: string; updatedAt: Date }[] =
    await tx.proposalGroupMember.findMany({
      where: { groupId: replacement.groupId },
      orderBy: { memberOrder: 'asc' },
      select: { id: true, executionState: true, updatedAt: true },
    });
  if (
    !isEqual(
      replacement.sourceState,
      members.map((member) => ({
        ...member,
        updatedAt: member.updatedAt.toISOString(),
      })),
    )
  ) {
    throw new ConflictException(
      'The original group advanced while preparing its replacement. Reconcile again against its current results.',
    );
  }
  return replacement.groupId;
}
