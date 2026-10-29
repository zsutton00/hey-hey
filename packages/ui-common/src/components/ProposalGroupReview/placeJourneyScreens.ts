export interface GridCell {
  column: number;
  row: number;
}

export interface JourneyTransition {
  sourceId: string;
  targetId: string;
}

const cellKey = ({ column, row }: GridCell) => `${column},${row}`;

/**
 * Cells around an origin ordered by distance, then east, south, north, west,
 * so the first free one is the preferred neighbour or the nearest spill cell.
 */
function* cellsAround(origin: GridCell): Generator<GridCell> {
  for (let distance = 1; ; distance += 1) {
    const ring: GridCell[] = [];
    for (let dx = distance; dx >= -distance; dx -= 1) {
      const rest = distance - Math.abs(dx);
      const offsets = rest === 0 ? [0] : [rest, -rest];
      offsets.forEach((dy) => {
        ring.push({ column: origin.column + dx, row: origin.row + dy });
      });
    }
    yield* ring;
  }
}

/** Ranks distinct coordinates so saved positions keep their arrangement as cells. */
function rankCoordinates(values: number[]): Map<number, number> {
  const distinct = [...new Set(values)].sort((left, right) => left - right);
  return new Map(distinct.map((value, index) => [value, index]));
}

/**
 * Places screens on an integer grid. Screens with a saved position keep its
 * relative arrangement; the rest are reached breadth-first from the first
 * screen, and only the first transition reaching a screen decides its cell.
 * The result depends only on the inputs and their order.
 */
export function placeJourneyScreens(
  screenIds: readonly string[],
  transitions: readonly JourneyTransition[],
  savedPositions: ReadonlyMap<string, { x: number; y: number }>,
): Map<string, GridCell> {
  const placed = new Map<string, GridCell>();
  const occupied = new Set<string>();
  const place = (id: string, cell: GridCell) => {
    placed.set(id, cell);
    occupied.add(cellKey(cell));
  };

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

  const placeNear = (id: string, origin: GridCell) => {
    for (const cell of cellsAround(origin)) {
      if (!occupied.has(cellKey(cell))) {
        place(id, cell);
        return;
      }
    }
  };

  const known = new Set(screenIds);
  const onward = new Map<string, string[]>();
  const reached = new Set<string>();
  transitions.forEach(({ sourceId, targetId }) => {
    if (!known.has(sourceId) || !known.has(targetId)) {
      return;
    }
    onward.set(sourceId, [...(onward.get(sourceId) ?? []), targetId]);
    if (sourceId !== targetId) {
      reached.add(targetId);
    }
  });

  const starts = [
    ...screenIds.filter((id) => !reached.has(id)),
    ...screenIds.filter((id) => reached.has(id)),
  ];
  const visited = new Set<string>();
  starts.forEach((start) => {
    if (visited.has(start)) {
      return;
    }
    if (!placed.has(start)) {
      const below = Math.max(-1, ...[...placed.values()].map(({ row }) => row));
      placeNear(start, { column: -1, row: below + 1 });
    }

    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const sourceId = queue.shift()!;
      const source = placed.get(sourceId)!;
      (onward.get(sourceId) ?? []).forEach((targetId) => {
        if (visited.has(targetId)) {
          return;
        }
        visited.add(targetId);
        if (!placed.has(targetId)) {
          placeNear(targetId, source);
        }
        queue.push(targetId);
      });
    }
  });

  const minColumn = Math.min(
    ...[...placed.values()].map(({ column }) => column),
  );
  const minRow = Math.min(...[...placed.values()].map(({ row }) => row));
  return new Map(
    [...placed].map(([id, { column, row }]) => [
      id,
      { column: column - minColumn, row: row - minRow },
    ]),
  );
}
