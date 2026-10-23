import { BadRequestException } from '@nestjs/common';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import type { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';
import {
  deriveChangedFields,
  type EntityContextInput,
  resolveEntityContext,
} from './entity-context-resolver';
import type { EntityContext, ProposalContext } from './permission-evaluation';

export type ProposalSourceContext = {
  source: 'user' | 'agent';
  toolName: string | null;
  authorId: string;
};

export async function resolvePermissionEvaluationContext(
  tx: AnyTransactionClient,
  organizationId: OrganizationId,
  projectId: ProjectId,
  entityInput: EntityContextInput,
  proposalInput: ProposalSourceContext,
  workItemTypeRegistry?: WorkItemTypeRegistryService,
): Promise<{ entity: EntityContext; proposal: ProposalContext }> {
  const eligibleMembers = await tx.projectMember.findMany({
    where: {
      projectId,
      user: {
        isActive: true,
        memberships: {
          some: { organizationId, isActive: true },
        },
      },
    },
    select: { userId: true },
  });

  const eligibleProjectMemberIds = eligibleMembers.map(
    (membership: { userId: string }) => membership.userId,
  );

  return resolvePermissionEvaluationContextWithEligibleMembers(
    tx,
    entityInput,
    proposalInput,
    eligibleProjectMemberIds,
    { organizationId, projectId, workItemTypeRegistry },
  );
}

export async function resolvePermissionEvaluationContextWithEligibleMembers(
  tx: AnyTransactionClient,
  entityInput: EntityContextInput,
  proposalInput: ProposalSourceContext,
  eligibleProjectMemberIds: readonly string[],
  context: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    workItemTypeRegistry?: WorkItemTypeRegistryService;
  },
): Promise<{ entity: EntityContext; proposal: ProposalContext }> {
  if (eligibleProjectMemberIds.length === 0) {
    throw new BadRequestException(
      'Permission evaluation requires at least one active project member',
    );
  }

  const entity = await resolveEntityContext(tx, entityInput);

  if (
    entityInput.action !== 'CREATE' &&
    entityInput.action !== 'UPDATE' &&
    entityInput.action !== 'VERSIONED_UPDATE' &&
    entityInput.action !== 'DELETE'
  ) {
    throw new BadRequestException(
      `Unsupported proposal action for permission evaluation: ${entityInput.action}`,
    );
  }

  return {
    entity,
    proposal: {
      ...proposalInput,
      action:
        entityInput.action === 'VERSIONED_UPDATE'
          ? 'UPDATE'
          : entityInput.action,
      eligibleProjectMemberIds,
      changedFields: await deriveChangedFields(tx, entityInput, context),
    },
  };
}
