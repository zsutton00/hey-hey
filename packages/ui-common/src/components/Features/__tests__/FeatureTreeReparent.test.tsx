import React from "react";
import {
  render,
  renderHook,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Provider } from "jotai";
import { DndContext } from "@dnd-kit/core";
import { TaskSource, WorkStatus, type TaskResponseDto } from "../../../api";
import { useFeatureTree } from "../../../data/hooks/useFeatureTree";
import { FeatureTreeNode } from "../FeatureTreeNode";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    getTasks: vi.fn(),
    updateTask: vi.fn(),
  },
}));

import { unifiedApiClient } from "../../../clients/serviceClients";

const ORG_ID = "org-1";
const PROJ_ID = "proj-1";

function makeFeature(
  id: string,
  parentTaskId?: string,
  name = `Feature ${id}`
): TaskResponseDto {
  return {
    id,
    name,
    type: "FEATURE",
    organizationId: ORG_ID,
    projectId: PROJ_ID,
    status: WorkStatus.Open,
    source: TaskSource.User,
    parentTaskId,
  };
}

// Tree:
//   A (root)
//     B (child of A)
//       C (child of B)
//   D (root, separate)
const fixtures = {
  A: makeFeature("A"),
  B: makeFeature("B", "A"),
  C: makeFeature("C", "B"),
  D: makeFeature("D"),
};

const mockedClient = vi.mocked(unifiedApiClient);

// updateTask now flows through the shared work-item collection, whose
// updateTask expects the server's UpdateTaskResult envelope ({ status, task }).
function appliedUpdateResponse(
  taskId: string,
  parentTaskId: string | null | undefined
) {
  return {
    data: {
      data: {
        status: "APPLIED",
        task: {
          ...fixtures[taskId as keyof typeof fixtures],
          parentTaskId: parentTaskId ?? undefined,
        },
      },
    },
  };
}

// Applied PATCHes persist, so post-mutation re-reads see the moved feature.
let server: Record<string, TaskResponseDto> = {};

beforeEach(() => {
  vi.clearAllMocks();
  server = { ...fixtures };
  mockedClient.getTasks.mockImplementation(() =>
    Promise.resolve({ data: { data: Object.values(server) } } as never)
  );
  mockedClient.updateTask.mockImplementation((args: unknown) => {
    const { taskId, updateTaskDto } = args as {
      taskId: string;
      updateTaskDto: { parentTaskId?: string | null };
    };
    const response = appliedUpdateResponse(taskId, updateTaskDto.parentTaskId);
    server[taskId] = response.data.data.task;
    return Promise.resolve(response as never);
  });
});

// Each hook instance gets a fresh jotai store so the shared work-item
// collection state never leaks between test cases.
async function setupHook() {
  const hook = renderHook(() => useFeatureTree(ORG_ID, PROJ_ID), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <Provider>{children}</Provider>
    ),
  });
  await waitFor(() => {
    expect(hook.result.current.allFeatures.length).toBe(4);
  });
  return hook;
}

describe("useFeatureTree.reparent — guards and dispatch", () => {
  it("(a) drop on self → no PATCH, no tree change", async () => {
    const { result } = await setupHook();
    const before = result.current.allFeatures;

    await act(async () => {
      await expect(result.current.reparent("B", "B")).rejects.toThrow(
        /onto itself/
      );
    });

    expect(mockedClient.updateTask).not.toHaveBeenCalled();
    expect(result.current.allFeatures).toBe(before);
  });

  it("(b) drop on descendant → no PATCH, no tree change", async () => {
    const { result } = await setupHook();
    const before = result.current.allFeatures;

    await act(async () => {
      await expect(result.current.reparent("A", "C")).rejects.toThrow(
        /descendants/
      );
    });

    expect(mockedClient.updateTask).not.toHaveBeenCalled();
    expect(result.current.allFeatures).toBe(before);
  });

  it("(c) drop on current parent → no PATCH", async () => {
    const { result } = await setupHook();

    await act(async () => {
      await result.current.reparent("B", "A");
    });

    expect(mockedClient.updateTask).not.toHaveBeenCalled();
  });

  it("(d) drop on valid target → PATCH called and tree updates optimistically", async () => {
    let resolveUpdate: (value: unknown) => void = () => {};
    mockedClient.updateTask.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        })
    );

    const { result } = await setupHook();

    let promise: Promise<void> = Promise.resolve();
    act(() => {
      promise = result.current.reparent("B", "D");
    });

    // Optimistic update is visible before the PATCH resolves.
    expect(
      result.current.allFeatures.find((f) => f.id === "B")?.parentTaskId
    ).toBe("D");
    expect(mockedClient.updateTask).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      projectId: PROJ_ID,
      taskId: "B",
      updateTaskDto: { parentTaskId: "D" },
    });

    await act(async () => {
      const response = appliedUpdateResponse("B", "D");
      server.B = response.data.data.task;
      resolveUpdate(response);
      await promise;
    });

    expect(
      result.current.allFeatures.find((f) => f.id === "B")?.parentTaskId
    ).toBe("D");
    expect(result.current.errorMap.size).toBe(0);
  });

  it("(e) drop on root pill → PATCH called with parentTaskId: null", async () => {
    const { result } = await setupHook();

    await act(async () => {
      await result.current.reparent("B", null);
    });

    expect(mockedClient.updateTask).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      projectId: PROJ_ID,
      taskId: "B",
      updateTaskDto: { parentTaskId: null },
    });
    expect(
      result.current.allFeatures.find((f) => f.id === "B")?.parentTaskId
    ).toBeUndefined();
  });

  it("(e2) drop on root when feature is already a root → no PATCH", async () => {
    const { result } = await setupHook();

    await act(async () => {
      await result.current.reparent("D", null);
    });

    expect(mockedClient.updateTask).not.toHaveBeenCalled();
  });

  it("(f) PATCH rejection → tree rolls back and errorMap is set", async () => {
    const failure = new Error("server unavailable");
    mockedClient.updateTask.mockRejectedValueOnce(failure);

    const { result } = await setupHook();
    const before = result.current.allFeatures;

    await act(async () => {
      await expect(result.current.reparent("B", "D")).rejects.toBe(failure);
    });

    expect(mockedClient.updateTask).toHaveBeenCalledTimes(1);
    expect(
      result.current.allFeatures.find((f) => f.id === "B")?.parentTaskId
    ).toBe("A");
    // The optimistic move is rolled back to the pre-attempt snapshot.
    expect(result.current.allFeatures).toEqual(before);
    expect(result.current.errorMap.get("B")).toBe("server unavailable");
  });
});

describe("FeatureTreeNode — error rendering", () => {
  function renderNode(errorMessage?: string) {
    return render(
      <DndContext>
        <FeatureTreeNode
          feature={fixtures.B}
          isHighlighted={false}
          isActive={false}
          hasChildren={false}
          isCollapsed={false}
          taskCount={0}
          onToggleCollapse={() => {}}
          onClick={() => {}}
          href="/x"
          descendantsOfActive={new Set<string>()}
          errorMessage={errorMessage}
          onClearError={() => {}}
          onReparentDrop={() => {}}
        />
      </DndContext>
    );
  }

  it("(f-visual) renders the error tooltip when errorMessage is set", async () => {
    renderNode("server unavailable");

    await waitFor(() => {
      // MUI Tooltip mounts the title text into a tooltip element when open.
      expect(screen.getAllByText("server unavailable").length).toBeGreaterThan(
        0
      );
    });
  });

  it("does not render error tooltip when errorMessage is undefined", () => {
    renderNode(undefined);

    expect(screen.queryByText("server unavailable")).not.toBeInTheDocument();
  });
});
