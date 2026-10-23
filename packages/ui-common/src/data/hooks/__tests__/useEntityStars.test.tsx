import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { EntityType, type EntityStarDto } from "../../../api";
import { entityStarKeys } from "../../collections/entityStars";

const { listStars, starEntity, unstarEntity } = vi.hoisted(() => ({
  listStars: vi.fn(),
  starEntity: vi.fn(),
  unstarEntity: vi.fn(),
}));

vi.mock("../../../clients/serviceClients", () => ({
  starsClient: {
    listStars,
    starEntity,
    unstarEntity,
  },
}));

import { useEntityStar, useEntityStars } from "../useEntityStars";

const starredProject: EntityStarDto = {
  id: "star-1",
  organizationId: "org-1",
  userId: "user-1",
  entityType: EntityType.Project,
  entityId: "project-1",
  entityName: "Project One",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const starredTask: EntityStarDto = {
  ...starredProject,
  id: "star-2",
  entityType: EntityType.Task,
  entityId: "task-1",
  entityName: "Task One",
};

const envelope = <T,>(data: T) => ({
  data: {
    success: true,
    message: "ok",
    timestamp: "now",
    statusCode: 200,
    data,
  },
  status: 200,
  statusText: "OK",
  headers: {},
  config: {},
});

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

describe("useEntityStars", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads organization stars and narrows by entity type client-side", async () => {
    listStars.mockResolvedValue(envelope([starredProject, starredTask]));
    const { wrapper, queryClient } = createHarness();

    const { result } = renderHook(
      () => useEntityStars("org-1", { entityType: EntityType.Project }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(listStars).toHaveBeenCalledWith(
      { organizationId: "org-1" },
      expect.anything(),
    );
    expect(result.current.data).toEqual([starredProject]);
    expect(result.current.isStarred(EntityType.Project, "project-1")).toBe(
      true,
    );
    expect(queryClient.getQueryData(entityStarKeys.list("org-1"))).toEqual([
      starredProject,
      starredTask,
    ]);
  });

  it("serves filtered and unfiltered readers from one request", async () => {
    listStars.mockResolvedValue(envelope([starredProject, starredTask]));
    const { wrapper } = createHarness();

    const { result } = renderHook(
      () => ({
        all: useEntityStars("org-1"),
        projects: useEntityStars("org-1", { entityType: EntityType.Project }),
        tasks: useEntityStars("org-1", { entityType: EntityType.Task }),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.all.isReady).toBe(true));
    expect(result.current.all.stars).toEqual([starredProject, starredTask]);
    expect(result.current.projects.stars).toEqual([starredProject]);
    expect(result.current.tasks.stars).toEqual([starredTask]);
    expect(listStars).toHaveBeenCalledTimes(1);
  });

  it("represents a successful empty list separately from loading", async () => {
    listStars.mockResolvedValue(envelope([]));
    const { wrapper } = createHarness();

    const { result } = renderHook(() => useEntityStars("org-empty"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isFetched).toBe(true));

    expect(result.current.isReady).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual([]);
    expect(result.current.stars).toEqual([]);
  });

  it("stays idle without an organization", () => {
    const { wrapper } = createHarness();

    const { result } = renderHook(() => useEntityStars(undefined), {
      wrapper,
    });

    expect(listStars).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isReady).toBe(false);
  });

  it("surfaces list failures without treating them as an empty state", async () => {
    listStars.mockRejectedValue(new Error("stars unavailable"));
    const { wrapper } = createHarness();

    const { result } = renderHook(() => useEntityStars("org-error"), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current.error?.message).toBe("stars unavailable"),
    );

    expect(result.current.isReady).toBe(false);
    expect(result.current.data).toEqual([]);
  });

  it("stars and unstars, re-reading the shared list exactly once per mutation", async () => {
    listStars
      .mockResolvedValueOnce(envelope([]))
      .mockResolvedValueOnce(envelope([starredProject]))
      .mockResolvedValueOnce(envelope([]));
    starEntity.mockResolvedValue(envelope(starredProject));
    unstarEntity.mockResolvedValue({
      data: undefined,
      status: 204,
      statusText: "No Content",
      headers: {},
      config: {},
    });
    const { wrapper } = createHarness();

    const { result } = renderHook(
      () => ({
        entity: useEntityStar("org-1", EntityType.Project, "project-1"),
        all: useEntityStars("org-1"),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.entity.isReady).toBe(true));
    expect(listStars).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.entity.star();
    });
    expect(starEntity).toHaveBeenCalledWith({
      organizationId: "org-1",
      entityType: EntityType.Project,
      entityId: "project-1",
    });
    expect(result.current.entity.isStarred).toBe(true);
    expect(result.current.all.stars).toEqual([starredProject]);
    expect(listStars).toHaveBeenCalledTimes(2);

    await act(async () => {
      await result.current.entity.unstar();
    });
    expect(unstarEntity).toHaveBeenCalledWith({
      organizationId: "org-1",
      entityType: EntityType.Project,
      entityId: "project-1",
    });
    expect(result.current.entity.isStarred).toBe(false);
    expect(listStars).toHaveBeenCalledTimes(3);
  });

  it("keeps a failed mutation explicit, clears pending state, and does not re-read", async () => {
    listStars.mockResolvedValue(envelope([]));
    starEntity.mockRejectedValue(new Error("star write failed"));
    const { wrapper } = createHarness();

    const { result } = renderHook(
      () => useEntityStar("org-write-error", EntityType.Project, "project-1"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isReady).toBe(true));

    await act(async () => {
      await expect(result.current.star()).rejects.toThrow("star write failed");
    });

    expect(result.current.isMutating).toBe(false);
    expect(result.current.mutationError?.message).toBe("star write failed");
    expect(result.current.error?.message).toBe("star write failed");
    expect(listStars).toHaveBeenCalledTimes(1);

    act(() => result.current.clearError());
    expect(result.current.mutationError).toBeNull();
  });
});
