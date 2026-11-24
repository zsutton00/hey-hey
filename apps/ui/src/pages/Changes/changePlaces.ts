import type {
  ImplementReportEdit,
  ImplementReportEditPlace,
} from "@hey-hey/ui-common/api";

export type ChangePlace = ImplementReportEditPlace;

/** Stable identity of a place within one list; edits without a place have none. */
export const placeIdentity = (place: ChangePlace): string =>
  JSON.stringify([place.kind, place.branch, place.worktreePath ?? null]);

const worktreeName = (worktreePath: string): string =>
  worktreePath.split(/[\\/]/).filter(Boolean).pop() ?? worktreePath;

/**
 * The record's distinct places, in the order its edits were recorded.
 * Empty means the place was not recorded; it is never filled in from the session.
 */
export const distinctPlaces = (
  edits: readonly ImplementReportEdit[],
): ChangePlace[] => {
  const byIdentity = new Map<string, ChangePlace>();
  for (const edit of edits) {
    if (edit.place && !byIdentity.has(placeIdentity(edit.place))) {
      byIdentity.set(placeIdentity(edit.place), edit.place);
    }
  }
  return [...byIdentity.values()];
};

export const placeLabel = (
  place: ChangePlace,
  detachedLabel: string,
): string => {
  const branch = place.branch ?? detachedLabel;
  if (place.kind === "WORKTREE" && place.worktreePath) {
    return `▣ ${worktreeName(place.worktreePath)} · ${branch}`;
  }
  return place.kind === "WORKTREE" ? `▣ ${branch}` : `⎇ ${branch}`;
};

export interface PlaceGroup<T> {
  /** Null for the "not recorded" group. */
  place: ChangePlace | null;
  items: T[];
}

/**
 * Groups already-loaded records by place, newest record first within the
 * order groups first appear (input is newest first). A record with edits in
 * two places appears in both groups; "not recorded" comes last.
 */
export const groupByPlace = <T>(
  items: readonly T[],
  editsOf: (item: T) => readonly ImplementReportEdit[],
): PlaceGroup<T>[] => {
  const groups = new Map<string, PlaceGroup<T>>();
  const unrecorded: PlaceGroup<T> = { place: null, items: [] };
  for (const item of items) {
    const places = distinctPlaces(editsOf(item));
    if (places.length === 0) {
      unrecorded.items.push(item);
      continue;
    }
    for (const place of places) {
      const key = placeIdentity(place);
      const group = groups.get(key) ?? { place, items: [] };
      group.items.push(item);
      groups.set(key, group);
    }
  }
  return [...groups.values(), ...(unrecorded.items.length ? [unrecorded] : [])];
};
