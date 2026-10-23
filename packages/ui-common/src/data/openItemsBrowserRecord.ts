import { ENTITY_ACTIVATION_TYPES, createEntityActivation, type AgentSessionPresentationSnapshot, type EntityPresentationSnapshot, type EntityActivationType } from "../contexts/EntityActivationContext";
import { AgentSessionType } from "../api";
import { createNavigationLineageEntry, type NavigationLineage, type NavigationLineageEntry } from "../types/userTracking";
import type { OpenItemsRow as OpenItem, OpenItemsGroupRow as OpenItemGroup, OpenItemsBrowserRecord } from "./openItemsModel";
type PersistedOpenItemsDisclosure = NonNullable<OpenItemsBrowserRecord["disclosure"]>;
const lineageEntityTypes = new Set(["plan", "plan_stage", "plan_step", "task"]);

const isOpenItemEntityType = (value: unknown): value is EntityActivationType =>
  typeof value === "string" &&
  ENTITY_ACTIVATION_TYPES.some((entityType) => entityType === value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isStableOpenItemKey = (value: unknown): value is string => {
  if (!isNonEmptyString(value)) return false;
  const separatorIndex = value.indexOf(":");
  return (
    separatorIndex > 0 &&
    separatorIndex < value.length - 1 &&
    isOpenItemEntityType(value.slice(0, separatorIndex)) &&
    isNonEmptyString(value.slice(separatorIndex + 1))
  );
};

const isStableGroupId = (value: unknown): value is string =>
  isNonEmptyString(value) && value === value.trim() && value.length <= 200;

export const normalizeOpenItemsGroupName = (value: string): string =>
  value.trim().replace(/\s+/g, " ").slice(0, 80);

const canonicalOpenItemsGroup = (
  group: OpenItemGroup,
  order = group.order,
): OpenItemGroup => ({
  id: group.id,
  name: normalizeOpenItemsGroupName(group.name),
  order,
  collapsed: group.collapsed === true,
});

const isPersistedOpenItemsGroup = (
  value: unknown,
): value is OpenItemGroup => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const group = value as Record<string, unknown>;
  return (
    isStableGroupId(group.id) &&
    isNonEmptyString(group.name) &&
    typeof group.order === "number" &&
    Number.isFinite(group.order) &&
    (group.collapsed === undefined || typeof group.collapsed === "boolean")
  );
};

const parsePersistedOpenItemsGroups = (value: unknown): OpenItemGroup[] => {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, OpenItemGroup>();
  for (const candidate of value) {
    if (!isPersistedOpenItemsGroup(candidate)) continue;
    const group = canonicalOpenItemsGroup(candidate);
    if (!group.name) continue;
    const existing = byId.get(group.id);
    if (!existing || JSON.stringify(group) > JSON.stringify(existing)) {
      byId.set(group.id, group);
    }
  }
  return Array.from(byId.values())
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    )
    .map((group, order) => canonicalOpenItemsGroup(group, order));
};

const canonicalPersistedOpenItemsDisclosure = (
  disclosure: PersistedOpenItemsDisclosure,
): PersistedOpenItemsDisclosure => ({
  version: 1,
  sectionExpanded: disclosure.sectionExpanded,
  collapsedBranchKeys: Array.from(new Set(disclosure.collapsedBranchKeys)).sort(
    (left, right) => left.localeCompare(right),
  ),
});

const isPersistedOpenItemsDisclosure = (
  value: unknown,
): value is PersistedOpenItemsDisclosure => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const disclosure = value as Record<string, unknown>;
  return (
    disclosure.version === 1 &&
    typeof disclosure.sectionExpanded === "boolean" &&
    Array.isArray(disclosure.collapsedBranchKeys) &&
    disclosure.collapsedBranchKeys.every(isStableOpenItemKey)
  );
};

const parsePersistedOpenItemsDisclosure = (
  value: unknown,
): PersistedOpenItemsDisclosure | undefined =>
  isPersistedOpenItemsDisclosure(value)
    ? canonicalPersistedOpenItemsDisclosure(value)
    : undefined;

const isNavigationLineageEntry = (
  value: unknown,
): value is NavigationLineageEntry => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.entityType === "string" &&
    lineageEntityTypes.has(entry.entityType) &&
    typeof entry.entityId === "string" &&
    entry.entityId.length > 0
  );
};

const isNavigationLineage = (value: unknown): value is NavigationLineage =>
  Array.isArray(value) && value.every(isNavigationLineageEntry);

const agentSessionTypes = new Set<string>(Object.values(AgentSessionType));

const isAgentSessionPresentationSnapshot = (
  value: unknown,
): value is AgentSessionPresentationSnapshot => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const snapshot = value as Record<string, unknown>;
  if (
    snapshot.kind !== "agent_session" ||
    !isNonEmptyString(snapshot.label) ||
    !isNonEmptyString(snapshot.sessionType) ||
    !agentSessionTypes.has(snapshot.sessionType)
  ) {
    return false;
  }
  if (snapshot.entityConversationRoute === undefined) {
    return true;
  }
  if (
    typeof snapshot.entityConversationRoute !== "object" ||
    snapshot.entityConversationRoute === null ||
    Array.isArray(snapshot.entityConversationRoute)
  ) {
    return false;
  }
  const route = snapshot.entityConversationRoute as Record<string, unknown>;
  return (
    isNonEmptyString(route.conversationId) &&
    isNonEmptyString(route.entityId) &&
    isNonEmptyString(route.entityType)
  );
};

const isSimplePresentationSnapshot = (
  kind: Exclude<EntityActivationType, "task" | "agent_session">,
  value: unknown,
): value is EntityPresentationSnapshot => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const snapshot = value as Record<string, unknown>;
  return snapshot.kind === kind && isNonEmptyString(snapshot.label);
};

const isTaskPresentationSnapshot = (
  value: unknown,
): value is EntityPresentationSnapshot<"task"> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const snapshot = value as Record<string, unknown>;
  return (
    snapshot.kind === "task" &&
    isNonEmptyString(snapshot.label) &&
    isNonEmptyString(snapshot.taskType)
  );
};

const presentationForOpenItem = (
  entityType: EntityActivationType,
  value: unknown,
): EntityPresentationSnapshot | undefined => {
  if (
    entityType === "agent_session" &&
    isAgentSessionPresentationSnapshot(value)
  ) {
    return value;
  }
  if (entityType === "task" && isTaskPresentationSnapshot(value)) {
    return value;
  }
  if (
    entityType !== "task" &&
    entityType !== "agent_session" &&
    isSimplePresentationSnapshot(entityType, value)
  ) {
    return value;
  }
  return undefined;
};

const legacyLineageToNavigationLineage = (
  value: unknown,
): NavigationLineage | null | undefined => {
  if (value === undefined || value === null) return null;
  if (isNavigationLineage(value)) return value;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;

  const legacy = value as Record<string, unknown>;
  const knownKeys = ["planId", "stageId", "stepId", "taskId"];
  if (
    Object.keys(legacy).some((key) => !knownKeys.includes(key)) ||
    knownKeys.some(
      (key) =>
        legacy[key] !== undefined &&
        (typeof legacy[key] !== "string" || legacy[key].length === 0),
    )
  ) {
    return undefined;
  }

  const lineage: NavigationLineageEntry[] = [];
  if (typeof legacy.planId === "string") {
    lineage.push(createNavigationLineageEntry("plan", legacy.planId));
  }
  if (typeof legacy.stageId === "string") {
    lineage.push(createNavigationLineageEntry("plan_stage", legacy.stageId));
  }
  if (typeof legacy.stepId === "string") {
    lineage.push(createNavigationLineageEntry("plan_step", legacy.stepId));
  }
  if (typeof legacy.taskId === "string") {
    lineage.push(createNavigationLineageEntry("task", legacy.taskId));
  }
  return lineage.length > 0 ? lineage : null;
};

const isOpenItem = (value: unknown): value is OpenItem => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.entityId === "string" &&
    item.entityId.length > 0 &&
    isOpenItemEntityType(item.entityType) &&
    legacyLineageToNavigationLineage(item.lineage) !== undefined &&
    (item.presentation === undefined ||
      presentationForOpenItem(item.entityType, item.presentation) !==
        undefined) &&
    (item.whyOpen === undefined || typeof item.whyOpen === "string") &&
    (item.pinned === undefined || typeof item.pinned === "boolean") &&
    (item.firstAddedOrder === undefined ||
      (typeof item.firstAddedOrder === "number" &&
        Number.isFinite(item.firstAddedOrder) &&
        item.firstAddedOrder > 0)) &&
    (item.groupId === undefined || isStableGroupId(item.groupId))
  );
};

interface ParsedOpenItemsRecord {
  items: OpenItem[];
  record: Record<string, unknown>;
}

const parseOpenItemsRecord = (
  value: string | null,
): ParsedOpenItemsRecord | null => {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      record.version !== 1 ||
      !Array.isArray(record.items)
    ) {
      return null;
    }
    const validItems = record.items.filter(isOpenItem);
    const groups = parsePersistedOpenItemsGroups(record.groups);
    const groupIds = new Set(groups.map((group) => group.id));
    const items = validItems.map((item) => {
      const lineage = legacyLineageToNavigationLineage(item.lineage);
      const activation = createEntityActivation(
        item.entityType,
        item.entityId,
        lineage ?? null,
        presentationForOpenItem(item.entityType, item.presentation),
      );
      return {
        entityId: activation.entityId,
        entityType: activation.entityType,
        ...(activation.lineage ? { lineage: activation.lineage } : {}),
        ...(activation.presentation
          ? { presentation: activation.presentation }
          : {}),
        ...(item.whyOpen === undefined ? {} : { whyOpen: item.whyOpen }),
        ...(item.pinned === undefined ? {} : { pinned: item.pinned }),
        ...(item.firstAddedOrder === undefined
          ? {}
          : { firstAddedOrder: item.firstAddedOrder }),
        ...(item.groupId !== undefined && groupIds.has(item.groupId)
          ? { groupId: item.groupId }
          : {}),
      };
    });
    return { items, record: { ...record, items: validItems, groups } };
  } catch {
    return null;
  }
};

export const parseOpenItems = (value: string | null): OpenItem[] =>
  parseOpenItemsRecord(value)?.items ?? [];


export function readOpenItemsBrowserRecord(value: string | null): OpenItemsBrowserRecord {
 const parsed = parseOpenItemsRecord(value);
 return { version: 1, items: parsed?.items ?? [], groups: parsePersistedOpenItemsGroups(parsed?.record.groups),
 sortDirection: parsed?.record.sortDirection === "newest" ? "newest" : "oldest",
 disclosure: parsePersistedOpenItemsDisclosure(parsed?.record.disclosure) };
}
