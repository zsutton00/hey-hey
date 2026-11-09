import type { ContextRelatedEntityDto } from '@hey-hey/contracts/api/models';

/**
 * Consumer-selected policy for how many distinct related entities a Context
 * read returns. Absent means "return every candidate Graph provided".
 */
export interface RelatedEntitySelectionPolicy {
  maxEntities: number;
}

/** MCP get_context: coding agents get the most useful 100 neighbors. */
export const MCP_RELATED_ENTITY_SELECTION: RelatedEntitySelectionPolicy = {
  maxEntities: 100,
};

/**
 * Ranking settings. Tiers are ordered so a lower tier always outranks a
 * higher one regardless of route count: the consensus bonus is capped below
 * the gap between tiers.
 */
export const RELATED_ENTITY_RANKING = {
  /** Explicitly authored relationships (agent edges). */
  authoredTierScore: 300,
  /** Other direct relationships such as mentions, tracks, parent. */
  directTierScore: 200,
  /** Reachable only through a structural pivot, e.g. sibling via parent. */
  pivotOnlyTierScore: 100,
  /** Added per ln(1 + extra routes), mirroring Graph's consensus bonus. */
  consensusRouteWeight: 5,
  /** Must stay below the smallest gap between tier scores. */
  consensusCap: 50,
} as const;

const PIVOT_ONLY_RELATIONSHIP = 'sibling-via-parent';

export interface RelatedEntitySelectionResult {
  relatedEntities: ContextRelatedEntityDto[];
  candidateEntityCount: number;
  omittedEntityCount: number;
}

function rowScore(row: ContextRelatedEntityDto): number {
  if (row.source === 'agent') {
    return RELATED_ENTITY_RANKING.authoredTierScore;
  }

  if (row.relationship === PIVOT_ONLY_RELATIONSHIP) {
    return RELATED_ENTITY_RANKING.pivotOnlyTierScore;
  }

  return RELATED_ENTITY_RANKING.directTierScore;
}

/**
 * Groups relationship rows by entity so one neighbor reached by several
 * routes occupies one slot; its best route sets the tier and the extra
 * routes strengthen it.
 */
function scoreEntities(rows: ContextRelatedEntityDto[]) {
  const byEntity = new Map<string, ContextRelatedEntityDto[]>();
  for (const row of rows) {
    const group = byEntity.get(row.entityId) ?? [];
    group.push(row);
    byEntity.set(row.entityId, group);
  }

  return [...byEntity.entries()].map(([entityId, group]) => {
    const [first] = group;
    const best = Math.max(...group.map(rowScore));
    const consensus = Math.min(
      RELATED_ENTITY_RANKING.consensusCap,
      RELATED_ENTITY_RANKING.consensusRouteWeight *
        Math.log1p(group.length - 1),
    );

    return {
      entityId,
      displayName: first?.displayName ?? entityId,
      score: best + consensus,
      rows: group,
    };
  });
}

/**
 * Selects at most `policy.maxEntities` distinct entities, best first, with a
 * deterministic order (score, then name, then id). Every relationship row of
 * a selected entity is kept. Without a policy, rows pass through untouched.
 *
 * `graphOmittedCount` is the candidates Graph itself left out of its read, so
 * the disclosed totals stay accurate when Graph's own limit was hit.
 */
export function selectRelatedEntities(
  rows: ContextRelatedEntityDto[],
  policy: RelatedEntitySelectionPolicy | undefined,
  graphOmittedCount: number,
): RelatedEntitySelectionResult {
  const distinctCount = new Set(rows.map((row) => row.entityId)).size;
  const candidateEntityCount = distinctCount + graphOmittedCount;

  if (!policy) {
    return {
      relatedEntities: rows,
      candidateEntityCount,
      omittedEntityCount: graphOmittedCount,
    };
  }

  const ranked = scoreEntities(rows).sort(
    (left, right) =>
      right.score - left.score ||
      left.displayName.localeCompare(right.displayName) ||
      left.entityId.localeCompare(right.entityId),
  );
  const selected = ranked.slice(0, policy.maxEntities);

  return {
    relatedEntities: selected.flatMap((entity) => entity.rows),
    candidateEntityCount,
    omittedEntityCount: candidateEntityCount - selected.length,
  };
}
