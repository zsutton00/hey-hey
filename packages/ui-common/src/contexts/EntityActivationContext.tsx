import React, { createContext, useContext, useMemo, useRef } from "react";
import type { AgentSessionType } from "../api/api";
import type { NavigationLineage } from "../types/userTracking";
import {
  OPEN_ITEM_ENTITY_TYPES,
  createOpenItemEntity,
  isOpenItemEntityType,
  type OpenItemEntity,
  type OpenItemEntityId,
  type OpenItemEntityType,
} from "../types/openItems";
import { navigationLineagesEqual } from "../types/userTracking";

export const ENTITY_ACTIVATION_TYPES = OPEN_ITEM_ENTITY_TYPES;

export type EntityActivationType = OpenItemEntityType;

export type EntityActivationId<
  T extends EntityActivationType = EntityActivationType
> = OpenItemEntityId<T>;

export interface EntityPresentationSnapshotByType {
  initiative: { kind: "initiative"; label: string };
  task: { kind: "task"; label: string; taskType: string };
  goal: { kind: "goal"; label: string };
  conversation: { kind: "conversation"; label: string };
  design_doc: { kind: "design_doc"; label: string };
  agent_session: {
    kind: "agent_session";
    label: string;
    sessionType: AgentSessionType;
    entityConversationRoute?: {
      conversationId: string;
      entityId: string;
      entityType: string;
    };
  };
  plan: { kind: "plan"; label: string };
  proposal: { kind: "proposal"; label: string };
}

export type AgentSessionPresentationSnapshot =
  EntityPresentationSnapshotByType["agent_session"];

export type EntityPresentationSnapshot<
  T extends EntityActivationType = EntityActivationType
> = T extends EntityActivationType
  ? EntityPresentationSnapshotByType[T]
  : never;

export interface EntityActivation<
  T extends EntityActivationType = EntityActivationType
> extends OpenItemEntity<T> {
  lineage: NavigationLineage | null;
  presentation?: EntityPresentationSnapshot<T>;
}

export interface EntityActivationSink {
  onEntityActivated: (activation: EntityActivation) => void;
}

export interface EntityActivationProviderProps {
  children: React.ReactNode;
  sink: EntityActivationSink;
}

const EntityActivationContext = createContext<EntityActivationSink | null>(
  null
);

export function isEntityActivationType(
  entityType: string
): entityType is EntityActivationType {
  return isOpenItemEntityType(entityType);
}

export function createEntityActivation<T extends EntityActivationType>(
  entityType: T,
  entityId: string,
  lineage: NavigationLineage | null,
  presentation?: EntityPresentationSnapshot<T>
): EntityActivation<T> {
  return {
    ...createOpenItemEntity(entityType, entityId),
    lineage,
    ...(presentation === undefined ? {} : { presentation }),
  };
}

function presentationSnapshotsEqual(
  left: EntityPresentationSnapshot | undefined,
  right: EntityPresentationSnapshot | undefined
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  if (left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case "task":
      return (
        right.kind === "task" &&
        left.label === right.label &&
        left.taskType === right.taskType
      );
    case "agent_session": {
      if (right.kind !== "agent_session") return false;
      const leftRoute = left.entityConversationRoute;
      const rightRoute = right.entityConversationRoute;
      return (
        left.label === right.label &&
        left.sessionType === right.sessionType &&
        (leftRoute === rightRoute ||
          (leftRoute !== undefined &&
            rightRoute !== undefined &&
            leftRoute.conversationId === rightRoute.conversationId &&
            leftRoute.entityId === rightRoute.entityId &&
            leftRoute.entityType === rightRoute.entityType))
      );
    }
    case "initiative":
    case "goal":
    case "conversation":
    case "design_doc":
    case "plan":
    case "proposal":
      return right.kind === left.kind && left.label === right.label;
  }
}

export function entityActivationsEqual(
  left: EntityActivation | null,
  right: EntityActivation | null
): boolean {
  if (left === right) {
    return true;
  }

  return (
    left !== null &&
    right !== null &&
    left.entityType === right.entityType &&
    left.entityId === right.entityId &&
    navigationLineagesEqual(left.lineage, right.lineage) &&
    presentationSnapshotsEqual(left.presentation, right.presentation)
  );
}

export const EntityActivationProvider: React.FC<
  EntityActivationProviderProps
> = ({ children, sink }) => {
  const sinkRef = useRef(sink);
  sinkRef.current = sink;

  const stableSink = useMemo<EntityActivationSink>(
    () => ({
      onEntityActivated: (activation) => {
        sinkRef.current.onEntityActivated(activation);
      },
    }),
    []
  );

  return (
    <EntityActivationContext.Provider value={stableSink}>
      {children}
    </EntityActivationContext.Provider>
  );
};

export function useEntityActivationSink(): EntityActivationSink | null {
  return useContext(EntityActivationContext);
}
