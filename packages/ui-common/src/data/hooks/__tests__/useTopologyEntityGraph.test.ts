import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useTopologyEntityGraph } from "../useTopologyEntityGraph";
import { platformClient } from "../../../clients/serviceClients";

vi.mock("../../../clients/serviceClients", () => ({
  platformClient: {
    getTopologyEntityGraph: vi.fn(),
  },
}));

describe("useTopologyEntityGraph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps graph results into strongly typed nodes and edges", async () => {
    vi.mocked(platformClient.getTopologyEntityGraph).mockResolvedValue({
      data: {
        data: {
          results: [
            {
              entityId: "task-1",
              entityType: "TASK",
              score: 0.91,
              path: { depth: 0 },
              pathCount: 2,
              node: { title: "Task One", summary: "Seed task" },
            },
            {
              entityId: "service-1",
              entityType: "SERVICE",
              score: 0.78,
              path: { depth: 1 },
              pathCount: 1,
              node: {
                name: "Backend Service",
                description: "Connected service",
              },
            },
          ],
          relationships: [
            {
              sourceEntityId: "task-1",
              sourceEntityType: "TASK",
              targetEntityId: "service-1",
              targetEntityType: "SERVICE",
              type: "IMPLEMENTS",
              direction: "OUTGOING",
            },
          ],
          totalElements: 2,
          totalPages: 1,
          page: 0,
          size: 10,
        },
      },
    } as never);

    const { result } = renderHook(() =>
      useTopologyEntityGraph("org-1", "project-1", "task-1", { depth: 2 })
    );

    await waitFor(() => {
      expect(result.current.isFetched).toBe(true);
    });

    expect(platformClient.getTopologyEntityGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        entityId: "task-1",
        depth: 2,
      })
    );

    expect(result.current.nodes).toEqual([
      {
        id: "entity:TASK:task-1",
        entityId: "task-1",
        entityType: "TASK",
        label: "Task One",
        title: "Task One",
        summary: "Seed task",
        score: 0.91,
        pathDepth: 0,
        pathCount: 2,
        isSeed: true,
      },
      {
        id: "entity:SERVICE:service-1",
        entityId: "service-1",
        entityType: "SERVICE",
        label: "Backend Service",
        title: "Backend Service",
        summary: "Connected service",
        score: 0.78,
        pathDepth: 1,
        pathCount: 1,
        isSeed: false,
      },
    ]);

    expect(result.current.edges).toEqual([
      {
        id: "edge:entity:TASK:task-1:entity:SERVICE:service-1:IMPLEMENTS",
        source: "entity:TASK:task-1",
        target: "entity:SERVICE:service-1",
        relationshipType: "IMPLEMENTS",
        direction: "OUTGOING",
        weight: undefined,
      },
    ]);
  });

  it("does not request when required ids are missing", async () => {
    const { result } = renderHook(() =>
      useTopologyEntityGraph(undefined, "project-1", "task-1")
    );

    await waitFor(() => {
      expect(result.current.isFetched).toBe(false);
    });

    expect(platformClient.getTopologyEntityGraph).not.toHaveBeenCalled();
    expect(result.current.nodes).toEqual([]);
    expect(result.current.edges).toEqual([]);
  });

  it("infers edge node ids when relationship payload omits source/target entity types", async () => {
    vi.mocked(platformClient.getTopologyEntityGraph).mockResolvedValue({
      data: {
        data: {
          results: [
            {
              entityId: "task-1",
              entityType: "TASK",
              path: { depth: 0 },
              node: { title: "Task One" },
            },
            {
              entityId: "service-1",
              entityType: "SERVICE",
              path: { depth: 1 },
              node: { title: "Service One" },
            },
          ],
          relationships: [
            {
              sourceEntityId: "task-1",
              targetEntityId: "service-1",
              relationshipType: "DEPENDS_ON",
            },
          ],
        },
      },
    } as never);

    const { result } = renderHook(() =>
      useTopologyEntityGraph("org-1", "project-1", "task-1")
    );

    await waitFor(() => {
      expect(result.current.isFetched).toBe(true);
    });

    expect(result.current.edges).toEqual([
      {
        id: "edge:entity:TASK:task-1:entity:SERVICE:service-1:DEPENDS_ON",
        source: "entity:TASK:task-1",
        target: "entity:SERVICE:service-1",
        relationshipType: "DEPENDS_ON",
        direction: "UNDIRECTED",
        weight: undefined,
      },
    ]);
  });

  it("extracts title from node.properties.title when top-level title is absent", async () => {
    vi.mocked(platformClient.getTopologyEntityGraph).mockResolvedValue({
      data: {
        data: {
          results: [
            {
              entityId: "plan-step-1",
              entityType: "PLAN_STEP",
              path: { depth: 1 },
              node: {
                properties: {
                  title:
                    "Design: CLI Session Workflow and State Management Design",
                },
              },
            },
          ],
          relationships: [],
        },
      },
    } as never);

    const { result } = renderHook(() =>
      useTopologyEntityGraph("org-1", "project-1", "seed-entity")
    );

    await waitFor(() => {
      expect(result.current.isFetched).toBe(true);
    });

    expect(result.current.nodes).toEqual([
      {
        id: "entity:PLAN_STEP:plan-step-1",
        entityId: "plan-step-1",
        entityType: "PLAN_STEP",
        label: "Design: CLI Session Workflow and State Management Design",
        title: "Design: CLI Session Workflow and State Management Design",
        summary: undefined,
        score: undefined,
        pathDepth: 1,
        pathCount: undefined,
        isSeed: false,
      },
    ]);
  });
});
