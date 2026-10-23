import { getResponseStatus } from "../query/queryPolicy";
import { useAdminQueryScope } from "../query/useAdminQueryScope";
import { useCallback } from "react";
import type { AdminOrganizationMemberDto } from "../../api";
import {
  adminOrganizationMembersQueryOptions,
  type AdminOrganizationMembersQuery,
} from "../collections/adminOrganizationMembers";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
export const useAdminOrganizationMembers = (
  options: AdminOrganizationMembersQuery & { enabled?: boolean }
) => {
  const cacheScope = useAdminQueryScope();
  const { enabled = true, ...params } = options;
  const { result, state: query } = useDataLayerQuery(
    adminOrganizationMembersQueryOptions(
      { ...params, organizationId: enabled ? params.organizationId : "" },
      cacheScope
    ),
    { enabled: enabled && Boolean(params.organizationId) }
  );
  const page = query.error ? null : result.data ?? null;
  const refetchQuery = query.refetch;
  const refetch = useCallback(async (): Promise<
    AdminOrganizationMemberDto[] | null
  > => {
    const value = await refetchQuery();
    return value?.members ?? null;
  }, [refetchQuery]);
  return {
    ...query,
    data: page?.members ?? [],
    members: page?.members ?? [],
    page,
    totalCount: page?.totalCount ?? 0,
    nextCursor: page?.nextCursor ?? null,
    isForbidden: getResponseStatus(query.error) === 403,
    isReady: query.isReady && page !== null,
    refetch,
  };
};
