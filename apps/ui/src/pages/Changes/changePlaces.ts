import type {
  ImplementReportEdit,
  ImplementReportEditPlace,
  ProjectChangePlace,
  ProjectChangeRecord,
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

/** A recorded entry of the project's place list, as a place to label. */
export const toChangePlace = (listed: ProjectChangePlace): ChangePlace => ({
  kind: listed.kind!,
  branch: listed.branch ?? null,
  worktreePath: listed.worktreePath,
});

export interface PlaceGroup<T> {
  /** Null for the "not recorded" group. */
  place: ChangePlace | null;
  items: T[];
}

/**
 * Groups already-loaded records by place, newest record first within the
 * order groups first appear (input is newest first). A record with edits in
 * two places appears in both groups; "not recorded" comes last.
 * `matchedPlacesOf` narrows a record to the places a filter matched: empty
 * means "not recorded", undefined means the record is not narrowed.
 */
export const groupByPlace = <T>(
  items: readonly T[],
  editsOf: (item: T) => readonly ImplementReportEdit[],
  matchedPlacesOf?: (item: T) => readonly ChangePlace[] | undefined,
): PlaceGroup<T>[] => {
  const groups = new Map<string, PlaceGroup<T>>();
  const unrecorded: PlaceGroup<T> = { place: null, items: [] };
  for (const item of items) {
    const places = matchedPlacesOf?.(item) ?? distinctPlaces(editsOf(item));
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

/**
 * Groups change records under their places, or under only the matched places
 * when a place filter is active. Null means a matched place is not in the
 * loaded place list yet, so the records stay a flat list rather than being
 * headed by a guess.
 */
export const groupChangeRecords = (
  records: readonly ProjectChangeRecord[],
  listedPlaces: readonly ProjectChangePlace[],
): PlaceGroup<ProjectChangeRecord>[] | null => {
  const listedByKey = new Map(listedPlaces.map((place) => [place.key, place]));
  const hasUnlistedMatch = records.some((record) =>
    record.matchedPlaceKeys?.some((key) => !listedByKey.has(key)),
  );
  if (hasUnlistedMatch) {
    return null;
  }

  return groupByPlace(
    records,
    (record) =>
      record.report.payload.reportType === "IMPLEMENT"
        ? (record.report.payload.edits ?? [])
        : [],
    (record) =>
      record.matchedPlaceKeys?.flatMap((key) => {
        const listed = listedByKey.get(key);
        return listed && !listed.notRecorded ? [toChangePlace(listed)] : [];
      }),
  );
};
