import { useProposalWorkItemTargets } from "../../data/hooks/useProposalWorkItemTargets";
import { useEffect, useState } from "react";
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
 * Observes work-item targets and loads design-doc targets for proposal comparisons.
 * Retained comparisons overlay recorded values on the current target context.
 */
export function useEntityData(
  proposals: ProposalResponseDto[],
  organizationId: string,
  projectId: string,
  source: EntityDataSource = "live",
) {
  const taskTargets = useProposalWorkItemTargets(
    { organizationId, projectId },
    proposals
      .filter(
        ({ targetEntityType }) => targetEntityType === TargetEntityType.Task,
      )
      .map(({ targetEntityId }) => targetEntityId),
  );
  const designDocIds = proposals
    .filter(
      ({ targetEntityType }) => targetEntityType === TargetEntityType.DesignDoc,
    )
    .map(({ targetEntityId }) => targetEntityId);
  const designDocKey = JSON.stringify([...new Set(designDocIds)].sort());
  const [designDocs, setDesignDocs] = useState<{
    organizationId: string;
    key: string;
    items: DesignDocResponseDto[];
    error: string | null;
  }>();

  useEffect(() => {
    const ids: string[] = JSON.parse(designDocKey);
    if (ids.length === 0) {
      return;
    }
    let cancelled = false;

    void Promise.all(
      ids.map(async (designDocId) => {
        const response = await unifiedApiClient.getDesignDoc({
          organizationId,
          designDocId,
        });
        return response.data.data;
      }),
    ).then(
      (items) => {
        if (!cancelled) {
          setDesignDocs({
            organizationId,
            key: designDocKey,
            items: items.filter((doc) => doc !== undefined),
            error: null,
          });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setDesignDocs({
            organizationId,
            key: designDocKey,
            items: [],
            error:
              error instanceof Error
                ? error.message
                : "Failed to load entity data",
          });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [designDocKey, organizationId]);

  const docs =
    designDocs?.key === designDocKey &&
    designDocs.organizationId === organizationId
      ? designDocs
      : undefined;
  const entities: EntityDataMap = {};
  for (const task of taskTargets.items) {
    entities[task.id] = { type: "task", data: task };
  }
  for (const doc of docs?.items ?? []) {
    entities[doc.id] = { type: "designDoc", data: doc };
  }
  const error = taskTargets.error?.message ?? docs?.error ?? null;
  const loading =
    !error && (taskTargets.loading || (designDocIds.length > 0 && !docs));

  const retained =
    source === "retained" ? retainedEntityMap(proposals, entities) : null;

  // A live read failure (e.g. the target was since deleted) still leaves the
  // retained values to show.
  if (retained) return { entities: retained, loading, error: null };
  return { entities, loading, error };
}
