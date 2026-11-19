import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkItemWithoutProject } from "../useWorkItemWithoutProject";

const getTask = vi.hoisted(() => vi.fn());
vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { getTask },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </QueryClientProvider>
);

describe("useWorkItemWithoutProject", () => {
  beforeEach(() => {
    getTask.mockReset();
  });

  it("finds a work item from its id alone, so a redirect can learn its project", async () => {
    getTask.mockResolvedValue({
      data: { data: { id: "task-1", projectId: "project-1" } },
    });

    const { result } = renderHook(
      () => useWorkItemWithoutProject("org-1", "task-1"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isFetched).toBe(true));
    expect(result.current.workItem?.projectId).toBe("project-1");
    expect(getTask).toHaveBeenCalledWith(
      { organizationId: "org-1", projectId: "", taskId: "task-1" },
      expect.anything(),
    );
  });

  it("does not read when disabled or without an id", () => {
    renderHook(
      () => ({
        off: useWorkItemWithoutProject("org-1", "task-1", { enabled: false }),
        none: useWorkItemWithoutProject("org-1", ""),
      }),
      { wrapper },
    );

    expect(getTask).not.toHaveBeenCalled();
  });
});
