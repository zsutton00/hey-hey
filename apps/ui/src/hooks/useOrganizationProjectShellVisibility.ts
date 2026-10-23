import { useOrganization } from "@hey-hey/ui-common/context";
import { useProjects } from "@hey-hey/ui-common/data";

export interface OrganizationProjectShellVisibility {
  isProjectCollectionReady: boolean;
  shouldShowProjectShell: boolean;
}

export function useOrganizationProjectShellVisibility(): OrganizationProjectShellVisibility {
  const {
    currentOrganization,
    loading: isOrganizationLoading,
  } = useOrganization();
  const organizationId = currentOrganization?.id;
  const { projects, isFetched, isReady } = useProjects(organizationId, {
    enabled: Boolean(organizationId),
  });

  const isProjectCollectionReady =
    Boolean(organizationId) &&
    !isOrganizationLoading &&
    isFetched &&
    isReady;

  return {
    isProjectCollectionReady,
    shouldShowProjectShell:
      !isProjectCollectionReady || projects.length > 1,
  };
}
