import type { Node, Edge } from "reactflow";
import type { ReportDto } from "../../api";
import type { ActivityGraphMessageNodeData } from "./ActivityGraphMessageNode";
import type { ActivityGraphEntityNodeData } from "./ActivityGraphEntityNode";
import {
  ActivityGanttRelationshipType,
  type ActivityGanttChartData,
  type ActivityGanttEntityId,
  type ActivityGanttEntityNode,
  type ActivityGanttPlanScope,
  type ActivityGanttRelationshipType as ActivityGanttRelationshipTypeType,
} from "./activityGanttPrimitives";

const DEFAULT_NODE_WIDTH = 280;
const COLUMN_GAP = 120;
const ROW_GAP = 16;
const DEFAULT_NODE_HEIGHT = 100;
const SESSION_INDENT = 30;
const MESSAGE_NODE_HEIGHT = 80;

export interface ConversationMessageOverlay {
  messageNodeId: string;
  parentSessionId: ActivityGanttEntityId;
  agentSessionId: string;
  responseText: string;
  isStreaming: boolean;
  streamingText?: string;
  createdAt?: string;
  isUserMessage?: boolean;
  reports: ReportDto[];
  systemMessageType: string | null;
}

export interface ActivityGraphData {
  nodes: Node<ActivityGraphEntityNodeData | ActivityGraphMessageNodeData>[];
  edges: Edge[];
  totalWidth: number;
  totalHeight: number;
}

interface ColumnDef {
  key: "parentTasks" | "center" | "subtasks";
  entities: ActivityGanttEntityNode[];
  emphasis: boolean;
}

export function buildActivityGraphNodes(
  chartData: ActivityGanttChartData,
  signalLookup: Map<ActivityGanttEntityId, ActivityGanttRelationshipTypeType[]>,
  options?: {
    nodeHeights?: Record<string, number>;
    containerWidth?: number;
    conversationMessages?: ConversationMessageOverlay[];
    darkMode?: boolean;
    projectId?: string;
    planScope?: ActivityGanttPlanScope;
  }
): ActivityGraphData {
  const nodeHeights = options?.nodeHeights ?? {};
  const conversationMessages = options?.conversationMessages ?? [];
  const darkMode = options?.darkMode ?? false;
  const projectId = options?.projectId;
  const planScope = options?.planScope;
  const columns: ColumnDef[] = [];
  if (chartData.parentTasks.length > 0) {
    columns.push({
      key: "parentTasks",
      entities: chartData.parentTasks,
      emphasis: false,
    });
  }

  const centerEntities: ActivityGanttEntityNode[] = [
    ...chartData.currentWork,
    ...chartData.activeSessions,
  ];
  if (centerEntities.length > 0) {
    columns.push({
      key: "center",
      entities: centerEntities,
      emphasis: false,
    });
  }

  if (chartData.subtasks.length > 0) {
    columns.push({
      key: "subtasks",
      entities: chartData.subtasks,
      emphasis: false,
    });
  }

  if (columns.length === 0) {
    return { nodes: [], edges: [], totalWidth: 0, totalHeight: 0 };
  }

  // Pack columns left-to-right so they fill the available width.
  const effectiveSlotIndex = new Map<ColumnDef["key"], number>();
  columns.forEach((col, i) => {
    effectiveSlotIndex.set(col.key, i);
  });

  const columnCount = columns.length;
  const nodeWidth = options?.containerWidth
    ? Math.floor(
        (options.containerWidth - COLUMN_GAP * (columnCount - 1)) / columnCount
      )
    : DEFAULT_NODE_WIDTH;

  const nodes: Node<
    ActivityGraphEntityNodeData | ActivityGraphMessageNodeData
  >[] = [];
  const nodeColumnMap = new Map<string, number>();
  const activeSessionIds = new Set(chartData.activeSessions.map((s) => s.id));
  const hasActiveSessions = chartData.activeSessions.length > 0;
  const focalSessionId =
    chartData.currentWork.length === 0 && chartData.activeSessions.length > 0
      ? chartData.activeSessions[0].id
      : null;
  let maxHeight = 0;
  let maxColumnSlot = 0;

  columns.forEach((column) => {
    const columnSlot = effectiveSlotIndex.get(column.key) ?? 0;
    const x = columnSlot * (nodeWidth + COLUMN_GAP);
    let y = 0;
    const isParentColumn = column.key === "parentTasks";
    const isCenterColumn = column.key === "center";

    maxColumnSlot = Math.max(maxColumnSlot, columnSlot);

    column.entities.forEach((entity) => {
      const isCurrentWork = chartData.currentWork.some(
        (cw) => cw.id === entity.id
      );
      const isActiveSession = activeSessionIds.has(entity.id);

      // Add extra gap before active sessions within center column
      if (isActiveSession && y > 0) {
        y += ROW_GAP;
      }

      const shouldIndent = isActiveSession && entity.id !== focalSessionId;
      const entityX = shouldIndent ? x + SESSION_INDENT : x;
      const h = nodeHeights[entity.id] ?? DEFAULT_NODE_HEIGHT;

      const hasMessageOverlay = conversationMessages.some(
        (m) => m.parentSessionId === entity.id
      );

      nodes.push({
        id: entity.id,
        type: "activityGraphEntityNode",
        position: { x: entityX, y },
        data: {
          entity,
          signals: signalLookup.get(entity.id) ?? [],
          emphasis: isCurrentWork || entity.id === focalSessionId,
          isParent: isParentColumn,
          isCenter: isCenterColumn,
          hasSessionBelow: isCurrentWork && hasActiveSessions,
          hasMessageBelow: hasMessageOverlay,
          nodeWidth: shouldIndent ? nodeWidth - SESSION_INDENT : nodeWidth,
          hasIncoming: false,
          hasOutgoing: false,
          projectId,
          planScope,
        },
      });

      nodeColumnMap.set(entity.id, columnSlot);
      y += h + ROW_GAP;
    });

    maxHeight = Math.max(maxHeight, y - ROW_GAP);
  });

  // Add message overlay nodes below their parent sessions
  conversationMessages.forEach((overlay) => {
    const parentNode = nodes.find((n) => n.id === overlay.parentSessionId);
    if (!parentNode) return;

    const parentHeight = nodeHeights[parentNode.id] ?? DEFAULT_NODE_HEIGHT;
    const messageX = parentNode.position.x + SESSION_INDENT;
    const messageY = parentNode.position.y + parentHeight + ROW_GAP;
    const messageHeight =
      nodeHeights[overlay.messageNodeId] ?? MESSAGE_NODE_HEIGHT;

    nodes.push({
      id: overlay.messageNodeId,
      type: "activityGraphMessageNode",
      position: { x: messageX, y: messageY },
      data: {
        responseText: overlay.responseText,
        streamingText: overlay.streamingText,
        isStreaming: overlay.isStreaming,
        createdAt: overlay.createdAt,
        agentSessionId: overlay.agentSessionId,
        isUserMessage: overlay.isUserMessage,
        reports: overlay.reports,
        systemMessageType: overlay.systemMessageType,
        projectId,
        planScope,
        nodeWidth: nodeWidth - 2 * SESSION_INDENT,
      },
    });

    // Shift any nodes in the same column that are below the parent
    nodes.forEach((node) => {
      if (node.id === overlay.messageNodeId || node.id === parentNode.id) {
        return;
      }
      if (
        node.position.x >= parentNode.position.x &&
        node.position.x <= parentNode.position.x + SESSION_INDENT &&
        node.position.y > parentNode.position.y
      ) {
        node.position = {
          ...node.position,
          y: node.position.y + messageHeight + ROW_GAP,
        };
      }
    });

    maxHeight = Math.max(maxHeight, messageY + messageHeight);
  });

  // Recalculate maxHeight after all shifts — shifted siblings may extend
  // beyond the message overlay that caused the shift.
  nodes.forEach((node) => {
    const h =
      nodeHeights[node.id] ??
      (node.type === "activityGraphMessageNode"
        ? MESSAGE_NODE_HEIGHT
        : DEFAULT_NODE_HEIGHT);
    maxHeight = Math.max(maxHeight, node.position.y + h);
  });

  // Build edges
  const edges: Edge[] = [];
  const edgeKeys = new Set<string>();

  const addEdge = (
    sourceId: string,
    targetId: string,
    style: Edge["style"],
    handleOverrides?: { sourceHandle?: string; targetHandle?: string }
  ) => {
    const key = `${sourceId}-${targetId}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({
      id: key,
      source: sourceId,
      target: targetId,
      type: "smoothstep",
      style,
      ...(handleOverrides?.sourceHandle
        ? { sourceHandle: handleOverrides.sourceHandle }
        : {}),
      ...(handleOverrides?.targetHandle
        ? { targetHandle: handleOverrides.targetHandle }
        : {}),
    });
  };

  // Collect blocking/concurrent edges to detect duplicates with hierarchy
  const blockingEdgeKeys = new Set<string>();
  const concurrentEdgeKeys = new Set<string>();

  chartData.blockingRelationships.forEach((rel) => {
    if (rel.type === ActivityGanttRelationshipType.Report) return;

    const sourceInGraph = nodes.some((n) => n.id === rel.sourceId);
    const targetInGraph = nodes.some((n) => n.id === rel.targetId);
    if (!sourceInGraph || !targetInGraph) return;

    const key = `${rel.sourceId}-${rel.targetId}`;
    if (rel.type === ActivityGanttRelationshipType.Blocking) {
      blockingEdgeKeys.add(key);
    } else if (rel.type === ActivityGanttRelationshipType.Concurrent) {
      concurrentEdgeKeys.add(key);
    }
  });

  // Hierarchy edges: parentTask -> currentWork, currentWork -> subtask,
  // currentWork -> activeSession
  const hierarchyStyle: Edge["style"] = {
    stroke: darkMode ? "rgba(255, 255, 255, 0.4)" : "rgba(0, 0, 0, 0.26)",
    strokeWidth: 1.5,
  };

  chartData.parentTasks.forEach((parent) => {
    chartData.currentWork.forEach((cw) => {
      const key = `${parent.id}-${cw.id}`;
      if (blockingEdgeKeys.has(key)) return; // blocking takes precedence
      addEdge(parent.id, cw.id, hierarchyStyle);
    });
  });

  chartData.currentWork.forEach((cw) => {
    chartData.subtasks.forEach((sub) => {
      const key = `${cw.id}-${sub.id}`;
      if (blockingEdgeKeys.has(key)) return;
      addEdge(cw.id, sub.id, hierarchyStyle);
    });
    chartData.activeSessions.forEach((session) => {
      const key = `${cw.id}-${session.id}`;
      if (blockingEdgeKeys.has(key)) return;
      addEdge(cw.id, session.id, hierarchyStyle, {
        sourceHandle: "bottom",
      });
    });
  });

  // Message overlay edges: session bottom → message left
  conversationMessages.forEach((overlay) => {
    const parentInGraph = nodes.some((n) => n.id === overlay.parentSessionId);
    const messageInGraph = nodes.some((n) => n.id === overlay.messageNodeId);
    if (!parentInGraph || !messageInGraph) return;

    addEdge(
      overlay.parentSessionId,
      overlay.messageNodeId,
      {
        stroke: "rgba(99, 102, 241, 0.4)",
        strokeWidth: 1.5,
        strokeDasharray: "4 2",
      },
      { sourceHandle: "message-bottom" }
    );
  });

  // Blocking edges
  chartData.blockingRelationships.forEach((rel) => {
    if (rel.type === ActivityGanttRelationshipType.Report) return;

    const sourceInGraph = nodes.some((n) => n.id === rel.sourceId);
    const targetInGraph = nodes.some((n) => n.id === rel.targetId);
    if (!sourceInGraph || !targetInGraph) return;

    if (rel.type === ActivityGanttRelationshipType.Blocking) {
      // Remove any existing hierarchy edge for this pair
      const existingIdx = edges.findIndex(
        (e) => e.source === rel.sourceId && e.target === rel.targetId
      );
      if (existingIdx >= 0) {
        edges.splice(existingIdx, 1);
        edgeKeys.delete(`${rel.sourceId}-${rel.targetId}`);
      }

      addEdge(rel.sourceId, rel.targetId, {
        stroke: "#d32f2f",
        strokeWidth: 2,
        strokeDasharray: "6 3",
      });
    } else if (rel.type === ActivityGanttRelationshipType.Concurrent) {
      const key = `${rel.sourceId}-${rel.targetId}`;
      if (!edgeKeys.has(key)) {
        addEdge(rel.sourceId, rel.targetId, {
          stroke: "#0288d1",
          strokeWidth: 1.5,
          strokeDasharray: "3 3",
        });
      }
    }
  });

  // Mark hasIncoming / hasOutgoing on node data
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  edges.forEach((edge) => {
    incoming.add(edge.target);
    outgoing.add(edge.source);
  });

  nodes.forEach((node) => {
    node.data = {
      ...node.data,
      hasIncoming: incoming.has(node.id),
      hasOutgoing: outgoing.has(node.id),
    };
  });

  const totalWidth =
    (maxColumnSlot + 1) * nodeWidth + maxColumnSlot * COLUMN_GAP;
  const totalHeight = Math.max(maxHeight, 0);

  return { nodes, edges, totalWidth, totalHeight };
}
