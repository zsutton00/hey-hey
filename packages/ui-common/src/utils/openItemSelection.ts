import type { EntityDragContent, EntityContent } from "../types/dragAndDrop";

export interface OpenItemSelectionIdentity {
  entityId: string;
  entityType: string;
}

export const openItemSelectionKey = (
  identity: OpenItemSelectionIdentity
): string => JSON.stringify([identity.entityType, identity.entityId]);

/** Visible order is authoritative; hidden and duplicate identities cannot enter a batch. */
export function resolveVisibleOpenItemSelection<
  T extends OpenItemSelectionIdentity
>(visible: readonly T[], selected: readonly OpenItemSelectionIdentity[]): T[] {
  const keys = new Set(selected.map(openItemSelectionKey));
  return visible.filter((item) => keys.delete(openItemSelectionKey(item)));
}

export function resolveOpenItemTargets<T extends OpenItemSelectionIdentity>(
  source: T,
  selected: readonly T[]
): readonly T[] {
  return selected.some(
    (item) => openItemSelectionKey(item) === openItemSelectionKey(source)
  )
    ? selected
    : [source];
}

export function resolveOpenItemDragContent<T extends OpenItemSelectionIdentity>(
  source: T,
  selected: readonly T[],
  toEntity: (item: T) => EntityContent
): EntityDragContent {
  const [first, ...rest] = resolveOpenItemTargets(source, selected).map(
    toEntity
  );
  if (!first) return { type: "entity", data: toEntity(source) };
  return rest.length
    ? { type: "entities", data: [first, ...rest] }
    : { type: "entity", data: first };
}
