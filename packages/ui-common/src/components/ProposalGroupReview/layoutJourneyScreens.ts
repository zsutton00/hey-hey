import type { WorkflowTransitionRole } from "../../api";
import {
  cellKey,
  cellsAround,
  rankCoordinates,
  type GridCell,
} from "./placeJourneyScreens";

export interface LayoutScreen {
  id: string;
  name: string;
}

export interface LayoutTransition {
  id: string;
  sourceId: string;
  targetId: string;
  /** Recorded role; null for legacy transitions, which are never classified here. */
  role: WorkflowTransitionRole | null;
  actionLabel: string | null;
}

type Position = { x: number; y: number };

const compareText = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

/**
 * Places journey screens on an integer grid from recorded transition roles.
 *
 * Primary progression sets the left-to-right rank (cycles are broken at their
 * back edge) and each alternative gets its own lane. Error targets stack under
 * the screen they belong to, in rows reserved for them. Recovery, return and
 * unclassified transitions never move an established screen; they only place
 * screens that no progression or error path reached. Saved positions are fixed.
 * A marked start screen is the origin of the progression and takes the
 * top-left cell unless a saved position overrides it.
 * Ordering uses screen names and labels, so ids and input order do not matter.
 */
export function layoutJourneyScreens(
  screens: readonly LayoutScreen[],
  transitions: readonly LayoutTransition[],
  savedPositions: ReadonlyMap<string, Position>,
  startId: string | null = null,
): Map<string, GridCell> {
  const names = new Map(screens.map(({ id, name }) => [id, name]));
  const compareScreens = (left: string, right: string) =>
    compareText(names.get(left)!, names.get(right)!) ||
    compareText(left, right);
  const screenIds = screens.map(({ id }) => id).sort(compareScreens);

  const edges = transitions
    .filter(({ sourceId, targetId }) => {
      return names.has(sourceId) && names.has(targetId);
    })
    .sort(
      (left, right) =>
        compareScreens(left.sourceId, right.sourceId) ||
        compareScreens(left.targetId, right.targetId) ||
        compareText(left.actionLabel ?? "", right.actionLabel ?? "") ||
        compareText(left.id, right.id),
    );

  const placed = new Map<string, GridCell>();
  const occupied = new Set<string>();
  const place = (id: string, cell: GridCell) => {
    placed.set(id, cell);
    occupied.add(cellKey(cell));
  };
  const placeInColumn = (id: string, column: number, row: number) => {
    let free = row;
    while (occupied.has(cellKey({ column, row: free }))) {
      free += 1;
    }
    place(id, { column, row: free });
  };

  placeSavedScreens(screenIds, savedPositions, place, occupied);

  const start = startId !== null && names.has(startId) ? startId : null;
  const forward = rankPrimaryProgression(
    screenIds,
    edges,
    compareScreens,
    start,
  );
  const claimed = claimErrorTargets(forward, edges, savedPositions);

  const laneCount = Math.max(-1, ...forward.lane.values()) + 1;
  const extraRows = Array.from({ length: laneCount }, () => 0);
  claimed.forEach((targets, sourceId) => {
    const lane = forward.lane.get(sourceId)!;
    extraRows[lane] = Math.max(extraRows[lane], targets.length);
  });
  const laneRows: number[] = [];
  extraRows.reduce((row, extra, lane) => {
    laneRows[lane] = row;
    return row + 1 + extra;
  }, 0);

  forward.ordered.forEach((id) => {
    if (!placed.has(id)) {
      placeInColumn(id, forward.rank.get(id)!, laneRows[forward.lane.get(id)!]);
    }
  });
  claimed.forEach((targets, sourceId) => {
    const source = placed.get(sourceId)!;
    targets.forEach((targetId, index) => {
      if (!placed.has(targetId)) {
        placeInColumn(targetId, source.column, source.row + 1 + index);
      }
    });
  });

  placeRemainingByAdjacency(screenIds, edges, placed, place, occupied, start);

  const cells = [...placed.values()];
  const minColumn = Math.min(...cells.map(({ column }) => column));
  const minRow = Math.min(...cells.map(({ row }) => row));
  return new Map(
    [...placed].map(([id, { column, row }]) => [
      id,
      { column: column - minColumn, row: row - minRow },
    ]),
  );
}

function placeSavedScreens(
  screenIds: readonly string[],
  savedPositions: ReadonlyMap<string, Position>,
  place: (id: string, cell: GridCell) => void,
  occupied: ReadonlySet<string>,
) {
  const saved = screenIds.flatMap((id) => {
    const position = savedPositions.get(id);
    return position ? [{ id, position }] : [];
  });
  const columns = rankCoordinates(saved.map(({ position }) => position.x));
  const rows = rankCoordinates(saved.map(({ position }) => position.y));
  saved.forEach(({ id, position }) => {
    const cell = {
      column: columns.get(position.x) ?? 0,
      row: rows.get(position.y) ?? 0,
    };
    if (!occupied.has(cellKey(cell))) {
      place(id, cell);
    }
  });
}

interface ForwardLayout {
  /** Screens on a primary path, in rank then lane order. */
  ordered: string[];
  rank: Map<string, number>;
  lane: Map<string, number>;
}

function rankPrimaryProgression(
  screenIds: readonly string[],
  edges: readonly LayoutTransition[],
  compareScreens: (left: string, right: string) => number,
  startId: string | null,
): ForwardLayout {
  const outgoing = new Map<string, string[]>();
  const hasIncoming = new Set<string>();
  const members = new Set<string>();
  edges.forEach(({ role, sourceId, targetId }) => {
    if (
      role !== "PRIMARY_PROGRESSION" ||
      sourceId === targetId ||
      targetId === startId
    ) {
      return;
    }
    outgoing.set(sourceId, [...(outgoing.get(sourceId) ?? []), targetId]);
    hasIncoming.add(targetId);
    members.add(sourceId).add(targetId);
  });

  // A marked start always anchors the progression, even with no primary transitions.
  if (startId !== null) {
    members.add(startId);
  }
  const memberIds = screenIds.filter((id) => members.has(id));
  const starts = [
    ...memberIds.filter((id) => id === startId),
    ...memberIds.filter((id) => id !== startId && !hasIncoming.has(id)),
    ...memberIds.filter((id) => id !== startId && hasIncoming.has(id)),
  ];
  // Depth-first from the starts; an edge into a screen still being visited closes a cycle and is not forward.
  const visiting = new Set<string>();
  const done = new Set<string>();
  const parents = new Map<string, string[]>();
  const finished: string[] = [];
  const visit = (id: string) => {
    visiting.add(id);
    (outgoing.get(id) ?? []).forEach((targetId) => {
      if (visiting.has(targetId)) {
        return;
      }
      parents.set(targetId, [...(parents.get(targetId) ?? []), id]);
      if (!done.has(targetId) && !visiting.has(targetId)) {
        visit(targetId);
      }
    });
    visiting.delete(id);
    done.add(id);
    finished.push(id);
  };
  starts.forEach((id) => {
    if (!done.has(id)) {
      visit(id);
    }
  });

  const rank = new Map<string, number>(memberIds.map((id) => [id, 0]));
  [...finished].reverse().forEach((id) => {
    (outgoing.get(id) ?? []).forEach((targetId) => {
      if ((parents.get(targetId) ?? []).includes(id)) {
        rank.set(targetId, Math.max(rank.get(targetId)!, rank.get(id)! + 1));
      }
    });
  });

  const lane = new Map<string, number>();
  const ordered: string[] = [];
  const maxRank = Math.max(-1, ...rank.values());
  for (let current = 0; current <= maxRank; current += 1) {
    const inRank = memberIds.filter((id) => rank.get(id) === current);
    const parentLane = (id: string) =>
      Math.min(...(parents.get(id) ?? []).map((parent) => lane.get(parent)!));
    inRank.sort(
      (left, right) =>
        parentLane(left) - parentLane(right) ||
        Number(right === startId) - Number(left === startId) ||
        compareScreens(left, right),
    );
    const used = new Set<number>();
    inRank.forEach((id) => {
      let candidate = (parents.get(id) ?? []).length ? parentLane(id) : 0;
      while (used.has(candidate)) {
        candidate += 1;
      }
      used.add(candidate);
      lane.set(id, candidate);
      ordered.push(id);
    });
  }
  return { ordered, rank, lane };
}

/** Each error target belongs to the first progression screen that reaches it. */
function claimErrorTargets(
  forward: ForwardLayout,
  edges: readonly LayoutTransition[],
  savedPositions: ReadonlyMap<string, Position>,
): Map<string, string[]> {
  const onProgression = new Set(forward.ordered);
  const taken = new Set<string>();
  const claimed = new Map<string, string[]>();
  forward.ordered.forEach((sourceId) => {
    edges.forEach((edge) => {
      const { role, targetId } = edge;
      if (
        edge.sourceId !== sourceId ||
        role !== "ERROR_PATH" ||
        onProgression.has(targetId) ||
        taken.has(targetId) ||
        savedPositions.has(targetId)
      ) {
        return;
      }
      taken.add(targetId);
      claimed.set(sourceId, [...(claimed.get(sourceId) ?? []), targetId]);
    });
  });
  return claimed;
}

/** Legacy and leftover screens: nearest free cell to the screen that reaches them. */
function placeRemainingByAdjacency(
  screenIds: readonly string[],
  edges: readonly LayoutTransition[],
  placed: Map<string, GridCell>,
  place: (id: string, cell: GridCell) => void,
  occupied: ReadonlySet<string>,
  startId: string | null,
) {
  const onward = new Map<string, string[]>();
  edges.forEach(({ sourceId, targetId }) => {
    onward.set(sourceId, [...(onward.get(sourceId) ?? []), targetId]);
  });
  const placeNear = (id: string, origin: GridCell) => {
    for (const cell of cellsAround(origin)) {
      // A marked origin must stay at the top-left after normalization.
      if (startId !== null && (cell.column < 0 || cell.row < 0)) {
        continue;
      }
      if (!occupied.has(cellKey(cell))) {
        place(id, cell);
        return;
      }
    }
  };
  const spread = (seeds: string[]) => {
    const queue = [...seeds];
    const queued = new Set(seeds);
    while (queue.length > 0) {
      const sourceId = queue.shift()!;
      (onward.get(sourceId) ?? []).forEach((targetId) => {
        if (queued.has(targetId)) {
          return;
        }
        queued.add(targetId);
        if (!placed.has(targetId)) {
          placeNear(targetId, placed.get(sourceId)!);
        }
        queue.push(targetId);
      });
    }
  };

  const inReadingOrder = [...placed.keys()].sort((left, right) => {
    const a = placed.get(left)!;
    const b = placed.get(right)!;
    return a.column - b.column || a.row - b.row;
  });
  if (startId !== null && placed.has(startId)) {
    inReadingOrder.sort(
      (left, right) => Number(right === startId) - Number(left === startId),
    );
  }
  spread(inReadingOrder);

  const reachedIncoming = new Set(
    edges.flatMap(({ sourceId, targetId }) =>
      sourceId === targetId ? [] : [targetId],
    ),
  );
  const starts = [
    ...screenIds.filter((id) => id === startId),
    ...screenIds.filter((id) => !reachedIncoming.has(id)),
    ...screenIds,
  ];
  starts.forEach((start) => {
    if (placed.has(start)) {
      return;
    }
    const below = Math.max(-1, ...[...placed.values()].map(({ row }) => row));
    placeNear(start, { column: -1, row: below + 1 });
    spread([start]);
  });
}
