import { describe, expect, it } from "vitest";
import { adminOrganizationMemberKeys } from "../adminOrganizationMembers";

describe("admin organization member query key", () => {
  it("binds cursors to organization, normalized search, page size, and cache scope", () => {
    const first = adminOrganizationMemberKeys.list({
      organizationId: "org-1",
      name: " Ada ",
      cursor: "a",
      limit: 25,
      cacheScope: "session-a",
    });
    expect(first).toEqual(
      adminOrganizationMemberKeys.list({
        organizationId: "org-1",
        name: "Ada",
        cursor: "a",
        limit: 25,
        cacheScope: "session-a",
      })
    );
    expect(first).not.toEqual(
      adminOrganizationMemberKeys.list({
        organizationId: "org-1",
        name: "Ada",
        cursor: "b",
        limit: 25,
        cacheScope: "session-a",
      })
    );
  });
});
