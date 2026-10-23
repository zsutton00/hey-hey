import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  organizationKeys,
  organizationsDirectoryQueryOptions,
  parseOrganizationsDirectoryResponse,
} from "../organizationsDirectory";
import {
  OrganizationDirectorySortBy,
  OrganizationDirectorySortOrder,
} from "../../../api";

const { listOrganizationDirectoryMock } = vi.hoisted(() => ({
  listOrganizationDirectoryMock: vi.fn(),
}));

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    listOrganizationDirectory: listOrganizationDirectoryMock,
  },
}));

describe("organizations directory collection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes and keys every query input, including cursor and page size", () => {
    const base = organizationKeys.directory({
      name: "  Acme  ",
      sortBy: OrganizationDirectorySortBy.Name,
      sortOrder: OrganizationDirectorySortOrder.Asc,
      limit: 10,
    });
    const nextPage = organizationKeys.directory({
      name: "Acme",
      sortBy: OrganizationDirectorySortBy.Name,
      sortOrder: OrganizationDirectorySortOrder.Asc,
      cursor: "next-page",
      limit: 10,
    });
    const differentSort = organizationKeys.directory({
      name: "Acme",
      sortBy: OrganizationDirectorySortBy.MemberCount,
      sortOrder: OrganizationDirectorySortOrder.Desc,
      limit: 10,
    });
    const differentSession = organizationKeys.directory({
      name: "  Acme  ",
      sortBy: OrganizationDirectorySortBy.Name,
      sortOrder: OrganizationDirectorySortOrder.Asc,
      limit: 10,
      cacheScope: "mount-2",
    });

    expect(base[1]).toMatchObject({
      name: "Acme",
      sortBy: OrganizationDirectorySortBy.Name,
      sortOrder: OrganizationDirectorySortOrder.Asc,
      limit: 10,
    });
    expect(base).not.toEqual(nextPage);
    expect(base).not.toEqual(differentSort);
    expect(base).not.toEqual(differentSession);
    expect(organizationKeys.directory({ name: "Acme" })[1]).toMatchObject({
      name: "Acme",
      sortBy: OrganizationDirectorySortBy.CreatedAt,
      sortOrder: OrganizationDirectorySortOrder.Desc,
      limit: 25,
    });
  });

  it("serializes the protected collection request and stores the page as one query result", async () => {
    const queryKey = organizationKeys.directory({
      name: "Acme",
      sortBy: OrganizationDirectorySortBy.CreatedAt,
      sortOrder: OrganizationDirectorySortOrder.Desc,
      cursor: "next-page",
      limit: 10,
      cacheScope: "hook-1",
    });
    listOrganizationDirectoryMock.mockResolvedValue({
      data: {
        data: {
          organizations: [
            {
              id: "org-1",
              name: "Acme",
              createdAt: "2026-09-01T00:00:00.000Z",
              memberCount: 4,
              subscriptionType: "BETA",
              accessStatus: "ACTIVE",
            },
          ],
          totalCount: 11,
          nextCursor: "after-org-1",
        },
      },
    });

    const client = new QueryClient();
    const options = organizationsDirectoryQueryOptions(queryKey[1]);
    const page = await client.fetchQuery(options);
    expect(page.totalCount).toBe(11);
    expect(listOrganizationDirectoryMock).toHaveBeenCalledWith(
      {
        name: "Acme",
        sortBy: OrganizationDirectorySortBy.CreatedAt,
        sortOrder: OrganizationDirectorySortOrder.Desc,
        cursor: "next-page",
        limit: 10,
      },
      {}
    );
    client.clear();
  });

  it("rejects responses that do not contain the generated page shape", () => {
    expect(() =>
      parseOrganizationsDirectoryResponse({
        data: { organizations: [], totalCount: "11", nextCursor: null },
      })
    ).toThrow("does not match the generated contract");
  });

  it.each([
    [{ accessStatus: "ACTIVE" }, "subscriptionType"],
    [{ subscriptionType: "BETA" }, "accessStatus"],
    [
      { subscriptionType: "TRIAL", accessStatus: "ACTIVE" },
      "subscriptionType enum",
    ],
    [
      { subscriptionType: "PAID", accessStatus: "SUSPENDED" },
      "accessStatus enum",
    ],
  ])("rejects malformed entitlement data missing or violating %s", (fields) => {
    expect(() =>
      parseOrganizationsDirectoryResponse({
        data: {
          organizations: [
            {
              id: "org-1",
              name: "Acme",
              createdAt: "2026-09-01T00:00:00.000Z",
              memberCount: 4,
              ...fields,
            },
          ],
          totalCount: 1,
          nextCursor: null,
        },
      })
    ).toThrow("does not match the generated contract");
  });
});
