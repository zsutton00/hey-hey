import { describe, expect, it } from "vitest";
import {
  assertAdminOrganizationDetailEntitlement,
  adminOrganizationDetailKeys,
} from "../adminOrganizationDetail";

describe("admin organization detail query key", () => {
  it("isolates organization within the QueryClient cache", () => {
    expect(adminOrganizationDetailKeys.detail("org-1")).not.toEqual(
      adminOrganizationDetailKeys.detail("org-2")
    );
  });

  it("rejects detail responses without the required entitlement projection", () => {
    expect(() =>
      assertAdminOrganizationDetailEntitlement({
        organization: {},
        evidence: {},
        latestAgentSessions: [],
      } as never)
    ).toThrow("Invalid admin organization entitlement projection");
  });
});
