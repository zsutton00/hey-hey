import { useProposalWorkItemTargets } from "../../data/hooks/useProposalWorkItemTargets";
import { useProposalDesignDocTargets } from "../../data/hooks/useProposalDesignDocTargets";
import type { ProposalTargetRead } from "../../data/hooks/proposalTargetRead";
import { loadedEntity, type ProposalTarget } from "./proposalTarget";
import { TargetEntityType } from "../../api";
import type {
  ProposalResponseDto,
  TaskResponseDto,
  DesignDocResponseDto,
} from "../../api";

export type EntityData =
  | { type: "task"; data: TaskResponseDto }
  | { type: "designDoc"; data: DesignDocResponseDto };

export type EntityDataMap = Record<string, ProposalTarget>;

const toProposalTarget = <TItem>(
  read: ProposalTargetRead<TItem>,
  loaded: (item: TItem) => EntityData,
): ProposalTarget => {
  switch (read.state) {
    case "loading":
      return { type: "loading" };
    case "unavailable":
      return { type: "unavailable", failure: read.failure };
    case "ready":
      return loaded(read.item);
  }
};

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
    const target = live[proposal.targetEntityId];
    if (target?.type === "loading") {
      results[proposal.targetEntityId] = target;
      continue;
    }
    // A live read failure (e.g. the target was since deleted) still leaves
    // the retained values to show.
    const data = retainedEntityData(proposal, loadedEntity(target));
    if (data) results[proposal.targetEntityId] = data;
  }
  return results;
};

/**
 * Observes work-item targets and loads design-doc targets for proposal
 * comparisons, one entry per target. Retained comparisons overlay recorded
 * values on the current target context.
 */
export function useEntityData(
  proposals: ProposalResponseDto[],
  organizationId: string,
  projectId: string,
  source: EntityDataSource = "live",
): { entities: EntityDataMap } {
  const targetIds = (type: TargetEntityType) =>
    proposals
      .filter(({ targetEntityType }) => targetEntityType === type)
      .map(({ targetEntityId }) => targetEntityId);
  const tasks = useProposalWorkItemTargets(
    { organizationId, projectId },
    targetIds(TargetEntityType.Task),
  );
  const designDocs = useProposalDesignDocTargets(
    organizationId,
    targetIds(TargetEntityType.DesignDoc),
  );

  const entities: EntityDataMap = {};
  for (const [id, read] of Object.entries(tasks)) {
    entities[id] = toProposalTarget(read, (data) => ({ type: "task", data }));
  }
  for (const [id, read] of Object.entries(designDocs)) {
    entities[id] = toProposalTarget(read, (data) => ({
      type: "designDoc",
      data,
    }));
  }

  if (source === "retained") {
    return { entities: retainedEntityMap(proposals, entities) };
  }
  return { entities };
}
