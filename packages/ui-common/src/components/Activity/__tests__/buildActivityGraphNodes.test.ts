import { describe, expect, it } from "vitest";
import { EntityType } from "../../../api";
import { buildActivityGraphNodes } from "../buildActivityGraphNodes";
import {
  ActivityGanttEntityStatus,
  ActivityGanttLaneRole,
  ActivityGanttOverallStatus,
  ActivityGanttRelationshipType,
  toActivityGanttEntityId,
  type ActivityGanttChartData,
} from "../activityGanttPrimitives";

const emptyChartData: ActivityGanttChartData = {
  parentTasks: [],
  currentWork: [],
  activeSessions: [],
  subtasks: [],
  reports: [],
  verificationRecommendations: [],
  blockingRelationships: [],
  breadcrumbs: [],
  timeContext: "now",
  status: ActivityGanttOverallStatus.Ready,
};

const makeTask = (id: string, laneRole: string, title = id) => ({
  id: toActivityGanttEntityId(id),
  entityType: EntityType.Task as const,
  entityId: id,
  title,
  status: ActivityGanttEntityStatus.InProgress as const,
  timeContext: "now",
  durationLabel: "1h",
  detailText: null,
  laneRole: laneRole as typeof ActivityGanttLaneRole.ParentTasks,
  progress: null as null,
});

describe("buildActivityGraphNodes", () => {
  it("returns empty graph for empty data", () => {
    const result = buildActivityGraphNodes(emptyChartData, new Map());

    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.totalWidth).toBe(0);
    expect(result.totalHeight).toBe(0);
  });

  it("creates nodes for a single column (currentWork only)", () => {
    const chartData: ActivityGanttChartData = {
      ...emptyChartData,
      currentWork: [
        {
          ...makeTask("cw-1", ActivityGanttLaneRole.CurrentWork),
          laneRole: ActivityGanttLaneRole.CurrentWork,
          progress: null,
        },
      ],
    };

    const result = buildActivityGraphNodes(chartData, new Map());

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe("cw-1");
    expect(result.nodes[0].type).toBe("activityGraphEntityNode");
    expect(result.edges).toHaveLength(0);
  });

  it("creates 3-column layout with hierarchy edges", () => {
    const chartData: ActivityGanttChartData = {
      ...emptyChartData,
      parentTasks: [
        {
          ...makeTask("pt-1", ActivityGanttLaneRole.ParentTasks),
          laneRole: ActivityGanttLaneRole.ParentTasks,
        },
      ],
      currentWork: [
        {
          ...makeTask("cw-1", ActivityGanttLaneRole.CurrentWork),
          laneRole: ActivityGanttLaneRole.CurrentWork,
          progress: null,
        },
      ],
      subtasks: [
        {
          ...makeTask("st-1", ActivityGanttLaneRole.Subtasks),
          laneRole: ActivityGanttLaneRole.Subtasks,
          progress: null,
        },
      ],
    };

    const result = buildActivityGraphNodes(chartData, new Map());

    expect(result.nodes).toHaveLength(3);

    // Column positions should increase left to right
    const ptNode = result.nodes.find((n) => n.id === "pt-1")!;
    const cwNode = result.nodes.find((n) => n.id === "cw-1")!;
    const stNode = result.nodes.find((n) => n.id === "st-1")!;
    expect(ptNode.position.x).toBeLessThan(cwNode.position.x);
    expect(cwNode.position.x).toBeLessThan(stNode.position.x);

    // Hierarchy edges: parent->current, current->subtask
    expect(result.edges).toHaveLength(2);
    expect(
      result.edges.find((e) => e.source === "pt-1" && e.target === "cw-1")
    ).toBeDefined();
    expect(
      result.edges.find((e) => e.source === "cw-1" && e.target === "st-1")
    ).toBeDefined();
  });

  it("packs center and subtask columns left-to-right when parent tasks are missing", () => {
    const chartData: ActivityGanttChartData = {
      ...emptyChartData,
      currentWork: [
        {
          ...makeTask("cw-1", ActivityGanttLaneRole.CurrentWork),
          laneRole: ActivityGanttLaneRole.CurrentWork,
          progress: null,
        },
      ],
      subtasks: [
        {
          ...makeTask("st-1", ActivityGanttLaneRole.Subtasks),
          laneRole: ActivityGanttLaneRole.Subtasks,
          progress: null,
        },
      ],
    };

    const result = buildActivityGraphNodes(chartData, new Map());

    expect(result.nodes).toHaveLength(2);
    const cwNode = result.nodes.find((n) => n.id === "cw-1")!;
    const stNode = result.nodes.find((n) => n.id === "st-1")!;

    // Packed: center at slot 0, subtasks at slot 1
    expect(cwNode.position.x).toBe(0);
    expect(stNode.position.x).toBe(400);
  });

  it("starts active-only entities at the left edge when no parent exists", () => {
    const chartData: ActivityGanttChartData = {
      ...emptyChartData,
      activeSessions: [
        {
          ...makeTask("as-1", ActivityGanttLaneRole.ActiveSessions),
          laneRole: ActivityGanttLaneRole.ActiveSessions,
        },
      ],
    };

    const result = buildActivityGraphNodes(chartData, new Map());

    const activeNode = result.nodes.find((n) => n.id === "as-1")!;
    expect(activeNode.position.x).toBe(0);
  });

  it("blocking edges override hierarchy edges", () => {
    const chartData: ActivityGanttChartData = {
      ...emptyChartData,
      currentWork: [
        {
          ...makeTask("cw-1", ActivityGanttLaneRole.CurrentWork),
          laneRole: ActivityGanttLaneRole.CurrentWork,
          progress: null,
        },
      ],
      subtasks: [
        {
          ...makeTask("st-1", ActivityGanttLaneRole.Subtasks),
          laneRole: ActivityGanttLaneRole.Subtasks,
          progress: null,
        },
      ],
      blockingRelationships: [
        {
          sourceId: toActivityGanttEntityId("cw-1"),
          targetId: toActivityGanttEntityId("st-1"),
          type: ActivityGanttRelationshipType.Blocking,
        },
      ],
    };

    const result = buildActivityGraphNodes(chartData, new Map());

    // Should have one edge with blocking style, not hierarchy
    expect(result.edges).toHaveLength(1);
    const edge = result.edges[0];
    expect(edge.style).toHaveProperty("strokeDasharray", "6 3");
  });

  it("applies measured heights to node positions", () => {
    const chartData: ActivityGanttChartData = {
      ...emptyChartData,
      currentWork: [
        {
          ...makeTask("cw-1", ActivityGanttLaneRole.CurrentWork, "First"),
          laneRole: ActivityGanttLaneRole.CurrentWork,
          progress: null,
        },
        {
          ...makeTask("cw-2", ActivityGanttLaneRole.CurrentWork, "Second"),
          laneRole: ActivityGanttLaneRole.CurrentWork,
          progress: null,
        },
      ],
    };

    const withDefault = buildActivityGraphNodes(chartData, new Map());
    const withMeasured = buildActivityGraphNodes(chartData, new Map(), {
      nodeHeights: { "cw-1": 200 },
    });

    const defaultSecondY = withDefault.nodes.find((n) => n.id === "cw-2")!
      .position.y;
    const measuredSecondY = withMeasured.nodes.find((n) => n.id === "cw-2")!
      .position.y;

    // With a taller first node, the second should be pushed further down
    expect(measuredSecondY).toBeGreaterThan(defaultSecondY);
  });

  it("marks hasIncoming and hasOutgoing on nodes", () => {
    const chartData: ActivityGanttChartData = {
      ...emptyChartData,
      parentTasks: [
        {
          ...makeTask("pt-1", ActivityGanttLaneRole.ParentTasks),
          laneRole: ActivityGanttLaneRole.ParentTasks,
        },
      ],
      currentWork: [
        {
          ...makeTask("cw-1", ActivityGanttLaneRole.CurrentWork),
          laneRole: ActivityGanttLaneRole.CurrentWork,
          progress: null,
        },
      ],
    };

    const result = buildActivityGraphNodes(chartData, new Map());

    const ptNode = result.nodes.find((n) => n.id === "pt-1")!;
    const cwNode = result.nodes.find((n) => n.id === "cw-1")!;

    expect(ptNode.data.hasOutgoing).toBe(true);
    expect(ptNode.data.hasIncoming).toBe(false);
    expect(cwNode.data.hasIncoming).toBe(true);
    expect(cwNode.data.hasOutgoing).toBe(false);
  });

  it("excludes report relationships from edges", () => {
    const chartData: ActivityGanttChartData = {
      ...emptyChartData,
      currentWork: [
        {
          ...makeTask("cw-1", ActivityGanttLaneRole.CurrentWork),
          laneRole: ActivityGanttLaneRole.CurrentWork,
          progress: null,
        },
      ],
      blockingRelationships: [
        {
          sourceId: toActivityGanttEntityId("cw-1"),
          targetId: toActivityGanttEntityId("report-1"),
          type: ActivityGanttRelationshipType.Report,
        },
      ],
    };

    const result = buildActivityGraphNodes(chartData, new Map());
    expect(result.edges).toHaveLength(0);
  });

  it("includes active sessions in center column", () => {
    const chartData: ActivityGanttChartData = {
      ...emptyChartData,
      currentWork: [
        {
          ...makeTask("cw-1", ActivityGanttLaneRole.CurrentWork),
          laneRole: ActivityGanttLaneRole.CurrentWork,
          progress: null,
        },
      ],
      activeSessions: [
        {
          ...makeTask("as-1", ActivityGanttLaneRole.ActiveSessions),
          laneRole: ActivityGanttLaneRole.ActiveSessions,
        },
      ],
    };

    const result = buildActivityGraphNodes(chartData, new Map());

    const cwNode = result.nodes.find((n) => n.id === "cw-1")!;
    const asNode = result.nodes.find((n) => n.id === "as-1")!;

    // Active session indented 30px from current work
    expect(asNode.position.x).toBe(cwNode.position.x + 30);
    // Active session below current work
    expect(asNode.position.y).toBeGreaterThan(cwNode.position.y);

    // Hierarchy edge from current work to active session
    expect(
      result.edges.find((e) => e.source === "cw-1" && e.target === "as-1")
    ).toBeDefined();
  });

  it("adds message overlay nodes below active sessions", () => {
    const chartData: ActivityGanttChartData = {
      ...emptyChartData,
      currentWork: [
        {
          ...makeTask("cw-1", ActivityGanttLaneRole.CurrentWork),
          laneRole: ActivityGanttLaneRole.CurrentWork,
          progress: null,
        },
      ],
      activeSessions: [
        {
          ...makeTask("as-1", ActivityGanttLaneRole.ActiveSessions),
          laneRole: ActivityGanttLaneRole.ActiveSessions,
        },
      ],
    };

    const result = buildActivityGraphNodes(chartData, new Map(), {
      conversationMessages: [
        {
          messageNodeId: "msg:conv-1",
          parentSessionId: toActivityGanttEntityId("as-1"),
          agentSessionId: "as-1",
          responseText: "Hello world",
          isStreaming: false,
          reports: [],
          systemMessageType: null,
        },
      ],
      projectId: "project-1",
    });

    const msgNode = result.nodes.find((n) => n.id === "msg:conv-1");
    expect(msgNode).toBeDefined();
    expect(msgNode!.type).toBe("activityGraphMessageNode");
    expect(msgNode!.data).toMatchObject({
      agentSessionId: "as-1",
      projectId: "project-1",
    });

    const asNode = result.nodes.find((n) => n.id === "as-1")!;
    // Message node should be below and further indented
    expect(msgNode!.position.y).toBeGreaterThan(asNode.position.y);
    expect(msgNode!.position.x).toBe(asNode.position.x + 30);
  });

  it("creates edge from session to message overlay", () => {
    const chartData: ActivityGanttChartData = {
      ...emptyChartData,
      activeSessions: [
        {
          ...makeTask("as-1", ActivityGanttLaneRole.ActiveSessions),
          laneRole: ActivityGanttLaneRole.ActiveSessions,
        },
      ],
    };

    const result = buildActivityGraphNodes(chartData, new Map(), {
      conversationMessages: [
        {
          messageNodeId: "msg:conv-1",
          parentSessionId: toActivityGanttEntityId("as-1"),
          agentSessionId: "as-1",
          responseText: "Test response",
          isStreaming: false,
          reports: [],
          systemMessageType: null,
        },
      ],
    });

    const msgEdge = result.edges.find(
      (e) => e.source === "as-1" && e.target === "msg:conv-1"
    );
    expect(msgEdge).toBeDefined();
    expect(msgEdge!.sourceHandle).toBe("message-bottom");
  });

  it("sets hasMessageBelow on session nodes with overlays", () => {
    const chartData: ActivityGanttChartData = {
      ...emptyChartData,
      activeSessions: [
        {
          ...makeTask("as-1", ActivityGanttLaneRole.ActiveSessions),
          laneRole: ActivityGanttLaneRole.ActiveSessions,
        },
        {
          ...makeTask("as-2", ActivityGanttLaneRole.ActiveSessions),
          laneRole: ActivityGanttLaneRole.ActiveSessions,
        },
      ],
    };

    const result = buildActivityGraphNodes(chartData, new Map(), {
      conversationMessages: [
        {
          messageNodeId: "msg:conv-1",
          parentSessionId: toActivityGanttEntityId("as-1"),
          agentSessionId: "as-1",
          responseText: "Has overlay",
          isStreaming: false,
          reports: [],
          systemMessageType: null,
        },
      ],
    });

    const as1 = result.nodes.find((n) => n.id === "as-1")!;
    const as2 = result.nodes.find((n) => n.id === "as-2")!;

    expect((as1.data as { hasMessageBelow: boolean }).hasMessageBelow).toBe(
      true
    );
    expect((as2.data as { hasMessageBelow: boolean }).hasMessageBelow).toBe(
      false
    );
  });

  it("ignores message overlays with no matching parent", () => {
    const chartData: ActivityGanttChartData = {
      ...emptyChartData,
      currentWork: [
        {
          ...makeTask("cw-1", ActivityGanttLaneRole.CurrentWork),
          laneRole: ActivityGanttLaneRole.CurrentWork,
          progress: null,
        },
      ],
    };

    const result = buildActivityGraphNodes(chartData, new Map(), {
      conversationMessages: [
        {
          messageNodeId: "msg:orphan",
          parentSessionId: toActivityGanttEntityId("nonexistent"),
          agentSessionId: "session-missing",
          responseText: "Orphan",
          isStreaming: false,
          reports: [],
          systemMessageType: null,
        },
      ],
    });

    expect(result.nodes.find((n) => n.id === "msg:orphan")).toBeUndefined();
  });
});
