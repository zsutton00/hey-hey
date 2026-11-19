import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum,
  OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum,
  WorkStatus,
} from "../../../api";
import {
  FakeWorkItemServer,
  type FakeWorkItem,
} from "../../../test/workItemGraphQL";
import { refreshWorkItemLists } from "../../graphql/workItemCache";
import {
  useWorkItemReferencePage,
  useWorkItemReferences,
} from "../useWorkItemReferences";

vi.mock("../useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));

const scope = {
  organizationId: "org-1",
  projectId: "project-1",
  workItemType: "FEATURE",
};

const feature: FakeWorkItem = {
  id: "feature-1",
  name: "Feature Search",
  type: "FEATURE",
  status: "ACTIVE",
};

describe("useWorkItemReferences", () => {
  let server: FakeWorkItemServer;

  beforeEach(() => {
    server = new FakeWorkItemServer([feature]);
  });

  it("stays disabled and does not read until the scope is complete", () => {
    const { result } = renderHook(
      () => useWorkItemReferences({ organizationId: "org-1" }),
      { wrapper: server.wrapper },
    );

    expect(result.current).toEqual({
      status: "disabled",
      references: [],
      isFetching: false,
    });
    expect(server.requests).toEqual([]);
  });

  it("is loading while the first read is in flight", () => {
    const { result } = renderHook(() => useWorkItemReferences(scope), {
      wrapper: server.wrapper,
    });

    expect(result.current).toEqual({
      status: "loading",
      references: [],
      isFetching: true,
    });
  });

  it("exposes ready and empty states", async () => {
    const ready = renderHook(() => useWorkItemReferences(scope), {
      wrapper: server.wrapper,
    });
    await waitFor(() => expect(ready.result.current.status).toBe("ready"));
    expect(ready.result.current.references).toEqual([
      {
        id: "feature-1",
        name: "Feature Search",
        type: "FEATURE",
        parentTaskId: null,
      },
    ]);

    const empty = renderHook(
      () => useWorkItemReferences({ ...scope, workItemType: "GOAL" }),
      { wrapper: server.wrapper },
    );
    await waitFor(() =>
      expect(empty.result.current).toEqual({
        status: "empty",
        references: [],
        isFetching: false,
      }),
    );
  });

  it("does not expose references from a failed request", async () => {
    server.refused.add("GetAllWorkItemReferences");
    const { result } = renderHook(() => useWorkItemReferences(scope), {
      wrapper: server.wrapper,
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

  it("shares one read between two consumers of the same scope", async () => {
    const { result } = renderHook(
      () => ({
        first: useWorkItemReferences(scope),
        second: useWorkItemReferences(scope),
      }),
      { wrapper: server.wrapper },
    );

    await waitFor(() => expect(result.current.first.status).toBe("ready"));
    expect(result.current.second.status).toBe("ready");
    expect(result.current.first.references).toEqual(
      result.current.second.references,
    );
    expect(server.received("GetAllWorkItemReferences")).toHaveLength(1);
  });

  it("reports updating during a re-read and keeps array identity when data is unchanged", async () => {
    const { result } = renderHook(() => useWorkItemReferences(scope), {
      wrapper: server.wrapper,
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const firstReferences = result.current.references;

    await act(async () => {
      await refreshWorkItemLists(server.graphql.apollo, {
        organizationId: "org-1",
        projectId: "project-1",
      });
    });

    await waitFor(() =>
      expect(server.received("GetAllWorkItemReferences")).toHaveLength(2),
    );
    expect(result.current.status).toBe("ready");
    expect(result.current.references).toBe(firstReferences);
  });
});

describe("useWorkItemReferencePage", () => {
  it("is disabled for an invalid page and does not read", () => {
    const server = new FakeWorkItemServer([feature]);
    const { result } = renderHook(
      () => useWorkItemReferencePage({ ...scope, page: 0 }),
      { wrapper: server.wrapper },
    );

    expect(result.current).toEqual({
      status: "disabled",
      page: null,
      isFetching: false,
    });
    expect(server.requests).toEqual([]);
  });

  it("preserves filtered page metadata and sends the filtered request", async () => {
    const contracts = Array.from({ length: 45 }, (_, index) => ({
      id: `contract-${index}`,
      name: `Promise ${index}`,
      type: "CONTRACT",
      status: "ACTIVE",
    }));
    const server = new FakeWorkItemServer(contracts);
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
      wrapper: server.wrapper,
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current).toMatchObject({
      page: {
        items: expect.arrayContaining([
          expect.objectContaining({ id: "contract-20" }),
        ]),
        pagination: {
          page: 2,
          limit: 20,
          total: 45,
          totalPages: 3,
          hasNext: true,
          hasPrevious: true,
        },
      },
    });
    expect(server.received("GetWorkItemReferencePage")[0]).toMatchObject({
      type: "CONTRACT",
      page: 2,
      limit: 20,
      filter: "promise",
      statuses: [WorkStatus.Active],
      sortBy: "createdAt",
      sortOrder: "desc",
    });
  });
});
