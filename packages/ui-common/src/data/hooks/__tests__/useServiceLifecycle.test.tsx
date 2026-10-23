import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useServiceLifecycle } from "../useServiceLifecycle";
import { serviceKeys } from "../../collections/services";

const mocks = vi.hoisted(() => ({
  archiveService: vi.fn(),
  deleteService: vi.fn(),
  members: [] as Array<{ userId: string; role: string }>,
  hasNext: false,
  fetchNextPage: vi.fn(),
}));

vi.mock("../../../clients", () => ({
  getApiRuntime: () => ({
    clients: {
      services: {
        archiveService: mocks.archiveService,
        deleteService: mocks.deleteService,
      },
    },
  }),
}));

vi.mock("../../../hooks/useUserIdentity", () => ({
  useUserIdentity: () => ({ userId: "user-1" }),
}));

vi.mock("../useProjectMembers", () => ({
  useProjectMembers: () => ({
    data: mocks.members,
    hasNext: mocks.hasNext,
    fetchNextPage: mocks.fetchNextPage,
  }),
}));

function renderLifecycle() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const hook = renderHook(() => useServiceLifecycle("org-1", "project-1"), {
    wrapper,
  });
  return { ...hook, invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.members = [];
  mocks.hasNext = false;
});

describe("useServiceLifecycle", () => {
  it.each(["OWNER", "ARCHITECT"])("allows lifecycle actions for %s", (role) => {
    mocks.members = [{ userId: "user-1", role }];
    expect(renderLifecycle().result.current.canManageLifecycle).toBe(true);
  });

  it.each(["MEMBER", "VIEWER"])("hides lifecycle actions for %s", (role) => {
    mocks.members = [{ userId: "user-1", role }];
    expect(renderLifecycle().result.current.canManageLifecycle).toBe(false);
  });

  it("hides actions while the caller's role is unknown and pages through members", () => {
    mocks.members = [{ userId: "someone-else", role: "OWNER" }];
    mocks.hasNext = true;

    expect(renderLifecycle().result.current.canManageLifecycle).toBe(false);
    expect(mocks.fetchNextPage).toHaveBeenCalled();
  });

  it("archives through the generated client and refreshes every Service read", async () => {
    mocks.archiveService.mockResolvedValue({
      data: { data: { id: "service-1", status: "ARCHIVED" } },
    });
    const { result, invalidate } = renderLifecycle();

    await act(() => result.current.archive.mutate("service-1"));

    expect(mocks.archiveService).toHaveBeenCalledWith({
      organizationId: "org-1",
      serviceId: "service-1",
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: serviceKeys.all("org-1"),
    });
  });

  it("surfaces a failed delete without refreshing as if it succeeded", async () => {
    const failure = new Error("Request failed with status code 409");
    mocks.deleteService.mockRejectedValue(failure);
    const { result, invalidate } = renderLifecycle();

    await act(async () => {
      await expect(result.current.remove.mutate("service-1")).rejects.toBe(
        failure,
      );
    });

    expect(result.current.remove.isError).toBe(true);
    expect(result.current.remove.error).toBe(failure);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
