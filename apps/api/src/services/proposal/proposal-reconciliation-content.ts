import type { Prisma } from '@prisma/client';
import { cloneDeep, isEqual } from 'lodash';
import type {
  UpdateTaskDto,
  UpdateDesignDocDto,
  WorkItemChangeSetValidationRequest,
  ProposalReconciliationBasis,
} from 'src/generated';

/** Full target content keyed by stable existing or change-set-local identity. */
export function projectReconciliationChangeSet(
  bases: ProposalReconciliationBasis[],
  request: WorkItemChangeSetValidationRequest,
): Prisma.JsonObject {
  const targets: Prisma.JsonObject = Object.fromEntries(
    bases.map((basis) => [
      `${basis.entityType}:${basis.entityId}`,
      cloneDeep(basis.content),
    ]),
  );
  for (const operation of request.operations) {
    const ref = 'ref' in operation ? operation.ref : operation.root;
    const type = operation.op.startsWith('relationship.') ? 'EDGE' : 'TASK';
    const id = ref.refType === 'existing' ? ref.id : `temporary:${ref.tempId}`;
    const key = `${type}:${id}`;
    if (
      operation.op === 'workItem.delete' ||
      operation.op === 'relationship.delete'
    ) {
      targets[key] = { deleted: true };
      continue;
    }
    const content = (targets[key] ??
      (type === 'EDGE'
        ? {}
        : { sections: {}, sectionOrder: {} })) as Prisma.JsonObject;
    if (
      operation.op === 'section.replace' ||
      operation.op === 'section.clear' ||
      operation.op === 'layout.replace' ||
      operation.op === 'layout.clear'
    ) {
      const sectionKey =
        'key' in operation ? operation.key : operation.sectionKey;
      const sections = content.sections as Prisma.JsonObject;
      if (operation.op === 'section.clear' || operation.op === 'layout.clear')
        sections[sectionKey] = null;
      else
        sections[sectionKey] = cloneDeep(
          operation.op === 'section.replace'
            ? operation.content
            : {
                schemaVersion: 'work-item-graph-layout.v1',
                nodes: operation.entries.map((entry) => ({
                  node: {
                    kind: 'persistedWorkItem',
                    workItemId:
                      entry.node.refType === 'existing'
                        ? entry.node.id
                        : `temporary:${entry.node.tempId}`,
                  },
                  position: entry.position,
                })),
              },
        ) as Prisma.JsonValue;
    } else {
      for (const [field, value] of Object.entries(operation)) {
        if (field === 'op' || field === 'ref' || value === undefined) continue;
        if (
          (operation.op === 'relationship.create' ||
            operation.op === 'relationship.update') &&
          (field === 'source' || field === 'target')
        ) {
          const endpoint = operation[field];
          if (endpoint)
            content[field === 'source' ? 'sourceNodeId' : 'targetNodeId'] =
              endpoint.refType === 'existing'
                ? endpoint.id
                : `temporary:${endpoint.tempId}`;
        } else if (field === 'edgeType') {
          content.type = value as Prisma.JsonValue;
        } else if (field === 'parent') {
          const parent =
            operation.op === 'workItem.update' ||
            operation.op === 'workItem.create'
              ? operation.parent
              : undefined;
          content.parentTaskId = parent
            ? parent.refType === 'existing'
              ? parent.id
              : `temporary:${parent.tempId}`
            : null;
        } else content[field] = cloneDeep(value) as Prisma.JsonValue;
      }
    }
    targets[key] = content;
  }
  return targets;
}

/**
 * Proposal updates are patches. Expand them against their original content
 * before a three-way merge so omission can never become an accidental delete.
 * Sections are keyed content; their display order is stored separately.
 */
export function projectReconciliationContent(
  original: Prisma.JsonObject,
  updates: UpdateTaskDto | UpdateDesignDocDto,
): Prisma.JsonObject {
  const candidate = cloneDeep(original);
  for (const [key, value] of Object.entries(updates)) {
    if (
      value === undefined ||
      key === 'sectionUpdateSource' ||
      key === 'reason'
    ) {
      continue;
    }
    if (key === 'sections') continue;
    candidate[key] = cloneDeep(value) as Prisma.JsonValue;
  }
  if (updates.sections) {
    const sections = cloneDeep(original.sections as Prisma.JsonObject);
    const sectionOrder = cloneDeep(original.sectionOrder as Prisma.JsonObject);
    for (const section of updates.sections) {
      if (section.content !== undefined) {
        Object.defineProperty(sections, section.key, {
          value: cloneDeep(section.content),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      if (section.order !== undefined && section.order !== null) {
        Object.defineProperty(sectionOrder, section.key, {
          value: section.order,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    candidate.sections = sections;
    candidate.sectionOrder = sectionOrder;
  }
  return candidate;
}

/** Reapply only the admitted patch's fields, with complete merged section content. */
export function reconciliationPatch(
  originalPatch: UpdateTaskDto | UpdateDesignDocDto,
  current: Prisma.JsonObject,
  candidate: Prisma.JsonObject,
): UpdateTaskDto | UpdateDesignDocDto {
  const patch = cloneDeep(originalPatch);
  for (const key of Object.keys(patch)) {
    if (key === 'sections' || key === 'sectionUpdateSource' || key === 'reason')
      continue;
    Object.defineProperty(patch, key, {
      value: candidate[key],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  if (patch.sections) {
    const sections = candidate.sections as Prisma.JsonObject;
    const currentSections = current.sections as Prisma.JsonObject;
    const order = candidate.sectionOrder as Record<string, number>;
    patch.sections = patch.sections
      .map((section) => ({
        ...section,
        content: sections[section.key],
        ...(section.order !== undefined && section.order !== null
          ? { order: order[section.key] }
          : {}),
      }))
      .filter(
        (section) =>
          !isEqual(currentSections[section.key], sections[section.key]) ||
          section.order !== undefined,
      ) as typeof patch.sections;
  }
  return patch;
}

const IDENTITY_FIELDS = new Set([
  'id',
  'entityId',
  'targetEntityId',
  'sourceEntityId',
  'proposalId',
  'targetProposalId',
  'parentTaskId',
  'parentEntityId',
  'sourceNodeId',
  'targetNodeId',
]);

export function remapReconciliationIdentity(
  value: Prisma.JsonValue,
  identities: ReadonlyMap<string, string>,
  field = '',
): Prisma.JsonValue {
  if (typeof value === 'string') {
    if (IDENTITY_FIELDS.has(field)) return identities.get(value) ?? value;
    return value.replace(
      /(@\[[^:\]]+:)([^|\]]+)(\|)/g,
      (_match, prefix: string, id: string, suffix: string) =>
        `${prefix}${identities.get(id) ?? id}${suffix}`,
    );
  }
  if (Array.isArray(value))
    return value.map((item) =>
      remapReconciliationIdentity(item, identities, field),
    );
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      remapReconciliationIdentity(item!, identities, key),
    ]),
  );
}
