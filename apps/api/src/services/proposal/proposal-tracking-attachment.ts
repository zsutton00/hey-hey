import { BadRequestException, NotFoundException } from '@nestjs/common';
import type {
  CreateProposalDto,
  CreateProposalRequestDto,
  ProposalEdgeDeclaration,
} from 'src/generated';
import { EntityType, ProposalEdgeType } from 'src/generated';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import { WORK_ITEM_TYPE_KEYS } from 'src/services/tasks/work-item-type-keys';
import type { WorkItemTypeRegistryService } from 'src/services/tasks/work-item-type-registry.service';
import type { OrganizationId, ProjectId } from 'src/types';
import type { StampedCreateProposalDto } from './proposal.types';

export function assertNoRawTracksDeclaration(dto: CreateProposalDto): void {
  if (dto.edges?.some((edge) => edge.edgeType === ProposalEdgeType.Tracks)) {
    throw new BadRequestException(
      'TRACKS cannot be authored through edges; use the structured tracks attachment.',
    );
  }
}

export async function assertCreateWorkItemTracksAttachmentValid(args: {
  db: AnyTransactionClient;
  registry: WorkItemTypeRegistryService;
  organizationId: OrganizationId;
  projectId: ProjectId;
  dto: Pick<
    CreateProposalDto,
    'action' | 'targetEntityType' | 'updates' | 'tracks'
  >;
}): Promise<void> {
  const { dto } = args;
  if (!dto.tracks) return;

  if (dto.action !== 'CREATE' || dto.targetEntityType !== 'TASK') {
    throw new BadRequestException(
      'tracks is only accepted on CREATE proposals targeting TASK.',
    );
  }
  const source = await args.db.task.findFirst({
    where: {
      id: dto.tracks.sourceEntityId,
      organizationId: args.organizationId,
      projectId: args.projectId,
      archivedAt: null,
    },
    select: { id: true, type: true },
  });
  if (!source) {
    throw new NotFoundException(
      `Tracking source work item ${dto.tracks.sourceEntityId} was not found in this project.`,
    );
  }

  const targetType =
    typeof (dto.updates as { type?: unknown }).type === 'string'
      ? ((dto.updates as { type: string }).type as string)
      : WORK_ITEM_TYPE_KEYS.Standard;
  const parentTaskId =
    typeof (dto.updates as { parentTaskId?: unknown }).parentTaskId === 'string'
      ? (dto.updates as { parentTaskId: string }).parentTaskId
      : undefined;
  if (
    !args.registry.isTrackingSourceAllowed(
      targetType,
      EntityType.Task,
      source.type,
      args.projectId,
    )
  ) {
    throw new BadRequestException(
      `Target work-item type ${targetType} does not allow tracking source type ${source.type}.`,
    );
  }

  // A tracking source is graph context, not implicitly the structural parent.
  // If callers deliberately use the same entity for both roles, fail at
  // proposal creation whenever the registry says that parent/child
  // relationship is impossible. This keeps the compound proposal reviewable
  // and prevents approval from being the first place a goal-like source is
  // rejected for having children.
  if (
    parentTaskId === source.id &&
    !args.registry.canParentChildType(source.type, targetType, args.projectId)
  ) {
    throw new BadRequestException(
      `Tracking source type ${source.type} cannot also be the structural parent of ${targetType}. ` +
        'Set parentTaskId to the feature or task that owns the new work item, and keep tracks.sourceEntityId as the tracking source.',
    );
  }
}

export function storeTracksAttachmentAsProposalEdge(
  dto: StampedCreateProposalDto,
): StampedCreateProposalDto;
export function storeTracksAttachmentAsProposalEdge<
  TProposal extends CreateProposalRequestDto,
>(dto: TProposal): TProposal;
export function storeTracksAttachmentAsProposalEdge(
  dto: CreateProposalDto,
): CreateProposalDto;
export function storeTracksAttachmentAsProposalEdge(
  dto: CreateProposalDto,
): CreateProposalDto {
  if (!dto.tracks) return dto;

  const trackingDeclaration = {
    targetEntityId: dto.tracks.sourceEntityId,
    targetEntityType: 'TASK',
    edgeType: ProposalEdgeType.Tracks,
    description: 'Tracks the newly created work item',
  } satisfies ProposalEdgeDeclaration;

  return {
    ...dto,
    tracks: undefined,
    edges: [...(dto.edges ?? []), trackingDeclaration],
  };
}

export async function assertStoredTracksDeclarationsValid(args: {
  db: AnyTransactionClient;
  registry: WorkItemTypeRegistryService;
  organizationId: OrganizationId;
  projectId: ProjectId;
  proposal: {
    action: string;
    targetEntityType: string;
    updates: unknown;
    edges: unknown;
  };
}): Promise<void> {
  const declarations = (args.proposal.edges ?? []) as ProposalEdgeDeclaration[];
  const tracks = declarations.filter(
    (edge) => edge.edgeType === ProposalEdgeType.Tracks,
  );
  if (tracks.length === 0) return;
  if (
    tracks.length !== 1 ||
    args.proposal.action !== 'CREATE' ||
    args.proposal.targetEntityType !== 'TASK' ||
    tracks[0]!.targetEntityType !== 'TASK'
  ) {
    throw new BadRequestException(
      'Stored TRACKS intent must contain exactly one TASK source on a CREATE/TASK proposal.',
    );
  }

  await assertCreateWorkItemTracksAttachmentValid({
    db: args.db,
    registry: args.registry,
    organizationId: args.organizationId,
    projectId: args.projectId,
    dto: {
      action: 'CREATE',
      targetEntityType: 'TASK',
      updates: args.proposal.updates as CreateProposalDto['updates'],
      tracks: { sourceEntityId: tracks[0]!.targetEntityId },
    },
  });
}
