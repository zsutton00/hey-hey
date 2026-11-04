import type { GridCell } from "./placeJourneyScreens";

export interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ConnectorEdge {
  id: string;
  sourceId: string;
  targetId: string;
}

export interface ConnectorGeometry {
  columnGap: number;
  /** Space kept free of screens beside every channel segment. */
  inset: number;
  maxAnchorOffset: number;
}

export const CHANNEL_LANE_SPACING = 16;
const GUTTER_MARGIN = 20;

type Kind =
  | "self"
  | "direct-horizontal"
  | "direct-back"
  | "direct-vertical"
  | "side"
  | "gutter";

interface ConnectorPlan {
  edge: ConnectorEdge;
  kind: Kind;
  /** Position among connectors that share the same screens or gutter. */
  lane: number;
  siblings: number;
}

export interface RoutedConnector {
  edgeId: string;
  path: string;
  label: { x: number; y: number; anchor: "start" | "middle" };
}

function classify(source: GridCell, target: GridCell, occupied: Set<string>) {
  if (source.column === target.column && source.row === target.row) {
    return "self";
  }
  if (source.column === target.column) {
    const [from, to] = [source.row, target.row].sort((a, b) => a - b);
    const blocked = Array.from(
      { length: to - from - 1 },
      (_, index) => from + 1 + index,
    ).some((row) => occupied.has(`${source.column},${row}`));
    return blocked ? "side" : "direct-vertical";
  }
  if (target.column === source.column + 1) {
    return "direct-horizontal";
  }
  return target.column === source.column - 1 ? "direct-back" : "gutter";
}

/** Connectors sharing a pair of screens or a gutter get separate lanes. */
function planConnectors(
  cells: ReadonlyMap<string, GridCell>,
  edges: readonly ConnectorEdge[],
): ConnectorPlan[] {
  const occupied = new Set(
    [...cells.values()].map(({ column, row }) => `${column},${row}`),
  );
  const plans = edges.flatMap((edge): ConnectorPlan[] => {
    const source = cells.get(edge.sourceId);
    const target = cells.get(edge.targetId);
    if (!source || !target) {
      return [];
    }
    return [
      {
        edge,
        kind: classify(source, target, occupied),
        lane: 0,
        siblings: 1,
      },
    ];
  });
  const groupKey = (plan: ConnectorPlan) => {
    const source = cells.get(plan.edge.sourceId)!;
    const target = cells.get(plan.edge.targetId)!;
    if (plan.kind === "gutter") {
      return `gutter:${Math.max(source.row, target.row)}`;
    }
    if (plan.kind === "side") {
      return `side:${source.column}`;
    }
    return [plan.edge.sourceId, plan.edge.targetId].sort().join("|");
  };
  const groups = new Map<string, ConnectorPlan[]>();
  plans.forEach((plan) => {
    groups.set(groupKey(plan), [...(groups.get(groupKey(plan)) ?? []), plan]);
  });
  groups.forEach((members) => {
    members.forEach((plan, lane) => {
      plan.lane = lane;
      plan.siblings = members.length;
    });
  });
  return plans;
}

/** Extra vertical room each gutter below a row needs for its connector lanes. */
export function gutterHeights(
  cells: ReadonlyMap<string, GridCell>,
  edges: readonly ConnectorEdge[],
  baseGap: number,
): Map<number, number> {
  const heights = new Map<number, number>();
  planConnectors(cells, edges)
    .filter(({ kind }) => kind === "gutter")
    .forEach(({ edge, siblings }) => {
      const row = Math.max(
        cells.get(edge.sourceId)!.row,
        cells.get(edge.targetId)!.row,
      );
      heights.set(
        row,
        Math.max(
          heights.get(row) ?? baseGap,
          baseGap + siblings * CHANNEL_LANE_SPACING,
        ),
      );
    });
  return heights;
}

/**
 * Routes every connector between measured screen boxes. Neighbouring screens
 * join on their facing sides; anything that would cross another screen runs
 * through the gaps between columns and the gutter beneath the row instead.
 */
export function routeJourneyConnectors(
  cells: ReadonlyMap<string, GridCell>,
  boxes: ReadonlyMap<string, ScreenBox>,
  edges: readonly ConnectorEdge[],
  geometry: ConnectorGeometry,
): RoutedConnector[] {
  const { columnGap, inset, maxAnchorOffset } = geometry;
  const anchorY = (box: ScreenBox, lane = 0) =>
    box.y + Math.min(box.height / 2, maxAnchorOffset) + lane * 14;
  const rowBottom = (row: number) =>
    Math.max(
      ...[...cells]
        .filter(([, cell]) => cell.row === row)
        .map(([id]) => boxes.get(id)!.y + boxes.get(id)!.height),
    );

  return planConnectors(cells, edges).map(({ edge, kind, lane, siblings }) => {
    const source = boxes.get(edge.sourceId)!;
    const target = boxes.get(edge.targetId)!;
    const sourceCell = cells.get(edge.sourceId)!;
    const targetCell = cells.get(edge.targetId)!;
    const shift = (lane - (siblings - 1) / 2) * 14;

    if (kind === "direct-horizontal") {
      const startX = source.x + source.width + inset;
      const endX = target.x - inset;
      const startY = anchorY(source) + shift;
      const endY = anchorY(target) + shift;
      const midX = (startX + endX) / 2;
      return {
        edgeId: edge.id,
        path: `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`,
        label: { x: midX, y: (startY + endY) / 2 - 12, anchor: "middle" },
      };
    }

    if (kind === "direct-back") {
      // Offset from the forward arrows that meet the same screen sides.
      const startX = source.x - inset;
      const endX = target.x + target.width + inset;
      const startY = anchorY(source) + 14 + shift;
      const endY = anchorY(target) + 14 + shift;
      const midX = (startX + endX) / 2;
      return {
        edgeId: edge.id,
        path: `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`,
        label: { x: midX, y: (startY + endY) / 2 - 12, anchor: "middle" },
      };
    }

    if (kind === "direct-vertical") {
      const southward = target.y > source.y;
      const x = source.x + source.width / 2 + shift;
      const startY = southward
        ? source.y + source.height + inset
        : source.y - inset;
      const endY = southward
        ? target.y - inset
        : target.y + target.height + inset;
      return {
        edgeId: edge.id,
        path: `M ${x} ${startY} L ${x} ${endY}`,
        label: { x: x + 8, y: (startY + endY) / 2, anchor: "start" },
      };
    }

    if (kind === "self") {
      const x = source.x + source.width + inset;
      const top = source.y + 24 + lane * 28;
      return {
        edgeId: edge.id,
        path: `M ${x} ${top} C ${x + 60} ${top - 8}, ${x + 60} ${top + 20}, ${x} ${top + 20}`,
        label: { x: x + 40, y: top + 6, anchor: "start" },
      };
    }

    if (kind === "side") {
      const gapX = source.x + source.width + columnGap / 2 + shift;
      const startX = source.x + source.width + inset;
      const endX = target.x + target.width + inset;
      const startY = anchorY(source);
      const endY = anchorY(target);
      return {
        edgeId: edge.id,
        path: `M ${startX} ${startY} L ${gapX} ${startY} L ${gapX} ${endY} L ${endX} ${endY}`,
        label: { x: gapX + 6, y: (startY + endY) / 2, anchor: "start" },
      };
    }

    const eastward = targetCell.column > sourceCell.column;
    const laneOffset = lane * CHANNEL_LANE_SPACING;
    const gutterY =
      rowBottom(Math.max(sourceCell.row, targetCell.row)) +
      GUTTER_MARGIN +
      laneOffset;
    const sourceGapX = eastward
      ? source.x + source.width + columnGap / 2 + lane * 6
      : source.x - columnGap / 2 - lane * 6;
    const targetGapX = eastward
      ? target.x - columnGap / 2 + lane * 6
      : target.x + target.width + columnGap / 2 + lane * 6;
    const startX = eastward
      ? source.x + source.width + inset
      : source.x - inset;
    const endX = eastward ? target.x - inset : target.x + target.width + inset;
    const startY = anchorY(source, lane);
    const endY = anchorY(target, lane);
    return {
      edgeId: edge.id,
      path: `M ${startX} ${startY} L ${sourceGapX} ${startY} L ${sourceGapX} ${gutterY} L ${targetGapX} ${gutterY} L ${targetGapX} ${endY} L ${endX} ${endY}`,
      label: {
        x: (sourceGapX + targetGapX) / 2,
        y: gutterY - 5,
        anchor: "middle",
      },
    };
  });
}
