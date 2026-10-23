import { BadRequestException, Logger } from '@nestjs/common';
import { ProposalEdgeEndpointMode } from 'src/generated/model/proposalEdgeEndpointMode';
import type { Prisma } from '@prisma/client';
import type {
  CreateProposalDto,
  Influence,
  ProposalEdgeDeclaration,
} from 'src/generated';
import { EntityType as PrismaEntityType } from '@prisma/client';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import type { ProposalValidationIssue } from './proposal-validation.types';

const logger = new Logger('ProposalTitleSnapshot');

const PROPOSAL_TARGET_TYPE = 'PROPOSAL';
const USER_TARGET_TYPE = 'USER';

export type RegistryRow = {
  entityId: string;
  entityType: PrismaEntityType;
  entityName: string | null;
  deletedAt: Date | null;
};

export type TaskMetadataRow = {
  id: string;
  type: string;
  projectId: string;
};

export type DesignDocMetadataRow = {
  id: string;
  projectId: string | null;
};

export type ProposalMetadataRow = {
  id: string;
  title: string | null;
  action: string;
  status: string;
  targetEntityType: string;
  updates: Prisma.JsonValue;
};

export type ProposalReference = {
  entityId: string;
  entityType: string;
  needsExistence?: boolean;
  needsTaskMetadata?: boolean;
  needsTitle?: boolean;
};

export type ProposalReferenceMetadata = {
  registryRows: ReadonlyMap<string, RegistryRow>;
  registryRowsByEntityId: ReadonlyMap<string, readonly RegistryRow[]>;
  taskRows: ReadonlyMap<string, TaskMetadataRow>;
  designDocRows: ReadonlyMap<string, DesignDocMetadataRow>;
  proposalRows: ReadonlyMap<string, ProposalMetadataRow>;
  userNames: ReadonlyMap<string, string>;
};

export function proposalReferenceKey(reference: ProposalReference): string {
  return `${reference.entityId}:${reference.entityType}`;
}

function deduplicateReferences(
  references: readonly ProposalReference[],
): ProposalReference[] {
  const unique = new Map<string, ProposalReference>();
  for (const reference of references) {
    const key = proposalReferenceKey(reference);
    const existing = unique.get(key);
    unique.set(key, {
      entityId: reference.entityId,
      entityType: reference.entityType,
      needsExistence:
        existing?.needsExistence === true || reference.needsExistence === true,
      needsTaskMetadata:
        existing?.needsTaskMetadata === true ||
        reference.needsTaskMetadata === true,
      needsTitle:
        existing?.needsTitle === true || reference.needsTitle === true,
    });
  }
  return [...unique.values()];
}

function isResolvableEntityType(entityType: string): boolean {
  return (
    entityType !== PROPOSAL_TARGET_TYPE &&
    Object.values(PrismaEntityType).includes(entityType as PrismaEntityType)
  );
}

async function fetchUserNames(
  db: AnyTransactionClient,
  userIds: string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) {
    return new Map();
  }
  const users: Array<{ id: string; name: string }> = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

async function fetchTaskMetadata(
  db: AnyTransactionClient,
  organizationId: OrganizationId,
  taskIds: string[],
): Promise<Map<string, TaskMetadataRow>> {
  if (taskIds.length === 0) {
    return new Map();
  }
  const tasks: TaskMetadataRow[] = await db.task.findMany({
    where: {
      id: { in: taskIds },
      organizationId,
      archivedAt: null,
    },
    select: { id: true, type: true, projectId: true },
  });
  return new Map(tasks.map((task) => [task.id, task]));
}

async function fetchRegistryRows(
  db: AnyTransactionClient,
  organizationId: OrganizationId,
  pairs: Array<{ entityId: string; entityType: string }>,
): Promise<{
  exact: Map<string, RegistryRow>;
  byEntityId: Map<string, RegistryRow[]>;
}> {
  if (pairs.length === 0) {
    return { exact: new Map(), byEntityId: new Map() };
  }

  const entityIds = [...new Set(pairs.map(({ entityId }) => entityId))];
  const where: Prisma.EntityRegistryWhereInput = {
    organizationId,
    entityId: { in: entityIds },
  };

  const rows: RegistryRow[] = await db.entityRegistry.findMany({
    where,
    select: {
      entityId: true,
      entityType: true,
      entityName: true,
      deletedAt: true,
    },
  });

  const exact = new Map(
    rows.map((row: RegistryRow) => [
      proposalReferenceKey({
        entityId: row.entityId,
        entityType: row.entityType,
      }),
      row,
    ]),
  );
  const byEntityId = new Map<string, RegistryRow[]>();
  for (const row of rows) {
    const existing = byEntityId.get(row.entityId) ?? [];
    existing.push(row);
    byEntityId.set(row.entityId, existing);
  }
  return { exact, byEntityId };
}

async function fetchDesignDocMetadata(
  db: AnyTransactionClient,
  organizationId: OrganizationId,
  designDocIds: string[],
): Promise<Map<string, DesignDocMetadataRow>> {
  if (designDocIds.length === 0) {
    return new Map();
  }
  const rows: DesignDocMetadataRow[] = await db.designDoc.findMany({
    where: {
      id: { in: designDocIds },
      organizationId,
      archivedAt: null,
    },
    select: { id: true, projectId: true },
  });
  return new Map(rows.map((row) => [row.id, row]));
}

async function fetchProposalMetadata(
  db: AnyTransactionClient,
  organizationId: OrganizationId,
  projectId: ProjectId | undefined,
  proposalIds: string[],
): Promise<Map<string, ProposalMetadataRow>> {
  if (!projectId || proposalIds.length === 0) {
    return new Map();
  }
  const rows: ProposalMetadataRow[] = await db.proposal.findMany({
    where: {
      id: { in: proposalIds },
      organizationId,
      projectId,
    },
    select: {
      id: true,
      title: true,
      action: true,
      status: true,
      targetEntityType: true,
      updates: true,
    },
  });
  return new Map(rows.map((row) => [row.id, row]));
}

function pickTitleFromRow(row: RegistryRow | undefined): string | null {
  if (!row) return null;
  if (row.deletedAt) return null;
  return row.entityName ?? null;
}

/**
 * Resolve every reference needed by one proposal-authoring operation in a
 * coordinated pass. Each backing table is queried at most once, and duplicate
 * references across influences, edges, and proposal targets are collapsed.
 */
export async function loadProposalReferenceMetadata(
  db: AnyTransactionClient,
  organizationId: OrganizationId,
  references: readonly ProposalReference[],
  projectId?: ProjectId,
): Promise<ProposalReferenceMetadata> {
  const uniqueReferences = deduplicateReferences(references);
  const registryReferences = uniqueReferences.filter(
    ({ entityType, needsExistence, needsTitle }) =>
      (needsExistence === true || needsTitle === true) &&
      isResolvableEntityType(entityType),
  );
  const userIds = uniqueReferences
    .filter(
      ({ entityType, needsTitle }) =>
        needsTitle === true && entityType === USER_TARGET_TYPE,
    )
    .map(({ entityId }) => entityId);
  const taskIds = uniqueReferences
    .filter(
      ({ entityType, needsExistence, needsTaskMetadata }) =>
        (needsExistence === true || needsTaskMetadata === true) &&
        entityType === 'TASK',
    )
    .map(({ entityId }) => entityId);

  const designDocIds = uniqueReferences
    .filter(
      ({ entityType, needsExistence }) =>
        needsExistence === true && entityType === 'DESIGN_DOC',
    )
    .map(({ entityId }) => entityId);
  const proposalIds = uniqueReferences
    .filter(
      ({ entityType, needsExistence }) =>
        needsExistence === true && entityType === PROPOSAL_TARGET_TYPE,
    )
    .map(({ entityId }) => entityId);

  const [registry, userNames, taskRows, designDocRows, proposalRows] =
    await Promise.all([
      fetchRegistryRows(db, organizationId, registryReferences),
      fetchUserNames(db, userIds),
      fetchTaskMetadata(db, organizationId, taskIds),
      fetchDesignDocMetadata(db, organizationId, designDocIds),
      fetchProposalMetadata(db, organizationId, projectId, proposalIds),
    ]);

  return {
    registryRows: registry.exact,
    registryRowsByEntityId: registry.byEntityId,
    taskRows,
    designDocRows,
    proposalRows,
    userNames,
  };
}

/**
 * Enforce the live endpoint contract for proposal edge declarations. Title
 * snapshots are intentionally independent: a supplied title never bypasses
 * this identity, type, liveness, or scope check.
 */
export function assertProposalEdgeTargetsResolvable(
  edges: ProposalEdgeDeclaration[] | undefined,
  metadata: ProposalReferenceMetadata,
  projectId: ProjectId,
  allowedUnmaterializedTargetKeys: ReadonlySet<string> = new Set(),
): void {
  const errors = validateProposalEdgeTargetsResolvable(
    edges,
    metadata,
    projectId,
    allowedUnmaterializedTargetKeys,
  );
  if (errors.length > 0) {
    throw new BadRequestException({
      message: 'Proposal edge targets must resolve before authoring',
      errors,
    });
  }
}

export function validateProposalEdgeTargetsResolvable(
  edges: ProposalEdgeDeclaration[] | undefined,
  metadata: ProposalReferenceMetadata,
  projectId: ProjectId,
  allowedUnmaterializedTargetKeys: ReadonlySet<string> = new Set(),
  fieldPrefix = '',
): ProposalValidationIssue[] {
  if (!edges || edges.length === 0) {
    return [];
  }

  const errors: ProposalValidationIssue[] = [];

  for (const [index, edge] of edges.entries()) {
    const targetEntityType = edge.targetEntityType as string;
    const targetKey = proposalReferenceKey({
      entityId: edge.targetEntityId,
      entityType: targetEntityType,
    });
    const targetField = `${fieldPrefix}edges[${index}].targetEntityId`;
    const typeField = `${fieldPrefix}edges[${index}].targetEntityType`;
    const addError = (field: string, reason: string) => {
      errors.push({
        field,
        code: 'unresolved_reference',
        reason,
        layer: 'referential',
      });
    };

    if (targetEntityType === PROPOSAL_TARGET_TYPE) {
      if (!metadata.proposalRows.has(edge.targetEntityId)) {
        addError(
          targetField,
          `PROPOSAL target ${edge.targetEntityId} was not found in this organization and project`,
        );
      }
      continue;
    }

    if (targetEntityType !== 'TASK' && targetEntityType !== 'DESIGN_DOC') {
      continue;
    }

    if (allowedUnmaterializedTargetKeys.has(targetKey)) {
      continue;
    }

    const registryRow = metadata.registryRows.get(targetKey);
    if (!registryRow) {
      const wrongTypeRows = (
        metadata.registryRowsByEntityId.get(edge.targetEntityId) ?? []
      ).filter((row) => !row.deletedAt && row.entityType !== targetEntityType);
      if (wrongTypeRows.length > 0) {
        addError(
          typeField,
          `Target ${edge.targetEntityId} is registered as ${wrongTypeRows
            .map((row) => row.entityType)
            .join(', ')}, not ${targetEntityType}`,
        );
      } else {
        addError(
          targetField,
          `${targetEntityType} target ${edge.targetEntityId} is missing or deleted`,
        );
      }
      continue;
    }

    if (registryRow.deletedAt) {
      addError(
        targetField,
        `${targetEntityType} target ${edge.targetEntityId} is deleted`,
      );
      continue;
    }

    if (targetEntityType === 'TASK') {
      const task = metadata.taskRows.get(edge.targetEntityId);
      if (!task || task.projectId !== projectId) {
        addError(
          targetField,
          `TASK target ${edge.targetEntityId} is outside this organization and project or is deleted`,
        );
      }
      continue;
    }

    const designDoc = metadata.designDocRows.get(edge.targetEntityId);
    if (!designDoc) {
      addError(
        targetField,
        `DESIGN_DOC target ${edge.targetEntityId} is outside this organization or is deleted`,
      );
    }
  }

  return errors;
}

/**
 * Snapshot display and subtype metadata for proposal influences. Missing
 * `entityTitle` values are resolved as before. Missing `taskType` values are
 * resolved only for TASK influences from the authoritative Task row.
 *
 * Caller-supplied snapshot values win — the resolver only fills holes.
 */
export async function snapshotInfluenceReferences(
  db: AnyTransactionClient,
  organizationId: OrganizationId,
  influences: Influence[] | undefined,
  metadata?: ProposalReferenceMetadata,
): Promise<Influence[] | undefined> {
  if (!influences || influences.length === 0) {
    return influences;
  }

  const lookup =
    metadata ??
    (await loadProposalReferenceMetadata(
      db,
      organizationId,
      influences
        .filter(
          (influence) =>
            influence.entityTitle === undefined ||
            (influence.entityType === 'TASK' &&
              influence.taskType === undefined),
        )
        .map((influence) => ({
          entityId: influence.entityId,
          entityType: influence.entityType,
          needsTitle: influence.entityTitle === undefined,
          needsTaskMetadata:
            influence.entityType === 'TASK' && influence.taskType === undefined,
        })),
    ));

  return influences.map((inf) => {
    let snapshotted = inf;

    if (inf.entityTitle === undefined) {
      if (inf.entityType === USER_TARGET_TYPE) {
        const name = lookup.userNames.get(inf.entityId) ?? null;
        if (name === null) {
          logger.warn('Influence USER target missing from user table', {
            organizationId,
            entityId: inf.entityId,
          });
        }
        snapshotted = { ...snapshotted, entityTitle: name };
      } else if (!isResolvableEntityType(inf.entityType)) {
        snapshotted = { ...snapshotted, entityTitle: null };
      } else {
        const row = lookup.registryRows.get(
          proposalReferenceKey({
            entityId: inf.entityId,
            entityType: inf.entityType,
          }),
        );
        const title = pickTitleFromRow(row);
        if (title === null) {
          logger.warn('Influence target missing from entity registry', {
            organizationId,
            entityId: inf.entityId,
            entityType: inf.entityType,
            deleted: !!row?.deletedAt,
          });
        }
        snapshotted = { ...snapshotted, entityTitle: title };
      }
    }

    if (inf.entityType === 'TASK' && inf.taskType === undefined) {
      const taskType = lookup.taskRows.get(inf.entityId)?.type;
      if (taskType !== undefined) {
        snapshotted = { ...snapshotted, taskType };
      }
    }

    return snapshotted;
  });
}

/**
 * Fill in `targetEntityTitle` for proposal edge declarations.
 * Durable proposal links snapshot proposal titles from the scoped admission
 * metadata. Deferred entity declarations retain their existing title behavior.
 */
export async function snapshotEdgeTitles(
  db: AnyTransactionClient,
  organizationId: OrganizationId,
  edges: ProposalEdgeDeclaration[] | undefined,
  metadata?: ProposalReferenceMetadata,
): Promise<ProposalEdgeDeclaration[] | undefined> {
  if (!edges || edges.length === 0) {
    return edges;
  }

  const missing = edges
    .filter(
      (edge) =>
        edge.targetEntityTitle === undefined &&
        edge.targetEntityType !== PROPOSAL_TARGET_TYPE &&
        isResolvableEntityType(edge.targetEntityType),
    )
    .map((edge) => ({
      entityId: edge.targetEntityId,
      entityType: edge.targetEntityType,
      needsTitle: true,
    }));

  const lookup =
    metadata ??
    (await loadProposalReferenceMetadata(db, organizationId, missing));

  return edges.map((edge) => {
    if (edge.targetEntityTitle !== undefined) {
      return edge;
    }
    if (edge.targetEntityType === PROPOSAL_TARGET_TYPE) {
      if (edge.endpointMode === ProposalEdgeEndpointMode.Proposal) {
        const target = lookup.proposalRows.get(edge.targetEntityId)!;
        return { ...edge, targetEntityTitle: target.title };
      }
      return { ...edge, targetEntityTitle: null };
    }
    if (!isResolvableEntityType(edge.targetEntityType)) {
      return { ...edge, targetEntityTitle: null };
    }
    const row = lookup.registryRows.get(
      proposalReferenceKey({
        entityId: edge.targetEntityId,
        entityType: edge.targetEntityType,
      }),
    );
    const title = pickTitleFromRow(row);
    if (title === null) {
      logger.warn('Edge target missing from entity registry', {
        organizationId,
        targetEntityId: edge.targetEntityId,
        targetEntityType: edge.targetEntityType,
        deleted: !!row?.deletedAt,
      });
    }
    return { ...edge, targetEntityTitle: title };
  });
}

/**
 * Single-row variant for the server-stamped origin influence path.
 */
export async function resolveEntityTitle(
  db: AnyTransactionClient,
  organizationId: OrganizationId,
  entityId: string,
  entityType: string,
): Promise<string | null> {
  if (entityType === USER_TARGET_TYPE) {
    const lookup = await fetchUserNames(db, [entityId]);
    return lookup.get(entityId) ?? null;
  }
  if (!isResolvableEntityType(entityType)) {
    return null;
  }
  const lookup = await fetchRegistryRows(db, organizationId, [
    { entityId, entityType },
  ]);
  return pickTitleFromRow(lookup.exact.get(`${entityId}:${entityType}`));
}

/**
 * Resolve a per-action title snapshot for the proposal row itself.
 *
 * Caller-supplied `callerTitle` always wins (string or explicit null);
 * the resolver only fills holes when it is `undefined`.
 *
 * - CREATE → return the caller-supplied title or `null` if absent. The
 *   to-be entity has no registry row yet, so the writer is the only
 *   source of truth. The service rejects a CREATE proposal that
 *   arrives without a title; this resolver does not throw.
 * - UPDATE → return the caller-supplied title; otherwise read the
 *   target's title from the EntityRegistry. Calling this before the
 *   proposal is applied yields the *prior* title (the registry has not
 *   been renamed yet), which matches the snapshot semantic UPDATE wants —
 *   the diff body carries the new name.
 * - DELETE → return the caller-supplied title; otherwise read the
 *   target's current title from the EntityRegistry.
 *
 * UPDATE/DELETE targets missing from the registry land null with a warn
 * log, matching the contract of `snapshotInfluenceReferences` /
 * `snapshotEdgeTitles`.
 */
export async function resolveProposalTitle(args: {
  db: AnyTransactionClient;
  organizationId: OrganizationId;
  action: string;
  targetEntityType: string;
  targetEntityId: string;
  callerTitle: string | null | undefined;
  metadata?: ProposalReferenceMetadata;
}): Promise<string | null> {
  const {
    db,
    organizationId,
    action,
    targetEntityType,
    targetEntityId,
    callerTitle,
    metadata,
  } = args;

  if (callerTitle !== undefined) {
    return callerTitle;
  }

  if (action === 'CREATE') {
    return null;
  }

  if (
    action !== 'UPDATE' &&
    action !== 'DELETE' &&
    action !== 'VERSIONED_UPDATE'
  ) {
    return null;
  }

  if (!isResolvableEntityType(targetEntityType)) {
    return null;
  }

  const lookup =
    metadata ??
    (await loadProposalReferenceMetadata(db, organizationId, [
      {
        entityId: targetEntityId,
        entityType: targetEntityType,
        needsTitle: true,
      },
    ]));
  const row = lookup.registryRows.get(
    proposalReferenceKey({
      entityId: targetEntityId,
      entityType: targetEntityType,
    }),
  );
  const title = pickTitleFromRow(row);
  if (title === null) {
    logger.warn('Proposal target missing from entity registry', {
      organizationId,
      action,
      targetEntityId,
      targetEntityType,
      deleted: !!row?.deletedAt,
    });
  }
  return title;
}

export function collectProposalReferences(
  dtos: readonly CreateProposalDto[],
): ProposalReference[] {
  return dtos.flatMap((dto) => [
    ...(dto.action === 'CREATE' ||
    dto.targetEntityType === 'WORK_ITEM_TYPE' ||
    dto.targetEntityType === 'ENTITY_PROMPT_TEMPLATE'
      ? []
      : [
          {
            entityId: dto.targetEntityId,
            entityType: dto.targetEntityType,
            needsExistence: true,
            needsTaskMetadata: dto.targetEntityType === 'TASK',
            needsTitle: dto.title === undefined,
          },
        ]),
    ...(dto.influences ?? []).map(
      ({ entityId, entityType, entityTitle, taskType }) => ({
        entityId,
        entityType,
        needsExistence: false,
        needsTaskMetadata: entityType === 'TASK' && taskType === undefined,
        needsTitle: entityTitle === undefined,
      }),
    ),
    ...(dto.edges ?? []).map(
      ({
        targetEntityId: entityId,
        targetEntityType: entityType,
        targetEntityTitle,
      }) => ({
        entityId,
        entityType,
        needsExistence: true,
        needsTitle: targetEntityTitle === undefined,
      }),
    ),
  ]);
}
