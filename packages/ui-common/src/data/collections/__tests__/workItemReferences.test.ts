import { describe, expect, it } from "vitest";
import {
  OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum,
  OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum,
  WorkStatus,
} from "../../../api";
import { FakeWorkItemServer } from "../../../test/workItemGraphQL";
import {
  WORK_ITEM_REFERENCE_CACHE_AGE_MS,
  workItemReferencePageRead,
  workItemReferencesRead,
} from "../workItemReferences";

const scope = { organizationId: "org-1", projectId: "project-1" };

const contracts = Array.from({ length: 5 }, (_, index) => ({
  id: `contract-${index + 1}`,
  name: `Promise ${index + 1}`,
  type: "CONTRACT",
  status: "ACTIVE",
  parentTaskId: index === 0 ? null : "contract-1",
}));

describe("work-item reference reads", () => {
  const run = async <TQuery, TData>(
    server: FakeWorkItemServer,
    read: {
      document: Parameters<
        ReturnType<typeof server.graphql.forProject>["query"]
      >[0]["query"];
      variables?: unknown;
      select: (data: TQuery) => TData | null;
    },
  ) => {
    const { data } = await server.graphql.forProject(scope).query({
      query: read.document,
      variables: read.variables as never,
      context: scope,
    });

    return read.select(data as TQuery);
  };

  it("reads every reference of a type, with the identity and parent each carries", async () => {
    const server = new FakeWorkItemServer([
      ...contracts,
      { id: "feature-1", name: "Feature", type: "FEATURE", status: "ACTIVE" },
    ]);

    const references = await run(
      server,
      workItemReferencesRead({ ...scope, workItemType: "CONTRACT" }),
    );

    expect(references?.map((reference) => reference.id)).toEqual(
      contracts.map((contract) => contract.id),
    );
    expect(references?.[1]).toEqual({
      id: "contract-2",
      name: "Promise 2",
      type: "CONTRACT",
      parentTaskId: "contract-1",
    });
    expect(WORK_ITEM_REFERENCE_CACHE_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("reads one filtered page without dropping its pagination", async () => {
    const server = new FakeWorkItemServer(contracts);
    const read = workItemReferencePageRead({
      ...scope,
      workItemType: "CONTRACT",
      page: 2,
      limit: 2,
      filter: " promise ",
      statuses: [WorkStatus.Active, WorkStatus.Completed],
      sortBy:
        OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum.CreatedAt,
      sortOrder:
        OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum.Desc,
    });

    const page = await run(server, read);

    expect(server.received("GetWorkItemReferencePage")[0]).toEqual({
      type: "CONTRACT",
      page: 2,
      limit: 2,
      filter: "promise",
      statuses: ["ACTIVE", "COMPLETED"],
      sortBy: "createdAt",
      sortOrder: "desc",
    });
    expect(page?.items.map((item) => item.id)).toEqual([
      "contract-3",
      "contract-4",
    ]);
    expect(page?.pagination).toEqual({
      page: 2,
      limit: 2,
      total: 5,
      totalPages: 3,
      hasNext: true,
      hasPrevious: true,
    });
  });

  it("sorts by name, ascending, unless told otherwise", async () => {
    const server = new FakeWorkItemServer(contracts);

    await run(
      server,
      workItemReferencePageRead({
        ...scope,
        workItemType: "CONTRACT",
        page: 1,
        limit: 20,
      }),
    );

    expect(server.received("GetWorkItemReferencePage")[0]).toMatchObject({
      sortBy: "name",
      sortOrder: "asc",
    });
  });
});

describe("work-item reference status filters", () => {
  const base = {
    ...scope,
    workItemType: "RECIPE",
    page: 1,
    limit: 20,
  };

  it("keeps names containing commas intact in requests", async () => {
    const server = new FakeWorkItemServer([]);
    const joined = ["Ready, pending sign-off"];
    const split = ["Ready", "pending sign-off"];

    for (const statuses of [joined, split]) {
      await server.graphql.forProject(scope).query({
        query: workItemReferencePageRead({ ...base, statuses }).document,
        variables: workItemReferencePageRead({ ...base, statuses })
          .variables as never,
        context: scope,
        fetchPolicy: "network-only",
      });
    }

    expect(
      server.received("GetWorkItemReferencePage").map((v) => v.statuses),
    ).toEqual([joined, split]);
  });
});
