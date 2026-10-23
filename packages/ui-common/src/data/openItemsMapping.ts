import {
  AgentSessionType,
  EntityType,
  type OpenItem,
  type OpenItemGroup,
  type OpenItemPresentation,
  type OpenItemRef,
  type MigrateOpenItemsRequest,
} from "../api";
import {
  createEntityActivation,
  type EntityActivation,
  type EntityActivationType,
  type EntityPresentationSnapshot,
} from "../contexts/EntityActivationContext";
import {
  createNavigationLineageEntry,
  type NavigationLineage,
  type NavigationLineageEntry,
} from "../types/userTracking";
import type {
  OpenItemsBrowserRecord,
  OpenItemsGroupRow,
  OpenItemsRow,
} from "./openItemsModel";
import {
  validOpenItemsMigrationGroup,
  validOpenItemsMigrationItem,
} from "./openItemsValidation";

export interface OpenItemsIdentity {
  entityType: EntityActivationType;
  entityId: string;
}

const entityTypes = {
  initiative: EntityType.Initiative,
  task: EntityType.Task,
  goal: EntityType.Task,
  plan: EntityType.Task,
  conversation: EntityType.Conversation,
  design_doc: EntityType.DesignDoc,
  agent_session: EntityType.AgentSession,
  proposal: EntityType.Proposal,
} satisfies Record<EntityActivationType, EntityType>;

export const openItemsRef = (identity: OpenItemsIdentity): OpenItemRef => ({
  entityType: entityTypes[identity.entityType],
  entityId: identity.entityId,
});

const lineageKinds = {
  plan: "p",
  plan_stage: "s",
  plan_step: "e",
  task: "t",
} as const;

// The API uses TASK identity for all work items. The bounded route metadata
// retains the route-owned lineage kinds; canonical lineage retains the IDs.
export function openItemsPresentation(
  activation: EntityActivation,
): OpenItemPresentation {
  const snapshot = activation.presentation;
  if (!snapshot)
    throw new Error(
      "Open Items requires stable presentation before activation",
    );
  const routeParams: Record<string, string> = {};
  if (entityTypes[activation.entityType] === EntityType.Task)
    routeParams.workItemRoute = activation.entityType;
  if (activation.lineage?.length)
    routeParams.lineageKinds = activation.lineage
      .map((entry) => lineageKinds[entry.entityType])
      .join("");
  if (snapshot.kind === "agent_session" && snapshot.entityConversationRoute) {
    Object.assign(routeParams, snapshot.entityConversationRoute);
  }
  return {
    label: snapshot.label,
    workItemTypeKey:
      snapshot.kind === "task"
        ? snapshot.taskType
        : activation.entityType === "plan"
          ? "PLAN"
          : activation.entityType === "goal"
            ? "GOAL"
            : null,
    agentSessionType:
      snapshot.kind === "agent_session" ? snapshot.sessionType : null,
    routeParams,
  };
}

export const openItemsLineage = (activation: EntityActivation) =>
  (activation.lineage ?? []).map((entry) => ({
    entityType: EntityType.Task,
    entityId: entry.entityId,
  }));

function uiEntityType(item: OpenItem): EntityActivationType | null {
  switch (item.entityType) {
    case EntityType.Task: {
      const route = item.presentation.routeParams?.workItemRoute;
      if (route === "task" || route === "plan" || route === "goal")
        return route;
      return item.presentation.workItemTypeKey === "PLAN"
        ? "plan"
        : item.presentation.workItemTypeKey === "GOAL"
          ? "goal"
          : "task";
    }
    case EntityType.Initiative:
      return "initiative";
    case EntityType.Conversation:
      return "conversation";
    case EntityType.DesignDoc:
      return "design_doc";
    case EntityType.AgentSession:
      return "agent_session";
    case EntityType.Proposal:
      return "proposal";
    default:
      return null;
  }
}

function uiPresentation(
  kind: EntityActivationType,
  presentation: OpenItemPresentation,
): EntityPresentationSnapshot | null {
  if (!presentation.label.trim()) return null;
  if (kind === "task")
    return presentation.workItemTypeKey
      ? {
          kind,
          label: presentation.label,
          taskType: presentation.workItemTypeKey,
        }
      : null;
  if (kind === "agent_session") {
    const sessionType = Object.values(AgentSessionType).find(
      (type) => type === presentation.agentSessionType,
    );
    if (!sessionType) return null;
    const route = presentation.routeParams;
    return {
      kind,
      label: presentation.label,
      sessionType,
      ...(route?.conversationId && route.entityId && route.entityType
        ? {
            entityConversationRoute: {
              conversationId: route.conversationId,
              entityId: route.entityId,
              entityType: route.entityType,
            },
          }
        : {}),
    };
  }
  return { kind, label: presentation.label };
}

function uiLineage(item: OpenItem): NavigationLineage {
  const kinds = item.presentation.routeParams?.lineageKinds;
  if (kinds?.length === item.lineage.length) {
    return item.lineage.flatMap<NavigationLineageEntry>((entry, index) => {
      switch (kinds[index]) {
        case "p":
          return [createNavigationLineageEntry("plan", entry.entityId)];
        case "s":
          return [createNavigationLineageEntry("plan_stage", entry.entityId)];
        case "e":
          return [createNavigationLineageEntry("plan_step", entry.entityId)];
        case "t":
          return [createNavigationLineageEntry("task", entry.entityId)];
        default:
          return [];
      }
    });
  }
  return item.lineage
    .filter((entry) => entry.entityType === EntityType.Task)
    .map((entry) => createNavigationLineageEntry("task", entry.entityId));
}

const positionOrder = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

export function openItemsRows(items: readonly OpenItem[]): OpenItemsRow[] {
  const activeItems = [...items].filter((item) => item.removedAt === null);
  const memberOrders = new Map<string, number>();
  const buckets = new Map<string, OpenItem[]>();
  for (const item of activeItems)
    if (item.groupId)
      buckets.set(item.groupId, [...(buckets.get(item.groupId) ?? []), item]);
  for (const bucket of buckets.values())
    bucket
      .sort((a, b) =>
        positionOrder(
          a.memberPosition ?? a.position,
          b.memberPosition ?? b.position,
        ),
      )
      .forEach((item, index) => memberOrders.set(item.entityId, index + 1));
  return activeItems
    .sort((a, b) => positionOrder(a.position, b.position))
    .flatMap((item, index) => {
      const kind = uiEntityType(item);
      const presentation = kind
        ? uiPresentation(kind, item.presentation)
        : null;
      if (!kind || !presentation) return [];
      return [
        {
          ...createEntityActivation(
            kind,
            item.entityId,
            uiLineage(item),
            presentation,
          ),
          lineage: uiLineage(item),
          whyOpen: item.note ?? undefined,
          pinned: item.pinned,
          firstAddedOrder: memberOrders.get(item.entityId) ?? index + 1,
          groupId: item.groupId ?? undefined,
          goalTrackedWorkFilter: item.goalTrackedWorkFilter,
          goalCollapsed: item.goalCollapsed,
        },
      ];
    });
}

export const openItemsGroupRows = (
  groups: readonly OpenItemGroup[],
): OpenItemsGroupRow[] =>
  [...groups]
    .sort((a, b) => positionOrder(a.position, b.position))
    .map((group, order) => ({
      id: group.groupId,
      name: group.name,
      collapsed: group.collapsed,
      order,
    }));

export function openItemsMigration(
  record: OpenItemsBrowserRecord,
  idempotencyKey: string,
): MigrateOpenItemsRequest {
  const groups = record.groups
    .map((group) => ({
      localGroupId: group.id,
      name: group.name,
      collapsed: group.collapsed,
    }))
    .filter((group) => validOpenItemsMigrationGroup(group))
    .slice(0, 200);
  const groupIds = new Set(groups.map((group) => group.localGroupId));
  const items = [...record.items]
    .sort((a, b) => (a.firstAddedOrder ?? 0) - (b.firstAddedOrder ?? 0))
    .flatMap((item) =>
      item.presentation
        ? [
            {
              ...openItemsRef(item),
              note: item.whyOpen ?? null,
              pinned: item.pinned ?? false,
              localGroupId:
                item.groupId && groupIds.has(item.groupId)
                  ? item.groupId
                  : null,
              lineage: openItemsLineage({
                ...item,
                lineage: item.lineage ?? null,
              }),
              presentation: openItemsPresentation({
                ...item,
                lineage: item.lineage ?? null,
              }),
            },
          ]
        : [],
    )
    .filter((item) => validOpenItemsMigrationItem(item));
  const uniqueItems = new Map(
    items.map((item) => [`${item.entityType}:${item.entityId}`, item]),
  );
  return {
    idempotencyKey,
    sourceSchemaVersion: record.version,
    groups,
    items: [...uniqueItems.values()].slice(0, 1000),
  };
}
