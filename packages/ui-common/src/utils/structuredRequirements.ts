import isEqual from "lodash/isEqual.js";
import type {
  FeatureRequirementRecord as GeneratedFeatureRequirementRecord,
  FeatureRequirementStoredCitation,
} from "../api";

export type FeatureRequirementCite = FeatureRequirementStoredCitation;

export type FeatureRequirementRecord = GeneratedFeatureRequirementRecord;

export interface RequirementPresentationItem {
  id: string;
  statement: string;
  group?: string;
  requirement: FeatureRequirementRecord;
}

export interface UngroupedRequirementBlock {
  kind: "ungrouped";
  requirements: readonly RequirementPresentationItem[];
}

export interface GroupedRequirementBlock {
  kind: "group";
  label: string;
  requirements: readonly RequirementPresentationItem[];
}

export type RequirementPresentationBlock =
  | UngroupedRequirementBlock
  | GroupedRequirementBlock;

export interface RequirementPresentationModel {
  blocks: readonly RequirementPresentationBlock[];
  byId: ReadonlyMap<string, RequirementPresentationItem>;
}

export type RequirementChangeKind =
  | "unchanged"
  | "added"
  | "removed"
  | "edited"
  | "group-changed";

export interface RequirementPresentationChange {
  id: string;
  kind: RequirementChangeKind;
  before?: RequirementPresentationItem;
  after?: RequirementPresentationItem;
}

const normalizeGroup = (
  group: string | null | undefined,
): string | undefined => {
  const normalized = group?.trim();
  return normalized ? normalized : undefined;
};

// A stored title is a write-time snapshot, not part of a citation's identity,
// so a differing title alone never marks a requirement as edited.
const withoutEntityTitles = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutEntityTitles);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "entityTitle")
      .map(([key, entry]) => [key, withoutEntityTitles(entry)]),
  );
};

const toPresentationItem = (
  requirement: FeatureRequirementRecord,
): RequirementPresentationItem => {
  const group = normalizeGroup(requirement.group);
  return {
    id: requirement.id,
    statement: requirement.statement,
    ...(group ? { group } : {}),
    requirement,
  };
};

/**
 * Groups only explicitly labeled records. The block order follows the first
 * occurrence of each group or the ungrouped block, while records retain their
 * canonical source order inside each block.
 */
export const buildRequirementPresentationModel = (
  records: readonly FeatureRequirementRecord[],
): RequirementPresentationModel => {
  const blocks: Array<
    | { kind: "ungrouped"; requirements: RequirementPresentationItem[] }
    | {
        kind: "group";
        label: string;
        requirements: RequirementPresentationItem[];
      }
  > = [];
  const groups = new Map<
    string,
    {
      kind: "group";
      label: string;
      requirements: RequirementPresentationItem[];
    }
  >();
  const byId = new Map<string, RequirementPresentationItem>();
  let ungroupedBlock:
    | { kind: "ungrouped"; requirements: RequirementPresentationItem[] }
    | undefined;

  for (const record of records) {
    const item = toPresentationItem(record);
    byId.set(item.id, item);

    if (item.group) {
      let block = groups.get(item.group);
      if (!block) {
        block = { kind: "group", label: item.group, requirements: [] };
        groups.set(item.group, block);
        blocks.push(block);
      }
      block.requirements.push(item);
      continue;
    }

    if (!ungroupedBlock) {
      ungroupedBlock = { kind: "ungrouped", requirements: [] };
      blocks.push(ungroupedBlock);
    }
    ungroupedBlock.requirements.push(item);
  }

  return { blocks, byId };
};

const getComparisonRecord = (
  requirement: FeatureRequirementRecord,
): unknown => withoutEntityTitles(requirement);

export const buildRequirementPresentationChanges = (
  before: readonly FeatureRequirementRecord[],
  after: readonly FeatureRequirementRecord[],
): readonly RequirementPresentationChange[] => {
  const beforeModel = buildRequirementPresentationModel(before);
  const afterModel = buildRequirementPresentationModel(after);
  const orderedIds = [
    ...after.map((requirement) => requirement.id),
    ...before
      .map((requirement) => requirement.id)
      .filter((id) => !afterModel.byId.has(id)),
  ];
  const seenIds = new Set<string>();

  return orderedIds.flatMap((id) => {
    if (seenIds.has(id)) return [];
    seenIds.add(id);

    const beforeItem = beforeModel.byId.get(id);
    const afterItem = afterModel.byId.get(id);
    if (!beforeItem && !afterItem) return [];

    const kind: RequirementChangeKind = !beforeItem
      ? "added"
      : !afterItem
      ? "removed"
      : beforeItem.group !== afterItem.group
      ? "group-changed"
      : !isEqual(
          getComparisonRecord(beforeItem.requirement),
          getComparisonRecord(afterItem.requirement),
        )
      ? "edited"
      : "unchanged";

    return [{ id, kind, before: beforeItem, after: afterItem }];
  });
};
