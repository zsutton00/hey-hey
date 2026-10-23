import { useMemo } from "react";
import { useRole } from "./useRole";
import { useOrganization } from "../../contexts/OrganizationContext";

export interface OrganizationOwnerStatus {
  isOwner: boolean;
  canAccessOwnerFeatures: boolean;
  hasOwnerPermissions: boolean;
  organization: {
    id: string | null;
    name: string | null;
  };
  loading: boolean;
  error: string | null;
}

/**
 * Hook specifically for detecting organization ownership status.
 * This is a convenience hook that builds on useRole to provide
 * a simple boolean check for organization owner access.
 */
export const useOrganizationOwner = (): OrganizationOwnerStatus => {
  const { isAuthenticated, isOrganizationOwner } = useRole();

  const { currentOrganization, loading, error } = useOrganization();

  return useMemo<OrganizationOwnerStatus>(() => {
    const isOwner = isAuthenticated && isOrganizationOwner;

    return {
      isOwner,
      canAccessOwnerFeatures: isOwner,
      hasOwnerPermissions: isOwner,
      organization: {
        id: currentOrganization?.id || null,
        name: currentOrganization?.name || null,
      },
      loading,
      error,
    };
  }, [
    isAuthenticated,
    isOrganizationOwner,
    currentOrganization,
    loading,
    error,
  ]);
};
