import { useEffect, useMemo, useState } from "react";
import { TargetEntityType } from "../../api";
import type {
  ProposalResponseDto,
  TaskResponseDto,
  DesignDocResponseDto,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";

export type EntityData =
  | { type: "task"; data: TaskResponseDto }
  | { type: "designDoc"; data: DesignDocResponseDto };

export type EntityDataMap = Record<string, EntityData>;

/**
 * Where a proposal's "before" content comes from: the live entity, or the
 * target content the API retained on an eval proposal when it was made.
 */
export type EntityDataSource = "live" | "retained";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const RETAINED_SECTION_PATH = /^sections\.(.+)\.content$/;

/**
 * The API retains only the paths a proposal changes, keyed like proposal
 * history (`name`, `sections.<key>.content`), not a whole entity. Lay those
 * values over the live entity so every field the diff shows is what the
 * attempt saw, while unchanged context (e.g. the work-item type that decides
 * section layout) comes from the live item.
 */
const overlayRetainedPaths = (
  live: Record<string, unknown>,
  retained: Record<string, unknown>,
): Record<string, unknown> => {
  const entity: Record<string, unknown> = { ...live };
  const liveSections = Array.isArray(live.sections)
    ? (live.sections as Array<Record<string, unknown>>)
    : [];
  const sections = new Map(
    liveSections.map((section) => [String(section.key), section]),
  );
  for (const [path, value] of Object.entries(retained)) {
    const match = RETAINED_SECTION_PATH.exec(path);
    if (!match) {
      entity[path] = value;
      continue;
    }
    const key = match[1];
    sections.set(key, {
      ...sections.get(key),
      key,
      materializedMarkdown: typeof value === "string" ? value : null,
    });
  }
  entity.sections = [...sections.values()];
  return entity;
};

/**
 * The retained original target content applied to the live entity. Never
 * shows a live value for a changed field: eval output must show what the
 * attempt saw, so a proposal without retained content has no "before".
 */
export const retainedEntityData = (
  proposal: ProposalResponseDto,
  live: EntityData | undefined,
): EntityData | null => {
  const content: unknown = proposal.retainedOriginalTargetContent;
  if (!isRecord(content)) return null;
  const base = (live?.data ?? { id: proposal.targetEntityId }) as Record<
    string,
    unknown
  >;
  const entity = overlayRetainedPaths(base, content);
  if (proposal.targetEntityType === TargetEntityType.Task) {
    return { type: "task", data: entity as unknown as TaskResponseDto };
  }
  if (proposal.targetEntityType === TargetEntityType.DesignDoc) {
    return {
      type: "designDoc",
      data: entity as unknown as DesignDocResponseDto,
    };
  }
  return null;
};

const retainedEntityMap = (
  proposals: ProposalResponseDto[],
  live: EntityDataMap,
): EntityDataMap => {
  const results: EntityDataMap = {};
  for (const proposal of proposals) {
    const data = retainedEntityData(proposal, live[proposal.targetEntityId]);
    if (data) results[proposal.targetEntityId] = data;
  }
  return results;
};

/**
 * Loads existing entity data for each update/delete proposal on mount.
 * Derives a stable cache key from proposal entity IDs so the effect
 * only re-fires when the actual set of entities changes.
 *
 * Only TASK and DESIGN_DOC are fetched: those are EntityRegistry entities
 * with a get-by-id endpoint. Plans and stages use canonical Task identities.
 *
 * With source "retained" the content the API retained on each proposal is
 * laid over the live entity, so the diff survives later target changes.
 */
export function useEntityData(
  proposals: ProposalResponseDto[],
  organizationId: string,
  projectId: string,
  source: EntityDataSource = "live",
) {
  const [entities, setEntities] = useState<EntityDataMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const proposalKey = useMemo(
    () =>
      proposals
        .map((p) => `${p.targetEntityId}:${p.targetEntityType}`)
        .join("|"),
    [proposals],
  );

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      setLoading(true);
      setError(null);

      try {
        const results: EntityDataMap = {};

        await Promise.all(
          proposals.map(async (proposal) => {
            const entityId = proposal.targetEntityId;
            if (proposal.targetEntityType === TargetEntityType.Task) {
              const response = await unifiedApiClient.getTask({
                organizationId,
                projectId,
                taskId: entityId,
                includeServiceRelations: true,
              });
              const taskData = response.data.data;
              if (!cancelled && taskData) {
                results[entityId] = {
                  type: "task",
                  data: taskData,
                };
              }
            } else if (
              proposal.targetEntityType === TargetEntityType.DesignDoc
            ) {
              const response = await unifiedApiClient.getDesignDoc({
                organizationId,
                designDocId: entityId,
              });
              const docData = response.data.data;
              if (!cancelled && docData) {
                results[entityId] = {
                  type: "designDoc",
                  data: docData,
                };
              }
            }
          }),
        );

        if (!cancelled) {
          setEntities(results);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load entity data",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    if (proposals.length > 0) {
      fetchAll();
    } else {
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [proposalKey, organizationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const retained = useMemo(
    () =>
      source === "retained" ? retainedEntityMap(proposals, entities) : null,
    [proposals, source, entities],
  );

  // A live read failure (e.g. the target was since deleted) still leaves the
  // retained values to show.
  if (retained) return { entities: retained, loading, error: null };
  return { entities, loading, error };
}
