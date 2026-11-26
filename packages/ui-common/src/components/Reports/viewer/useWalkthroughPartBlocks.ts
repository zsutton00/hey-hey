import countBy from "lodash/countBy.js";
import sortBy from "lodash/sortBy.js";
import uniq from "lodash/uniq.js";
import type { ChangeWalkthroughPart } from "../../../api";
import { useDiagramElementReferences } from "../../../data/hooks/useDiagramElementReferences";

/** Parts of a walkthrough shown together, above one set of previews. */
export interface WalkthroughPartBlock {
  /** Where the block's first part is in the report. */
  position: number;
  /** In report order. */
  parts: ChangeWalkthroughPart[];
  /** Every element the parts link, each once, in report order. */
  elementIds: string[];
  /** Whether the part may still join others, so its previews must wait. */
  isGrouping: boolean;
}

/**
 * Positions of the parts grouped by `groupingIds`: parts linking the same one,
 * directly or through other parts, are together. Groups are in the order of
 * their first part, and positions within a group are in report order.
 */
const connectParts = (
  links: readonly string[][],
  groupingIds: ReadonlySet<string>,
): number[][] => {
  let groups: { positions: number[]; ids: string[] }[] = [];

  links.forEach((linked, position) => {
    const ids = linked.filter((id) => groupingIds.has(id));
    const connected = groups.filter((group) =>
      group.ids.some((id) => ids.includes(id)),
    );
    const merged = {
      positions: sortBy([
        ...connected.flatMap((group) => group.positions),
        position,
      ]),
      ids: uniq([...connected.flatMap((group) => group.ids), ...ids]),
    };

    // The merged group takes the place of the earliest one it replaces.
    const [first] = connected;
    const place = first ? groups.indexOf(first) : groups.length;
    groups = groups.filter((group) => !connected.includes(group));
    groups.splice(place, 0, merged);
  });

  return groups.map(({ positions }) => positions);
};

/**
 * The blocks of a walkthrough's parts section. Only an element that two or more
 * parts link, and that still resolves, groups them. Until that is known, each
 * part stands alone.
 */
export function useWalkthroughPartBlocks(
  organizationId: string,
  projectId: string,
  parts: readonly ChangeWalkthroughPart[],
): WalkthroughPartBlock[] {
  const links = parts.map((part) =>
    uniq(
      part.diagramElementRefs?.map(({ diagramElementId }) => diagramElementId),
    ),
  );
  const linkCounts = countBy(links.flat());
  const sharedIds = Object.keys(linkCounts).filter((id) => linkCounts[id]! > 1);
  const { isLoading, references } = useDiagramElementReferences(
    organizationId,
    projectId,
    sharedIds,
  );
  const resolvedIds = new Set(references.map(({ elementId }) => elementId));

  return connectParts(links, resolvedIds).map((positions) => {
    const elementIds = uniq(positions.flatMap((position) => links[position]!));

    return {
      position: positions[0]!,
      parts: positions.map((position) => parts[position]!),
      elementIds,
      isGrouping: isLoading && elementIds.some((id) => sharedIds.includes(id)),
    };
  });
}
