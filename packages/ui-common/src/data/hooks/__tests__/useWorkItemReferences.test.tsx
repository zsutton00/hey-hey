import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum,
  OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum,
  WorkStatus,
  type WorkItemReferenceDto,
} from "../../../api";
import { workItemReferenceKeys } from "../../collections/workItemReferences";
import {
  useWorkItemReferencePage,
  useWorkItemReferences,
} from "../useWorkItemReferences";

const listWorkItemReferencesMock = vi.hoisted(() => vi.fn());

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { listWorkItemReferences: listWorkItemReferencesMock },
}));
vi.mock("../useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));

const reference: WorkItemReferenceDto = {
  id: "feature-1",
  name: "Feature Search",
  type: "FEATURE",
  parentTaskId: null,
};

const scope = {
  organizationId: "org-1",
  projectId: "project-1",
  workItemType: "FEATURE",
};

const pageResponse = (
  items: WorkItemReferenceDto[],
  pagination: Partial<{
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  }> = {},
) => ({
  data: {
    data: {
      items,
      pagination: {
        page: 1,
        limit: 500,
        total: items.length,
        totalPages: items.length > 0 ? 1 : 0,
        hasNext: false,
        hasPrevious: false,
        ...pagination,
      },
    },
  },
});

const pending = () => new Promise<never>(() => {});

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  listWorkItemReferencesMock.mockImplementation(pending);
});

describe("useWorkItemReferences", () => {
  it("stays disabled and does not read until the scope is complete", () => {
    const { wrapper } = createHarness();
    const { result } = renderHook(
      () => useWorkItemReferences({ organizationId: "org-1" }),
      { wrapper },
    );

    expect(result.current).toEqual({
      status: "disabled",
      references: [],
      isFetching: false,
    });
    expect(listWorkItemReferencesMock).not.toHaveBeenCalled();
  });

  it("is loading while the first read is in flight", () => {
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useWorkItemReferences(scope), {
      wrapper,
    });

    expect(result.current).toEqual({
      status: "loading",
      references: [],
      isFetching: true,
    });
  });

  it("exposes ready and empty states", async () => {
    listWorkItemReferencesMock.mockResolvedValueOnce(pageResponse([reference]));
    const ready = renderHook(() => useWorkItemReferences(scope), {
      wrapper: createHarness().wrapper,
    });
    await waitFor(() => expect(ready.result.current.status).toBe("ready"));
    expect(ready.result.current.references).toEqual([reference]);

    listWorkItemReferencesMock.mockResolvedValueOnce(pageResponse([]));
    const empty = renderHook(() => useWorkItemReferences(scope), {
      wrapper: createHarness().wrapper,
    });
    await waitFor(() =>
      expect(empty.result.current).toEqual({
        status: "empty",
        references: [],
        isFetching: false,
      }),
    );
  });

  it("does not expose references from a failed request", async () => {
    listWorkItemReferencesMock.mockRejectedValue(
      Object.assign(new Error("failed"), { status: 403 }),
    );
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useWorkItemReferences(scope), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current).toEqual({
        status: "error",
        references: [],
        isFetching: false,
        error: expect.any(Error),
      }),
    );
  });

  it("shares one paged read between two consumers of the same scope", async () => {
    listWorkItemReferencesMock.mockResolvedValue(pageResponse([reference]));
    const { wrapper } = createHarness();
    const { result } = renderHook(
      () => ({
        first: useWorkItemReferences(scope),
        second: useWorkItemReferences(scope),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.first.status).toBe("ready"));
    expect(result.current.second.status).toBe("ready");
    expect(result.current.first.references).toBe(
      result.current.second.references,
    );
    expect(listWorkItemReferencesMock).toHaveBeenCalledTimes(1);
  });

  it("reports updating during a re-read and keeps array identity when data is unchanged", async () => {
    listWorkItemReferencesMock.mockResolvedValueOnce(pageResponse([reference]));
    const { queryClient, wrapper } = createHarness();
    const { result } = renderHook(() => useWorkItemReferences(scope), {
      wrapper,
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const firstReferences = result.current.references;

    let resolveReRead: (value: unknown) => void = () => {};
    listWorkItemReferencesMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReRead = resolve;
        }),
    );
    void queryClient.invalidateQueries({
      queryKey: workItemReferenceKeys.list(scope),
    });
    await waitFor(() => expect(result.current.status).toBe("updating"));
    expect(result.current.references).toBe(firstReferences);

    resolveReRead(pageResponse([{ ...reference }]));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(listWorkItemReferencesMock).toHaveBeenCalledTimes(2);
    expect(result.current.references).toBe(firstReferences);
  });
});

describe("useWorkItemReferencePage", () => {
  it("is disabled for an invalid page and does not read", () => {
    const { wrapper } = createHarness();
    const { result } = renderHook(
      () => useWorkItemReferencePage({ ...scope, page: 0 }),
      { wrapper },
    );

    expect(result.current).toEqual({
      status: "disabled",
      page: null,
      isFetching: false,
    });
    expect(listWorkItemReferencesMock).not.toHaveBeenCalled();
  });

  it("preserves filtered page metadata and sends the filtered request", async () => {
    const response = pageResponse([reference], {
      page: 2,
      limit: 20,
      total: 45,
      totalPages: 3,
      hasNext: true,
      hasPrevious: true,
    });
    listWorkItemReferencesMock.mockResolvedValue(response);
    const { queryClient, wrapper } = createHarness();
    const input = {
      organizationId: "org-1",
      projectId: "project-1",
      workItemType: "CONTRACT",
      page: 2,
      limit: 20,
      filter: "promise",
      statuses: [WorkStatus.Active],
      sortBy:
        OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum.CreatedAt,
      sortOrder:
        OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum.Desc,
    };

    const { result } = renderHook(() => useWorkItemReferencePage(input), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current).toEqual({
        status: "ready",
        page: response.data.data,
        isFetching: false,
      }),
    );
    expect(listWorkItemReferencesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "CONTRACT",
        page: 2,
        limit: 20,
        filter: "promise",
        statuses: [WorkStatus.Active],
        sortBy: "createdAt",
        sortOrder: "desc",
      }),
      expect.anything(),
    );
    expect(
      queryClient.getQueryData(workItemReferenceKeys.page(input)),
    ).toEqual(response.data.data);
  });
});
