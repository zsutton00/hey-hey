/**
 * Entity kinds admitted to the browser-local Open Items working set.
 *
 * This is the shared product contract for canonical activation, Preview, and
 * the consuming application's Open Items renderer. Adding a kind here must be
 * accompanied by an exhaustive interaction-registry and Preview-host update.
 */
export const OPEN_ITEM_ENTITY_TYPES = [
  "initiative",
  "task",
  "goal",
  "conversation",
  "design_doc",
  "agent_session",
  "plan",
  "proposal",
] as const;

export type OpenItemEntityType = (typeof OPEN_ITEM_ENTITY_TYPES)[number];

export type OpenItemEntityId<
  T extends OpenItemEntityType = OpenItemEntityType
> = string & {
  readonly __brand: "OpenItemEntityId";
  readonly __entityType: T;
};

export interface OpenItemEntity<
  T extends OpenItemEntityType = OpenItemEntityType
> {
  entityType: T;
  entityId: OpenItemEntityId<T>;
}

export function isOpenItemEntityType(
  entityType: string
): entityType is OpenItemEntityType {
  return OPEN_ITEM_ENTITY_TYPES.some(
    (supportedType) => supportedType === entityType
  );
}

export function createOpenItemEntity<T extends OpenItemEntityType>(
  entityType: T,
  entityId: string
): OpenItemEntity<T> {
  return {
    entityType,
    entityId: entityId as OpenItemEntityId<T>,
  };
}
