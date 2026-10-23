import type {
  FeatureRequirementRecord,
  FeatureRequirementStoredContractCitation,
  FeatureRequirementStoredDesignCitation,
  FeatureRequirementStoredFulfillmentCitation,
  FeatureRequirementsSection,
} from "../api";
import type {
  EntitySearchScope,
  SearchEntity,
} from "../components/SmarterTextAreaCard/types";

/**
 * Record-at-a-time edits for the schema-backed FEATURE requirements section.
 * Every edit addresses a record by its durable id; a group move updates the
 * record's group in place so identity survives statement, citation, and group
 * changes. Array order is authoritative and is preserved by every edit.
 */

export type RequirementCitationSlot =
  "designedBy" | "fulfilledBy" | "contracts";

export const REQUIREMENT_CITATION_SLOTS = [
  "designedBy",
  "fulfilledBy",
  "contracts",
] as const satisfies readonly RequirementCitationSlot[];

export type RequirementSlotCitation = {
  designedBy: FeatureRequirementStoredDesignCitation;
  fulfilledBy: FeatureRequirementStoredFulfillmentCitation;
  contracts: FeatureRequirementStoredContractCitation;
};

/** Below this size ungrouped records need no group (server-enforced rule). */
export const REQUIREMENT_GROUPING_THRESHOLD = 3;

const GROUP_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9 -]*[A-Za-z0-9])?$/;

const isValidRequirementGroupLabel = (label: string): boolean =>
  GROUP_PATTERN.test(label);

export const serializeFeatureRequirementsSection = (
  records: readonly FeatureRequirementRecord[],
): string => {
  const section: FeatureRequirementsSection = { records: [...records] };
  return JSON.stringify(section);
};

interface RequirementEditorGroupBlock {
  label: string;
  records: readonly FeatureRequirementRecord[];
}

export interface RequirementEditorLayout {
  groups: readonly RequirementEditorGroupBlock[];
  ungrouped: readonly FeatureRequirementRecord[];
}

/**
 * Editor layout: explicit groups in first-occurrence order, then the records
 * without a group. Source order is kept inside every block.
 */
export const buildRequirementEditorLayout = (
  records: readonly FeatureRequirementRecord[],
): RequirementEditorLayout => {
  const groups = new Map<string, FeatureRequirementRecord[]>();
  const ungrouped: FeatureRequirementRecord[] = [];
  for (const record of records) {
    if (record.group === undefined) {
      ungrouped.push(record);
      continue;
    }
    const block = groups.get(record.group);
    if (block) block.push(record);
    else groups.set(record.group, [record]);
  }
  return {
    groups: [...groups.entries()].map(([label, groupRecords]) => ({
      label,
      records: groupRecords,
    })),
    ungrouped,
  };
};

const flattenLayout = (
  layout: RequirementEditorLayout,
): FeatureRequirementRecord[] => [
  ...layout.groups.flatMap((group) => group.records),
  ...layout.ungrouped,
];

const updateRecord = (
  records: readonly FeatureRequirementRecord[],
  id: string,
  update: (record: FeatureRequirementRecord) => FeatureRequirementRecord,
): FeatureRequirementRecord[] =>
  records.map((record) => (record.id === id ? update(record) : record));

const withGroup = (
  record: FeatureRequirementRecord,
  group: string | undefined,
): FeatureRequirementRecord => {
  const { group: _previous, ...rest } = record;
  return group === undefined ? rest : { ...rest, group };
};

export const addRequirement = (
  records: readonly FeatureRequirementRecord[],
  id: string,
): FeatureRequirementRecord[] => [
  ...records,
  { id, statement: "", designedBy: [], fulfilledBy: [], contracts: [] },
];

export const updateRequirementStatement = (
  records: readonly FeatureRequirementRecord[],
  id: string,
  statement: string,
): FeatureRequirementRecord[] =>
  updateRecord(records, id, (record) => ({ ...record, statement }));

export const deleteRequirement = (
  records: readonly FeatureRequirementRecord[],
  id: string,
): FeatureRequirementRecord[] => records.filter((record) => record.id !== id);

const citationKey = (citation: { entityType: string; entityId: string }) =>
  `${citation.entityType}:${citation.entityId}`;

export const addRequirementCitation = <Slot extends RequirementCitationSlot>(
  records: readonly FeatureRequirementRecord[],
  id: string,
  slot: Slot,
  citation: RequirementSlotCitation[Slot],
): FeatureRequirementRecord[] =>
  updateRecord(records, id, (record) => {
    const existing = record[slot] as RequirementSlotCitation[Slot][];
    if (existing.some((cite) => citationKey(cite) === citationKey(citation))) {
      return record;
    }
    return { ...record, [slot]: [...existing, citation] };
  });

export const removeRequirementCitation = (
  records: readonly FeatureRequirementRecord[],
  id: string,
  slot: RequirementCitationSlot,
  citation: { entityType: string; entityId: string },
): FeatureRequirementRecord[] =>
  updateRecord(records, id, (record) => ({
    ...record,
    [slot]: (
      record[slot] as Array<{ entityType: string; entityId: string }>
    ).filter((cite) => citationKey(cite) !== citationKey(citation)),
  }));

export interface RequirementMoveTarget {
  /** Destination group label, or undefined for "not in a group". */
  group: string | undefined;
  /** Position inside the destination block, after removing the moved record. */
  index: number;
}

/**
 * Moves one record within or between groups. The moved record keeps its id
 * and every other field; only its group and position change.
 */
export const moveRequirement = (
  records: readonly FeatureRequirementRecord[],
  id: string,
  target: RequirementMoveTarget,
): FeatureRequirementRecord[] => {
  const moving = records.find((record) => record.id === id);
  if (!moving) return [...records];

  const remaining = records.filter((record) => record.id !== id);
  const layout = buildRequirementEditorLayout(remaining);
  const moved = withGroup(moving, target.group);
  const insert = (
    block: readonly FeatureRequirementRecord[],
  ): FeatureRequirementRecord[] => {
    const index = Math.max(0, Math.min(target.index, block.length));
    return [...block.slice(0, index), moved, ...block.slice(index)];
  };

  if (target.group === undefined) {
    return flattenLayout({ ...layout, ungrouped: insert(layout.ungrouped) });
  }

  const hasGroup = layout.groups.some((group) => group.label === target.group);
  const groups = hasGroup
    ? layout.groups.map((group) =>
        group.label === target.group
          ? { ...group, records: insert(group.records) }
          : group,
      )
    : [...layout.groups, { label: target.group, records: [moved] }];
  return flattenLayout({ ...layout, groups });
};

/** Moves a record to the end of `group`, creating the group when needed. */
export const setRequirementGroup = (
  records: readonly FeatureRequirementRecord[],
  id: string,
  group: string | undefined,
): FeatureRequirementRecord[] => {
  const layout = buildRequirementEditorLayout(
    records.filter((record) => record.id !== id),
  );
  const destination =
    group === undefined
      ? layout.ungrouped
      : (layout.groups.find((block) => block.label === group)?.records ?? []);
  return moveRequirement(records, id, { group, index: destination.length });
};

/**
 * Renames every record in `from` to `to`. Returns null when `to` is not a
 * valid label or already names a different group, leaving the caller to keep
 * the existing label.
 */
export const renameRequirementGroup = (
  records: readonly FeatureRequirementRecord[],
  from: string,
  to: string,
): FeatureRequirementRecord[] | null => {
  const label = to.trim();
  if (label === from) return [...records];
  if (!isValidRequirementGroupLabel(label)) return null;
  if (records.some((record) => record.group === label)) return null;
  return records.map((record) =>
    record.group === from ? { ...record, group: label } : record,
  );
};

/** First unused "Group N" label; always satisfies the group label pattern. */
export const nextRequirementGroupLabel = (
  records: readonly FeatureRequirementRecord[],
): string => {
  const used = new Set(records.map((record) => record.group));
  let index = 1;
  while (used.has(`Group ${index}`)) index += 1;
  return `Group ${index}`;
};

/** Search scope each citation slot offers in its inline search. */
export const REQUIREMENT_CITATION_SEARCH_SCOPES = {
  designedBy: { kind: "entity-types", entityTypes: ["design_doc"] },
  fulfilledBy: { kind: "entity-types", entityTypes: ["task"] },
  contracts: { kind: "work-item-types", taskTypes: ["CONTRACT"] },
} as const satisfies Record<RequirementCitationSlot, EntitySearchScope>;

const PLAN_TASK_TYPE = "PLAN";
const CONTRACT_TASK_TYPE = "CONTRACT";
const TASK_RESULT_TYPES: ReadonlySet<string> = new Set([
  "task",
  "feature",
  "diagram",
  "diagram_element",
]);

const getResultTaskType = (entity: SearchEntity): string | undefined => {
  const taskType = entity.metadata?.taskType;
  return typeof taskType === "string" ? taskType : undefined;
};

/**
 * Converts a picked search result into the citation its slot stores, or null
 * when the result is not a type the slot accepts. The title comes from the
 * search result; the server re-resolves stored titles at write time.
 */
export const toRequirementSlotCitation = <Slot extends RequirementCitationSlot>(
  slot: Slot,
  entity: SearchEntity,
): RequirementSlotCitation[Slot] | null => {
  const base = { entityId: entity.id, entityTitle: entity.name };
  const taskType = getResultTaskType(entity);
  switch (slot) {
    case "designedBy":
      return entity.type === "design_doc"
        ? ({
            ...base,
            entityType: "DESIGN_DOC",
          } as RequirementSlotCitation[Slot])
        : null;
    case "contracts":
      return TASK_RESULT_TYPES.has(entity.type) &&
        (taskType === undefined || taskType === CONTRACT_TASK_TYPE)
        ? ({ ...base, entityType: "CONTRACT" } as RequirementSlotCitation[Slot])
        : null;
    default:
      return TASK_RESULT_TYPES.has(entity.type)
        ? ({
            ...base,
            entityType: taskType === PLAN_TASK_TYPE ? "PLAN" : "TASK",
          } as RequirementSlotCitation[Slot])
        : null;
  }
};

export interface RequirementCitationExclusions {
  /** The feature that owns the requirements. */
  featureId: string;
  /** The feature's structural parent, when it has one. */
  parentId: string | null;
}

/**
 * Drops results a slot cannot cite: wrong types, the feature itself, its
 * structural parent, and entities already cited in that slot. Search is
 * project-scoped, so out-of-project entities never reach this filter.
 */
export const filterRequirementCitationResults = (
  slot: RequirementCitationSlot,
  results: readonly SearchEntity[],
  exclusions: RequirementCitationExclusions,
  existing: readonly { entityId: string }[],
): SearchEntity[] => {
  const excludedIds = new Set([
    exclusions.featureId,
    ...(exclusions.parentId ? [exclusions.parentId] : []),
    ...existing.map((cite) => cite.entityId),
  ]);
  return results.filter(
    (entity) =>
      !excludedIds.has(entity.id) &&
      toRequirementSlotCitation(slot, entity) !== null,
  );
};
