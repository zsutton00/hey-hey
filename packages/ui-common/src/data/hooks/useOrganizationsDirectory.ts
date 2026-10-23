import { useCallback, useSyncExternalStore } from "react";
import { getCurrentUser, onAuthChange } from "../../services/authService";
import {
  type OrganizationDirectoryPageDto,
  type OrganizationDirectoryRowDto,
  OrganizationDirectorySortBy,
  OrganizationDirectorySortOrder,
} from "../../api";
import {
  organizationsDirectoryQueryOptions,
  type OrganizationsDirectoryQuery,
  type OrganizationsDirectoryKey,
} from "../collections/organizationsDirectory";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import { getResponseStatus } from "../query/queryPolicy";
export interface UseOrganizationsDirectoryOptions
  extends CollectionHookOptions<OrganizationDirectoryRowDto>,
    OrganizationsDirectoryQuery {}

export interface UseOrganizationsDirectoryReturn
  extends DataCollectionHookReturn<OrganizationDirectoryRowDto> {
  organizations: OrganizationDirectoryRowDto[];
  page: OrganizationDirectoryPageDto | null;
  totalCount: number;
  nextCursor: string | null;
  isForbidden: boolean;
}

export function useOrganizationsDirectory(
  options: UseOrganizationsDirectoryOptions = {}
): UseOrganizationsDirectoryReturn {
  const { name, sortBy, sortOrder, cursor, limit, cacheScope } = options;
  const identityScope = useSyncExternalStore(
    subscribeAuth,
    getDirectoryIdentityScope,
    getDirectoryIdentityScope
  );
  const { result, state } = useDataLayerQuery(
    organizationsDirectoryQueryOptions({
      name,
      sortBy,
      sortOrder,
      cursor,
      limit,
      cacheScope: JSON.stringify([identityScope, cacheScope ?? ""]),
    }),
    { ...options, enabled: options.enabled !== false }
  );
  const page =
    options.enabled === false || state.error ? null : result.data ?? null;
  const organizations = page?.organizations ?? [];
  const refetch = useCallback(
    async () => (await state.refetch())?.organizations ?? null,
    [state.refetch]
  );
  return {
    ...state,
    data: organizations,
    organizations,
    page,
    totalCount: page?.totalCount ?? 0,
    nextCursor: page?.nextCursor ?? null,
    isForbidden: getResponseStatus(state.error) === 403,
    isReady: state.isReady && page !== null,
    refetch,
  };
}

const subscribeAuth = (listener: () => void) => onAuthChange(listener);

/** Cache isolation only: the server remains the authorization authority. */
function getDirectoryIdentityScope(): string {
  const user = getCurrentUser();
  return JSON.stringify([
    user?.id,
    user && "isDevAdmin" in user ? user.isDevAdmin : undefined,
    user && "devAdminMode" in user ? user.devAdminMode : undefined,
  ]);
}
export type { OrganizationsDirectoryKey, OrganizationsDirectoryQuery };
export { OrganizationDirectorySortBy, OrganizationDirectorySortOrder };
