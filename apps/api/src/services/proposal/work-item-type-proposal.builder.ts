import { BadRequestException } from '@nestjs/common';
import type { WorkItemTypeDefinitionDto } from '../../generated/model/workItemTypeDefinitionDto';
import { EntityType } from '../../generated/model/entityType';
import type { WorkItemTypeArchiveRequestDto } from '../../generated/model/workItemTypeArchiveRequestDto';
import { WorkItemTypeCascadeDeleteUpdatesPayload } from '../../generated/model/workItemTypeCascadeDeleteUpdatesPayload';
import type { RequestorContext } from '../../mcp/tools/requestor-context';
import type { StampedCreateProposalDto } from './proposal.types';

/**
 * Placeholder target id for a CREATE proposal whose to-be entity has no
 * registry row yet. Shared by every WORK_ITEM_TYPE create path so the
 * envelope is identical regardless of who assembled it.
 */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export const WORK_ITEM_TYPE_RESET_MARKER = 'RESET_TO_CANONICAL' as const;

export function normalizeWorkItemTypeParentage(
  definition: WorkItemTypeDefinitionDto,
): WorkItemTypeDefinitionDto {
  if ((definition.allowedParentTypes?.length ?? 0) === 0) {
    return definition;
  }

  if (definition.allowedParentEntityTypes === undefined) {
    return {
      ...definition,
      allowedParentEntityTypes: [EntityType.Task],
    };
  }

  if (!definition.allowedParentEntityTypes.includes(EntityType.Task)) {
    throw new BadRequestException(
      'allowedParentEntityTypes must include TASK when allowedParentTypes is non-empty.',
    );
  }

  return definition;
}

export function buildWorkItemTypeResetProposal(
  typeKey: string,
  requestorContext: RequestorContext,
): StampedCreateProposalDto {
  return {
    type: 'SINGLE',
    action: 'UPDATE',
    eli5: 'Restores the canonical rules for this work item type.',
    targetEntityId: typeKey,
    targetEntityType: 'WORK_ITEM_TYPE',
    updates: { resetToCanonical: WORK_ITEM_TYPE_RESET_MARKER },
    requestorContext,
    influences: [],
  };
}

/**
 * The two boundaries that submit a custom work-item-type — the admin form's
 * `WorkItemTypeController` and the agentic `create_work_item_type` MCP tool —
 * must produce a byte-for-byte identical proposal envelope so a definition
 * looks the same in the review surface no matter how it was authored. That
 * shared shape lives here; both callers stamp their own `requestorContext`
 * (user vs. agent source) and pass it in, and everything else about the
 * SINGLE/CREATE WORK_ITEM_TYPE proposal is assembled in one place.
 */
export interface BuildWorkItemTypeCreateProposalInput {
  /** The serialized type definition; parentage intent is normalized for review. */
  readonly definition: WorkItemTypeDefinitionDto;
  /** Identity/origin stamp produced by the caller's own stamper. */
  readonly requestorContext: RequestorContext;
  /** Provenance influences (empty for the form path; agent-supplied otherwise). */
  readonly influences?: StampedCreateProposalDto['influences'];
  /** Optional conversation link (agent path). */
  readonly conversationId?: string;
  /** The nil UUID for ordinary creation, or the retained key for restoration. */
  readonly targetEntityId?: string;
}

/**
 * Assemble the canonical SINGLE/CREATE WORK_ITEM_TYPE proposal envelope. The
 * definition's display name is the proposal title (a CREATE proposal must
 * carry a title — the to-be entity has no row to resolve one from), and the
 * normalized definition is the `updates` payload the validator and enactment read.
 */
export function buildWorkItemTypeCreateProposal(
  input: BuildWorkItemTypeCreateProposalInput,
): StampedCreateProposalDto {
  const { definition, requestorContext, influences, conversationId } = input;

  const normalizedDefinition = normalizeWorkItemTypeParentage(definition);

  return {
    type: 'SINGLE',
    action: 'CREATE',
    eli5: 'Creates this work item type for the project.',
    targetEntityId: input.targetEntityId ?? NIL_UUID,
    targetEntityType: 'WORK_ITEM_TYPE',
    title: normalizedDefinition.name,
    updates: normalizedDefinition,
    requestorContext,
    influences: influences ?? [],
    ...(conversationId ? { conversationId } : {}),
  };
}

export interface BuildWorkItemTypeEditProposalInput {
  readonly typeKey: string;
  readonly definition: WorkItemTypeDefinitionDto;
  readonly requestorContext: RequestorContext;
  readonly influences?: StampedCreateProposalDto['influences'];
  readonly conversationId?: string;
  readonly acknowledgeCanonicalCustomization?: boolean;
}

/**
 * Assemble the review proposal for a bounded edit to an existing custom type.
 * The registry key is the lifecycle identity exposed by the public API.
 */
export function buildWorkItemTypeEditProposal(
  input: BuildWorkItemTypeEditProposalInput,
): StampedCreateProposalDto {
  const normalizedDefinition = normalizeWorkItemTypeParentage(input.definition);

  return {
    type: 'SINGLE',
    action: 'UPDATE',
    eli5: 'Changes the rules for this work item type.',
    targetEntityId: input.typeKey,
    targetEntityType: 'WORK_ITEM_TYPE',
    updates: {
      definition: normalizedDefinition,
      ...(input.acknowledgeCanonicalCustomization === undefined
        ? {}
        : {
            acknowledgeCanonicalCustomization:
              input.acknowledgeCanonicalCustomization,
          }),
    },
    requestorContext: input.requestorContext,
    influences: input.influences ?? [],
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
  };
}

/**
 * Assemble a restoration review for a retained archived definition. Restore
 * remains a CREATE review, but its stable target key distinguishes it from a
 * new definition and lets approval transition the retained row in place.
 */
export function buildWorkItemTypeRestoreProposal(
  input: BuildWorkItemTypeEditProposalInput,
): StampedCreateProposalDto {
  return {
    type: 'SINGLE',
    action: 'CREATE',
    eli5: 'Restores this archived work item type.',
    targetEntityId: input.typeKey,
    targetEntityType: 'WORK_ITEM_TYPE',
    title: input.definition.name,
    updates: input.definition,
    requestorContext: input.requestorContext,
    influences: input.influences ?? [],
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
  };
}

export interface BuildWorkItemTypeArchiveProposalInput {
  readonly typeKey: string;
  readonly request: WorkItemTypeArchiveRequestDto;
  readonly requestorContext: RequestorContext;
}

/** Assemble the review proposal for archiving an existing custom type. */
export function buildWorkItemTypeArchiveProposal(
  input: BuildWorkItemTypeArchiveProposalInput,
): StampedCreateProposalDto {
  return {
    type: 'SINGLE',
    action: 'DELETE',
    eli5: 'Archives this work item type while keeping existing items.',
    targetEntityId: input.typeKey,
    targetEntityType: 'WORK_ITEM_TYPE',
    updates: input.request,
    requestorContext: input.requestorContext,
    influences: [],
  };
}

export interface BuildWorkItemTypeCascadeDeleteProposalInput {
  readonly typeKey: string;
  readonly itemCount: number;
  readonly edgeCount: number;
  readonly requestorContext: RequestorContext;
}

/** Assemble the distinct review proposal for irreversible cascade deletion. */
export function buildWorkItemTypeCascadeDeleteProposal(
  input: BuildWorkItemTypeCascadeDeleteProposalInput,
): StampedCreateProposalDto {
  const updates = {
    operation:
      WorkItemTypeCascadeDeleteUpdatesPayload.OperationEnum.CascadeDelete,
    cascade: true,
    typeKey: input.typeKey,
    itemCount: input.itemCount,
    edgeCount: input.edgeCount,
  } satisfies WorkItemTypeCascadeDeleteUpdatesPayload;

  return {
    type: 'SINGLE',
    action: 'DELETE',
    eli5: 'Permanently deletes this work item type and its items.',
    targetEntityId: input.typeKey,
    targetEntityType: 'WORK_ITEM_TYPE',
    updates,
    requestorContext: input.requestorContext,
    influences: [],
  };
}
