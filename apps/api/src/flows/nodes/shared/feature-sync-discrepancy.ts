import { z } from 'zod';

/**
 * Shared feature-sync discrepancy contract.
 *
 * Both feature-sync flows surface the same drift shape: the task-anchored
 * `feature-sync` flow (analyze + iterate against a task-seeded feature
 * tree) and the plan-anchored plan-shaping feature-sync nodes (analyze +
 * iterate against a design-doc-declared plan structure). This module is
 * the single source of truth for the discrepancy schema and the
 * safeParse-then-extract helper both flows depend on, so the contract
 * does not drift between them.
 *
 * `src/flows/nodes/feature-sync/schemas.ts` re-exports these names so the
 * task-anchored flow's existing importers keep working unchanged; the
 * plan-shaping nodes import them from here directly.
 */

/**
 * A single discrepancy surfaced by a feature-sync agent when it detects
 * drift between the declared structure and the observed code/tasks. The
 * shape is intentionally minimal: the agent describes the gap, optionally
 * links the affected entity, and proposes a remediation.
 */
export const featureSyncDiscrepancySchema = z.object({
  id: z.string().min(1).optional(),
  summary: z.string().min(1),
  rationale: z.string().min(1),
  entityType: z
    .enum(['FEATURE', 'TASK', 'DESIGN_DOC', 'SERVICE', 'OTHER'])
    .optional(),
  entityId: z.string().optional(),
  proposal: z.string().optional(),
});

export type FeatureSyncDiscrepancy = z.infer<
  typeof featureSyncDiscrepancySchema
>;

export const discrepancyListPayloadSchema = z.object({
  discrepancies: z.array(featureSyncDiscrepancySchema).min(1),
});

export type FeatureSyncDiscrepancyListPayload = z.infer<
  typeof discrepancyListPayloadSchema
>;

/**
 * safeParse a completion-message payload into the discrepancy list it
 * carries. Returns `undefined` when the payload does not satisfy the
 * `discrepancyListPayloadSchema` (e.g. an empty or malformed body), so
 * callers can guard their context mutation on a successful parse before
 * the engine's EXTERNAL_AGENT validator runs.
 */
export function parseDiscrepancyPayload(
  payload: unknown,
): FeatureSyncDiscrepancy[] | undefined {
  const result = discrepancyListPayloadSchema.safeParse(payload);
  return result.success ? result.data.discrepancies : undefined;
}

const FEATURE_SYNC_ITEM_ID_PREFIX = 'fs-';

/**
 * Gives every discrepancy a stable id. Ids the agent echoed back are kept when
 * they belong to `previous` and are not reused within the set, so the user's
 * per-item choices keep pointing at the same item across revision passes; any
 * other item gets the next unused `fs-N` so numbering never collides with an
 * earlier item.
 */
export function assignDiscrepancyIds(
  discrepancies: FeatureSyncDiscrepancy[],
  previous: FeatureSyncDiscrepancy[] = [],
): FeatureSyncDiscrepancy[] {
  const knownIds = new Set(
    previous.map((item) => item.id).filter((id): id is string => !!id),
  );
  let next = 0;
  for (const id of knownIds) {
    if (id.startsWith(FEATURE_SYNC_ITEM_ID_PREFIX)) {
      const n = Number(id.slice(FEATURE_SYNC_ITEM_ID_PREFIX.length));
      if (Number.isInteger(n) && n > next) next = n;
    }
  }
  const used = new Set<string>();
  return discrepancies.map((item) => {
    if (item.id && knownIds.has(item.id) && !used.has(item.id)) {
      used.add(item.id);
      return item;
    }
    next += 1;
    const id = `${FEATURE_SYNC_ITEM_ID_PREFIX}${next}`;
    used.add(id);
    return { ...item, id };
  });
}
