import type { WorkItemTypeDefinitionDto } from "../api/api";
import { getStatusLabel } from "./statusUtils";

const ARCHIVED_STATUS = "ARCHIVED";
const SUPERSEDED_STATUS = "SUPERSEDED";

/** The slice of an effective type definition that status presentation reads. */
export type WorkItemStatusVocabulary = Pick<
  WorkItemTypeDefinitionDto,
  "statuses" | "capabilities"
>;

/**
 * Statuses the platform owns outside a type's ordinary list. A saved reserved
 * status is never a removed ordinary status.
 */
export const isReservedWorkItemStatus = (status: string): boolean =>
  status === ARCHIVED_STATUS || status === SUPERSEDED_STATUS;

/**
 * Display label for a saved status. A status the type defines shows the
 * type's label (migrated statuses keep the labels they always had) or its
 * exact name; a status the type no longer defines shows exactly as saved.
 */
export const getWorkItemStatusLabel = (
  status: string,
  vocabulary: WorkItemStatusVocabulary | undefined,
): string => {
  const defined = vocabulary?.statuses.find(({ name }) => name === status);
  if (defined) {
    return defined.label ?? defined.name;
  }

  if (isRetainedRemovedStatus(status, vocabulary)) {
    return status;
  }

  return getStatusLabel(status);
};

/**
 * True when the type has been edited so that this saved status is no longer
 * one of its ordinary statuses. Item content is untouched; the item keeps the
 * status until someone saves a replacement.
 */
export const isRetainedRemovedStatus = (
  status: string,
  vocabulary: WorkItemStatusVocabulary | undefined,
): boolean => {
  if (!vocabulary || isReservedWorkItemStatus(status)) {
    return false;
  }

  return !vocabulary.statuses.some(({ name }) => name === status);
};

/**
 * Ordered statuses a person may choose for an item of this type: the type's
 * current ordinary statuses, then the universal Archived. SUPERSEDED is never
 * an ordinary choice; it is reached only by the supersede transition.
 */
export const getWorkItemStatusChoices = (
  vocabulary: WorkItemStatusVocabulary,
): string[] => [
  ...vocabulary.statuses.map(({ name }) => name),
  ARCHIVED_STATUS,
];

/** Position of a status in the type's own order; unknown statuses sort last. */
export const getWorkItemStatusOrder = (
  status: string,
  vocabulary: WorkItemStatusVocabulary | undefined,
): number => {
  const ordered = vocabulary ? getWorkItemStatusChoices(vocabulary) : [];
  const index = ordered.indexOf(status);

  return index === -1 ? ordered.length : index;
};

export interface WorkItemStatusFilterOption {
  value: string;
  label: string;
}

const TYPED_STATUS_SEPARATOR = "\u001f";

/** Filter value that selects one status of one type, for names types present differently. */
const typedStatusValue = (typeKey: string, status: string): string =>
  `${typeKey}${TYPED_STATUS_SEPARATOR}${status}`;

/** Whether an item satisfies a status filter value produced by the options builder. */
export const matchesWorkItemStatusFilter = (
  item: { type?: string | null; status?: string | null },
  filterValue: string,
): boolean =>
  item.status === filterValue ||
  (item.type != null &&
    item.status != null &&
    typedStatusValue(item.type, item.status) === filterValue);

interface StatusFilterSource {
  definitions: readonly WorkItemTypeDefinitionDto[];
  /**
   * Items on the surface: narrows the types considered, and their saved
   * statuses stay filterable even when removed from the type. Omit for
   * surfaces that search every type.
   */
  items?: readonly { type?: string | null; status?: string | null }[];
  /**
   * Split a status name that types present differently into one choice per
   * type, matched with `matchesWorkItemStatusFilter`. Leave off where the
   * filter value is sent to a server that matches saved names.
   */
  scopeByType?: boolean;
}

interface StatusChoiceSource {
  label: string;
  typeKey: string;
  typeName: string;
}

/**
 * Status filter choices for a surface showing items of one or more types.
 * Each type contributes its own statuses in its own order. A name every type
 * presents the same way is one choice; a name presented differently is one
 * choice per type (when `scopeByType`) so no type's wording is taken as the
 * global meaning. Saved statuses a type no longer defines are kept so those
 * items remain reachable.
 */
export const buildWorkItemStatusFilterOptions = ({
  definitions,
  items = [],
  scopeByType = false,
}: StatusFilterSource): WorkItemStatusFilterOption[] => {
  const typeKeys = new Set(items.map(({ type }) => type));
  const relevant = definitions.filter(
    ({ key }) => items.length === 0 || typeKeys.has(key),
  );
  const sourcesByStatus = new Map<string, StatusChoiceSource[]>();

  const addSource = (
    status: string,
    label: string,
    typeKey: string,
    typeName: string,
  ): void => {
    sourcesByStatus.set(status, [
      ...(sourcesByStatus.get(status) ?? []),
      { label, typeKey, typeName },
    ]);
  };

  for (const definition of relevant) {
    for (const status of getWorkItemStatusChoices(definition)) {
      addSource(
        status,
        getWorkItemStatusLabel(status, definition),
        definition.key,
        definition.name,
      );
    }
    if (definition.capabilities?.supportsSupersession) {
      addSource(
        SUPERSEDED_STATUS,
        getStatusLabel(SUPERSEDED_STATUS),
        definition.key,
        definition.name,
      );
    }
  }

  for (const { type, status } of items) {
    if (!status) {
      continue;
    }
    const definition = relevant.find(({ key }) => key === type);
    const known = sourcesByStatus
      .get(status)
      ?.some((source) => source.typeKey === (definition?.key ?? ""));
    if (known) {
      continue;
    }
    addSource(
      status,
      getWorkItemStatusLabel(status, definition),
      definition?.key ?? "",
      definition?.name ?? "",
    );
  }

  return [...sourcesByStatus].flatMap(([value, sources]) => {
    const labels = new Set(sources.map(({ label }) => label));
    if (labels.size === 1) {
      return [{ value, label: sources[0].label }];
    }
    if (scopeByType) {
      return sources.map(({ label, typeKey, typeName }) => ({
        value: typedStatusValue(typeKey, value),
        label: `${label} (${typeName})`,
      }));
    }

    const label = [...labels]
      .map((text) => {
        const typeNames = sources
          .filter((source) => source.label === text)
          .map(({ typeName }) => typeName);

        return `${text} (${typeNames.join(", ")})`;
      })
      .join(" / ");

    return [{ value, label }];
  });
};
