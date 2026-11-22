import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeWorkItemServer } from "../../../test/workItemGraphQL";
import { useWorkItem } from "../useWorkItem";
import { useWorkItemWithoutProject } from "../useWorkItemWithoutProject";

vi.mock("../../../utils/logger", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const findAllProjects = vi.hoisted(() => vi.fn());
vi.mock("../../../clients/serviceClients", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  platformClient: { findAllProjects },
}));

const task = {
  id: "task-1",
  name: "A task",
  type: "STANDARD",
  status: "BACKLOG",
};

describe("useWorkItemWithoutProject", () => {
  let server: FakeWorkItemServer;

  beforeEach(() => {
    server = new FakeWorkItemServer([task]);
    server.onlyProject = "project-1";
    findAllProjects.mockResolvedValue({
      data: { data: [{ id: "other-project" }, { id: "project-1" }] },
    });
  });

  it("finds the project holding a work item from its id alone", async () => {
    const { result } = renderHook(
      () => useWorkItemWithoutProject("org-1", "task-1"),
      { wrapper: server.wrapper },
    );

    await waitFor(() => expect(result.current.isFetched).toBe(true));

    expect(result.current.workItem?.projectId).toBe("project-1");
  });

  it("shares the found record with views of the work item", async () => {
    const { result } = renderHook(
      () => ({
        found: useWorkItemWithoutProject("org-1", "task-1"),
        detail: useWorkItem("org-1", "task", "task-1", {
          projectId: "project-1",
        }),
      }),
      { wrapper: server.wrapper },
    );

    await waitFor(() => expect(result.current.detail.isReady).toBe(true));

    expect(result.current.found.workItem?.id).toBe("task-1");
    expect(server.received("GetWorkItem").length).toBeGreaterThanOrEqual(2);
  });

  it("reports no work item when no project holds it", async () => {
    const { result } = renderHook(
      () => useWorkItemWithoutProject("org-1", "missing"),
      { wrapper: server.wrapper },
    );

    await waitFor(() => expect(result.current.isFetched).toBe(true));

    expect(result.current.workItem).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("does not read when disabled or without an id", () => {
    renderHook(
      () => ({
        off: useWorkItemWithoutProject("org-1", "task-1", { enabled: false }),
        none: useWorkItemWithoutProject("org-1", ""),
      }),
      { wrapper: server.wrapper },
    );

    expect(server.received("GetWorkItem")).toEqual([]);
  });
});
