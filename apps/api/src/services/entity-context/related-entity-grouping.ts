import type {
  ContextEntityRelationshipDto,
  ContextGroupedRelatedEntityDto,
  ContextRelatedEntityDto,
  FeatureHierarchyEntryDto,
} from '@hey-hey/contracts/api/models';
import { REQUIREMENT_CITATION_EDGE_REASONING } from '../tasks/feature-requirement-citation-edges';

/** A reason worth showing: present and not the stock requirement-citation text. */
function specificReasoning(reasoning: string | undefined): string | undefined {
  if (
    reasoning === undefined ||
    reasoning.trim() === '' ||
    reasoning === REQUIREMENT_CITATION_EDGE_REASONING
  ) {
    return undefined;
  }

  return reasoning;
}

function compareText(left: string | undefined, right: string | undefined) {
  return (left ?? '').localeCompare(right ?? '');
}

function toRelationship(
  row: ContextRelatedEntityDto,
  includeSource: boolean,
): ContextEntityRelationshipDto {
  const reasoning = specificReasoning(row.reasoning);

  return {
    relationship: row.relationship,
    ...(includeSource && row.source !== undefined
      ? { source: row.source }
      : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(row.via !== undefined ? { via: row.via } : {}),
  };
}

/**
 * Collapses relationship rows into one entry per entity. Entities keep the
 * order in which they first appear, so the ranking chosen by
 * `selectRelatedEntities` is preserved. `source` is left off every
 * relationship when all rows share it, since it then says nothing.
 */
export function groupRelatedEntities(
  rows: ContextRelatedEntityDto[],
): ContextGroupedRelatedEntityDto[] {
  const includeSource = new Set(rows.map((row) => row.source)).size > 1;

  const byEntity = new Map<string, ContextRelatedEntityDto[]>();
  for (const row of rows) {
    const group = byEntity.get(row.entityId) ?? [];
    group.push(row);
    byEntity.set(row.entityId, group);
  }

  return [...byEntity.values()].map((group) => {
    const [first] = group;
    if (!first) {
      throw new Error('Related entity group cannot be empty');
    }

    const relationships = group
      .map((row) => toRelationship(row, includeSource))
      .sort(
        (left, right) =>
          compareText(left.relationship, right.relationship) ||
          compareText(left.source, right.source),
      );

    return {
      entityId: first.entityId,
      entityType: first.entityType,
      displayName: first.displayName,
      ...(first.status !== undefined ? { status: first.status } : {}),
      ...(first.taskType !== undefined ? { taskType: first.taskType } : {}),
      relationships,
    };
  });
}

function hierarchyKey(entry: FeatureHierarchyEntryDto): string {
  return [
    entry.id,
    entry.relationshipType,
    entry.relationship ?? '',
    entry.direction ?? '',
  ].join('|');
}

/** The origin all given entries agree on; undefined when they disagree. */
function sharedSource(entries: FeatureHierarchyEntryDto[]) {
  const sources = new Set(entries.map((entry) => entry.source));

  return sources.size === 1 ? [...sources][0] : undefined;
}

/**
 * Lists each feature once per relationship type and direction. When several
 * edges collapse into one entry, written reasons win over the stock
 * requirement-citation text and empty ones; every distinct written reason is
 * kept, and with none the reason is omitted. The merged origin is the one
 * shared by the entries carrying a written reason (else by all entries);
 * when they disagree it is left off.
 */
export function groupFeatureHierarchy(
  entries: FeatureHierarchyEntryDto[],
): FeatureHierarchyEntryDto[] {
  const byKey = new Map<string, FeatureHierarchyEntryDto[]>();
  for (const entry of entries) {
    const group = byKey.get(hierarchyKey(entry)) ?? [];
    group.push(entry);
    byKey.set(hierarchyKey(entry), group);
  }

  return [...byKey.values()].map((group) => {
    const [first] = group;
    if (!first) {
      throw new Error('Feature hierarchy group cannot be empty');
    }

    const { reasoning: _stock, source: _first, ...rest } = first;
    const reasoned = group.filter(
      (entry) => specificReasoning(entry.reasoning) !== undefined,
    );
    const reasons = new Set(
      reasoned.map((entry) => specificReasoning(entry.reasoning) as string),
    );
    const source = sharedSource(reasoned.length > 0 ? reasoned : group);

    return {
      ...rest,
      ...(source !== undefined ? { source } : {}),
      ...(reasons.size > 0 ? { reasoning: [...reasons].join('\n') } : {}),
    };
  });
}
