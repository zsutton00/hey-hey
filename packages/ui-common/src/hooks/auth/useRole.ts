import { useMemo } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useOrganization } from "../../contexts/OrganizationContext";
import type { OrganizationRole } from "../../api";

export interface UserRole {
  isAuthenticated: boolean;
  organizationRole: OrganizationRole | null;
  hasOrganizationRole: (role: OrganizationRole) => boolean;
  isOrganizationOwner: boolean;
  isOrganizationAdmin: boolean;
  isOrganizationMember: boolean;
  isOrganizationViewer: boolean;
}

/**
 * Hook for extracting and managing user roles from JWT and organization context.
 * Provides granular role checking capabilities for organization roles.
 */
export const useRole = (): UserRole => {
  const { isAuthenticated, user } = useAuth();
  const { currentOrganization } = useOrganization();

  return useMemo<UserRole>(() => {
    const organizationRole = currentOrganization?.userRole || null;

    const hasOrganizationRole = (role: OrganizationRole): boolean => {
      if (!organizationRole) return false;

      // Role hierarchy: OWNER > ADMIN > MEMBER > VIEWER
      const roleHierarchy: Record<OrganizationRole, number> = {
        OWNER: 4,
        ADMIN: 3,
        MEMBER: 2,
        VIEWER: 1,
      };

      const userLevel = roleHierarchy[organizationRole];
      const requiredLevel = roleHierarchy[role];

      return userLevel >= requiredLevel;
    };

    return {
      isAuthenticated,
      organizationRole,
      hasOrganizationRole,
      isOrganizationOwner: organizationRole === "OWNER",
      isOrganizationAdmin: hasOrganizationRole("ADMIN"),
      isOrganizationMember: hasOrganizationRole("MEMBER"),
      isOrganizationViewer: hasOrganizationRole("VIEWER"),
    };
  }, [isAuthenticated, user, currentOrganization]);
};
