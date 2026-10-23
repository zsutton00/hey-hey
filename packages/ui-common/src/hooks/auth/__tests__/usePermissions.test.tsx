import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrganizationRole } from "../../../api";
import { useOrganization } from "../../../contexts/OrganizationContext";
import { usePermissions } from "../usePermissions";

vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true, user: { isDevAdmin: false } }),
}));

vi.mock("../../../contexts/OrganizationContext", () => ({
  useOrganization: vi.fn(),
}));

const permissionsFor = (role: OrganizationRole) => {
  vi.mocked(useOrganization).mockReturnValue({
    currentOrganization: { id: "org-1", userRole: role },
  } as ReturnType<typeof useOrganization>);
  return renderHook(() => usePermissions()).result.current;
};

describe("usePermissions organization administration", () => {
  it.each([OrganizationRole.Owner, OrganizationRole.Admin])(
    "lets an organization %s create projects, invite and remove members",
    (role) => {
      const permissions = permissionsFor(role);

      expect(permissions.createProjects).toBe(true);
      expect(permissions.inviteMembers).toBe(true);
      expect(permissions.removeMembers).toBe(true);
    }
  );

  it.each([OrganizationRole.Member, OrganizationRole.Viewer])(
    "denies an organization %s project creation and member administration",
    (role) => {
      const permissions = permissionsFor(role);

      expect(permissions.createProjects).toBe(false);
      expect(permissions.inviteMembers).toBe(false);
      expect(permissions.removeMembers).toBe(false);
    }
  );
});
