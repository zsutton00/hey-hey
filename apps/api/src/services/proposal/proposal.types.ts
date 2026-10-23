import type {
  CreateProposalRequestDto,
  CreateTaskDto,
  UpdateTaskDto,
  CreateDesignDocDto,
  UpdateDesignDocDto,
  WorkItemTypeArchiveRequestDto,
  WorkItemTypeCascadeDeleteUpdatesPayload,
  ProposalAction,
  ProposalType,
  ProposalResponseDto,
  ProposalOutOfDateStatus,
  WorkItemChangeSetMaterializationProgress,
  ProposalGroupMembership,
  ProposalEdgeDeclaration,
  TargetEntityType,
  FutureRevisionResponse,
} from 'src/generated';
import type {
  Prisma,
  Proposal,
  ProposalApprovalRecord,
  WorkItemChangeSetMaterialization,
  WorkItemChangeSetMaterializationCheckpoint,
  ProposalGroup,
  ProposalGroupMember,
} from '@prisma/client';
import type { ProposalApprovalDto } from 'src/generated';
import type { RequestorContext } from 'src/mcp/tools/requestor-context';
import type {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  ProposalId,
  ValidationSessionId,
} from 'src/types';
import { parseProposalApprovalFailure } from './proposal-approval-failure-diagnostic';

/**
 * Discriminated union: action + targetEntityType → concrete payload shape.
 *
 * Each variant ties a specific action/entity combination to the exact DTO
 * that the proposal's `updates` field must conform to. DELETE proposals
 * carry an empty object (the DB column is NOT NULL).
 */
export type ProposalPayload =
  | {
      action: 'VERSIONED_UPDATE';
      targetEntityType: 'TASK' | 'DESIGN_DOC';
      updates: import('src/generated').FutureRevisionMutation;
    }
  | { action: 'CREATE'; targetEntityType: 'TASK'; updates: CreateTaskDto }
  | { action: 'UPDATE'; targetEntityType: 'TASK'; updates: UpdateTaskDto }
  | {
      action: 'DELETE';
      targetEntityType: 'TASK';
      updates: Record<string, never>;
    }
  | {
      action: 'CREATE';
      targetEntityType: 'DESIGN_DOC';
      updates: CreateDesignDocDto;
    }
  | {
      action: 'UPDATE';
      targetEntityType: 'DESIGN_DOC';
      updates: UpdateDesignDocDto;
    }
  | {
      action: 'DELETE';
      targetEntityType: 'DESIGN_DOC';
      updates: Record<string, never>;
    }
  | {
      action: 'DELETE';
      targetEntityType: 'WORK_ITEM_TYPE';
      updates: WorkItemTypeArchiveRequestDto;
    }
  | {
      action: 'DELETE';
      targetEntityType: 'WORK_ITEM_TYPE';
      updates: WorkItemTypeCascadeDeleteUpdatesPayload;
    };

/**
 * Extract the updates type for a given action + entity type pair.
 *
 * Usage: `UpdatesFor<'CREATE', 'TASK'>` → `CreateTaskDto`
 */
export type UpdatesFor<A extends ProposalAction, T extends TargetEntityType> =
  Extract<ProposalPayload, { action: A; targetEntityType: T }> extends {
    updates: infer U;
  }
    ? U
    : never;

/**
 * The wire `CreateProposalRequestDto` types `requestorContext` as an open
 * `Record<string, any>` and marks it optional, which lets internal callers
 * forget to stamp it and only blow up at the runtime guard in
 * `ProposalService.create`. The service accepts this tightened shape instead:
 * `requestorContext` is required and carries the Zod-validated
 * `RequestorContext` produced by exactly one of the three stampers
 * (`buildUserRequestorContext`, `extractRequestorContext`,
 * `buildFlowRequestorContext`). Internal paths that construct a proposal
 * without going through a stamper now fail to compile rather than failing at
 * runtime.
 *
 */
export type StampedCreateProposalDto = Omit<
  CreateProposalRequestDto,
  'requestorContext'
> & {
  requestorContext: RequestorContext;
};

/**
 * Full input for creating a proposal: the typed payload plus envelope fields.
 * requestorId is derived from the authenticated user server-side.
 */
export type CreateProposalInput = ProposalPayload & {
  type: ProposalType;
  requestorContext?: object;
  validationSessionId?: string;
  conversationId?: string;
};

/**
 * A proposal response with properly typed `updates` and `targetEntityType`,
 * replacing the loose generated `{ [key: string]: any }`.
 */
export type TypedProposalResponse = Omit<
  ProposalResponseDto,
  'updates' | 'targetEntityType' | 'action'
> &
  ProposalPayload;

export const PROPOSAL_RESPONSE_BASE_RELATIONS_INCLUDE = {
  approvalRecords: true,
  groupMembership: {
    include: {
      group: {
        select: {
          status: true,
          revision: true,
          frozenRevision: true,
        },
      },
    },
  },
} satisfies Prisma.ProposalInclude;

export const PROPOSAL_RESPONSE_RELATIONS_INCLUDE = {
  ...PROPOSAL_RESPONSE_BASE_RELATIONS_INCLUDE,
  workItemChangeSetMaterialization: { include: { checkpoints: true } },
} satisfies Prisma.ProposalInclude;

export type ProposalGroupMembershipWithGroup = ProposalGroupMember & {
  group: Pick<ProposalGroup, 'status' | 'revision' | 'frozenRevision'>;
};

export type ProposalWithApprovals = Proposal & {
  approvalRecords?: ProposalApprovalRecord[];
  workItemChangeSetMaterialization?:
    | (WorkItemChangeSetMaterialization & {
        checkpoints: WorkItemChangeSetMaterializationCheckpoint[];
      })
    | null;
  groupMembership?: ProposalGroupMembershipWithGroup | null;
};

export type ProposalWithResponseRelations = Prisma.ProposalGetPayload<{
  include: typeof PROPOSAL_RESPONSE_RELATIONS_INCLUDE;
}>;

export function toProposalResponseDto(
  proposal: ProposalWithApprovals,
  requiredApprovals: number,
  reviewedFuture: FutureRevisionResponse | null = null,
  outOfDateStatus: ProposalOutOfDateStatus = 'NOT_APPLICABLE',
): TypedProposalResponse {
  const approvals: ProposalApprovalDto[] = (proposal.approvalRecords ?? []).map(
    (r) => ({
      userId: r.userId,
      type: r.type,
      reason: r.reason ?? null,
      createdAt: r.createdAt.toISOString(),
    }),
  );
  const materialization = proposal.workItemChangeSetMaterialization
    ? toMaterializationProgress(proposal.workItemChangeSetMaterialization)
    : undefined;
  const groupMembership = proposal.groupMembership
    ? ({
        groupId: proposal.groupMembership.groupId,
        memberId: proposal.groupMembership.id,
        memberOrder: proposal.groupMembership.memberOrder,
        revision:
          proposal.groupMembership.group.frozenRevision ??
          proposal.groupMembership.group.revision,
        lifecycle: proposal.groupMembership.group.status,
      } satisfies ProposalGroupMembership)
    : undefined;

  return {
    id: proposal.id as ProposalId,
    organizationId: proposal.organizationId as OrganizationId,
    projectId: proposal.projectId as ProjectId,
    type: proposal.type,
    action: proposal.action,
    status: proposal.status,
    targetEntityId: proposal.targetEntityId,
    targetEntityType: proposal.targetEntityType,
    ...(groupMembership ? { groupMembership } : {}),
    title: proposal.title ?? null,
    eli5: proposal.eli5 ?? undefined,
    updates: proposal.updates,
    reviewedFuture,
    requestorId: proposal.requestorId,
    requiredApprovals,
    requestorContext: proposal.requestorContext ?? undefined,
    influences:
      (proposal.influences as unknown as TypedProposalResponse['influences']) ??
      undefined,
    generatedWithVersion: proposal.generatedWithVersion ?? undefined,
    validationSessionId:
      (proposal.validationSessionId as ValidationSessionId) ?? undefined,
    conversationId: (proposal.conversationId as ConversationId) ?? undefined,
    messageId: (proposal.messageId as MessageId) ?? undefined,
    edges:
      (proposal.edges as unknown as ProposalEdgeDeclaration[]) ?? undefined,
    approvals,
    outOfDateStatus,
    materialization,
    ragEnabled: proposal.ragEnabled,
    applicationEligible: proposal.applicationEligible,
    retainedOriginalTargetContent:
      (proposal.retainedOriginalTargetContent as Record<
        string,
        unknown
      > | null) ?? null,
    createdAt: proposal.createdAt.toISOString(),
    updatedAt: proposal.updatedAt.toISOString(),
  } as TypedProposalResponse;
}

function toMaterializationProgress(
  materialization: WorkItemChangeSetMaterialization & {
    checkpoints: WorkItemChangeSetMaterializationCheckpoint[];
  },
): WorkItemChangeSetMaterializationProgress {
  if (materialization.status === 'PUBLISHING') {
    throw new Error(
      'PUBLISHING is not a valid convergent materialization protocol state.',
    );
  }
  const state =
    materialization.status === 'PREPARED'
      ? materialization.lastError
        ? 'RECOVERABLE_FAILURE'
        : 'QUEUED'
      : materialization.status;
  const persistedFailure = parseProposalApprovalFailure(
    materialization.lastError,
  );
  return {
    state,
    attemptCount: materialization.attemptCount,
    lastError: persistedFailure?.message ?? materialization.lastError,
    ...(persistedFailure?.diagnostic
      ? {
          diagnostic: persistedFailure.diagnostic,
        }
      : {}),
    lastAttemptedAt: materialization.lastAttemptedAt?.toISOString() ?? null,
    publishedAt: materialization.publishedAt?.toISOString() ?? null,
    fencesReleasedAt: materialization.fencesReleasedAt?.toISOString() ?? null,
    operations: [...materialization.checkpoints]
      .sort((left, right) => left.operationIndex - right.operationIndex)
      .map((checkpoint) => ({
        operationIndex: checkpoint.operationIndex,
        operationKind: checkpoint.operationKind,
        status: checkpoint.status,
        attemptCount: checkpoint.attemptCount,
        lastError: checkpoint.lastError,
        lastAttemptedAt: checkpoint.lastAttemptedAt?.toISOString() ?? null,
        completedAt: checkpoint.completedAt?.toISOString() ?? null,
      })),
  };
}
