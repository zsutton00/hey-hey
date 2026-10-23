import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum,
  OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum,
  WorkStatus,
  type WorkItemReferenceDto,
} from "../../../api";
import {
  WORK_ITEM_REFERENCE_CACHE_AGE_MS,
  fetchAllWorkItemReferences,
  fetchWorkItemReferencePageQuery,
  parseWorkItemReferencePage,
  workItemReferenceKeys,
  workItemReferencePageQueryOptions,
  workItemReferencesQueryOptions,
} from "../workItemReferences";

const listWorkItemReferencesMock = vi.hoisted(() => vi.fn());

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    listWorkItemReferences: listWorkItemReferencesMock,
  },
}));

const reference = (
  id: string,
  name: string,
  parentTaskId: string | null = null,
  type = "FEATURE",
): WorkItemReferenceDto => ({ id, name, type, parentTaskId });

const pageResponse = (
  page: number,
  items: WorkItemReferenceDto[],
  hasNext: boolean,
  totalPages: number,
) => ({
  data: {
    data: {
      items,
      pagination: {
        page,
        limit: 500,
        total: 2,
        totalPages,
        hasNext,
        hasPrevious: page > 1,
      },
    },
  },
});

const scope = {
  organizationId: "org-1",
  projectId: "project-1",
  workItemType: "FEATURE",
};

describe("work-item reference queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("isolates organization, project, and work-item type under the project prefix", () => {
    const featureKey = workItemReferenceKeys.list(scope);
    const goalKey = workItemReferenceKeys.list({ ...scope, workItemType: "GOAL" });
    const otherProjectKey = workItemReferenceKeys.list({
      ...scope,
      projectId: "project-2",
    });
    const projectPrefix = workItemReferenceKeys.project("org-1", "project-1");

    expect(featureKey).toEqual([
      "workItemReferences",
      "org-1",
      "project-1",
      "list",
      "FEATURE",
    ]);
    expect(featureKey).not.toEqual(goalKey);
    expect(featureKey).not.toEqual(otherProjectKey);
    expect(featureKey.slice(0, projectPrefix.length)).toEqual(projectPrefix);
    expect(goalKey.slice(0, projectPrefix.length)).toEqual(projectPrefix);
    expect(otherProjectKey.slice(0, projectPrefix.length)).not.toEqual(
      projectPrefix,
    );
    expect(workItemReferencesQueryOptions(scope).staleTime).toBe(
      WORK_ITEM_REFERENCE_CACHE_AGE_MS,
    );
  });

  it("keys and fetches one filtered page without dropping pagination metadata", async () => {
    const response = pageResponse(
      2,
      [reference("contract-1", "Reference promise", null, "CONTRACT")],
      true,
      4,
    );
    listWorkItemReferencesMock.mockResolvedValue(response);
    const query = {
      organizationId: "org-1",
      projectId: "project-1",
      workItemType: "CONTRACT",
      page: 2,
      limit: 20,
      filter: " promise ",
      statuses: [WorkStatus.Active, WorkStatus.Completed],
      sortBy:
        OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum.CreatedAt,
      sortOrder:
        OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum.Desc,
    };

    expect(workItemReferencePageQueryOptions(query).queryKey).toEqual([
      "workItemReferences",
      "org-1",
      "project-1",
      "page",
      {
        workItemType: "CONTRACT",
        page: 2,
        limit: 20,
        filter: "promise",
        statuses: "ACTIVE,COMPLETED",
        sortBy: "createdAt",
        sortOrder: "desc",
      },
    ]);
    await expect(fetchWorkItemReferencePageQuery(query, {})).resolves.toEqual(
      response.data.data,
    );
    expect(listWorkItemReferencesMock).toHaveBeenCalledWith(
      {
        organizationId: "org-1",
        projectId: "project-1",
        type: "CONTRACT",
        page: 2,
        limit: 20,
        filter: "promise",
        statuses: [WorkStatus.Active, WorkStatus.Completed],
        sortBy:
          OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum.CreatedAt,
        sortOrder:
          OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum.Desc,
      },
      {},
    );
  });

  it("traverses every generated page into one logical result", async () => {
    listWorkItemReferencesMock
      .mockResolvedValueOnce(
        pageResponse(1, [reference("feature-1", "First")], true, 2),
      )
      .mockResolvedValueOnce(
        pageResponse(2, [reference("feature-2", "Second")], false, 2),
      );

    const result = await fetchAllWorkItemReferences(scope, {});

    expect(result).toEqual([
      reference("feature-1", "First"),
      reference("feature-2", "Second"),
    ]);
    expect(listWorkItemReferencesMock).toHaveBeenNthCalledWith(
      1,
      { organizationId: "org-1", projectId: "project-1", type: "FEATURE", page: 1, limit: 500 },
      {},
    );
    expect(listWorkItemReferencesMock).toHaveBeenNthCalledWith(
      2,
      { organizationId: "org-1", projectId: "project-1", type: "FEATURE", page: 2, limit: 500 },
      {},
    );
  });

  it("rejects a page number mismatch and a hasNext beyond totalPages", async () => {
    listWorkItemReferencesMock.mockResolvedValueOnce(
      pageResponse(2, [reference("feature-1", "First")], false, 2),
    );
    await expect(fetchAllWorkItemReferences(scope, {})).rejects.toThrow(
      "returned page 2 while requesting page 1",
    );

    listWorkItemReferencesMock.mockResolvedValueOnce(
      pageResponse(1, [reference("feature-1", "First")], true, 1),
    );
    await expect(fetchAllWorkItemReferences(scope, {})).rejects.toThrow(
      "beyond its total page count",
    );
  });

  it("caches a successful empty result as fresh so the next read is skipped", async () => {
    listWorkItemReferencesMock.mockResolvedValue(pageResponse(1, [], false, 0));
    const queryClient = new QueryClient();

    await expect(
      queryClient.fetchQuery(workItemReferencesQueryOptions(scope)),
    ).resolves.toEqual([]);
    await queryClient.fetchQuery(workItemReferencesQueryOptions(scope));

    expect(listWorkItemReferencesMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(workItemReferenceKeys.list(scope))).toEqual(
      [],
    );
    queryClient.clear();
  });

  it("rejects missing required identity or canonical name data", () => {
    const validPage = pageResponse(
      1,
      [reference("feature-1", "First")],
      false,
      1,
    ).data.data;
    expect(parseWorkItemReferencePage(validPage)).toEqual(validPage);

    expect(() =>
      parseWorkItemReferencePage({
        ...validPage,
        items: [{ name: "Missing identity", type: "FEATURE", parentTaskId: null }],
      }),
    ).toThrow("required identity, name, or pagination data");
    expect(() =>
      parseWorkItemReferencePage({
        ...validPage,
        items: [{ id: "feature-1", name: "", type: "FEATURE", parentTaskId: null }],
      }),
    ).toThrow("required identity, name, or pagination data");
    expect(() =>
      parseWorkItemReferencePage({
        ...validPage,
        pagination: { ...validPage.pagination, page: 0 },
      }),
    ).toThrow("required identity, name, or pagination data");
  });
});
