import { getResponseStatus } from "../query/queryPolicy";
import { useAdminQueryScope } from "../query/useAdminQueryScope";
import { adminOrganizationDetailQueryOptions } from "../collections/adminOrganizationDetail";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
export const useAdminOrganizationDetail = ({
  organizationId,
  enabled = true,
}: {
  organizationId: string;
  enabled?: boolean;
}) => {
  const cacheScope = useAdminQueryScope();
  const { result, state: query } = useDataLayerQuery(
    adminOrganizationDetailQueryOptions(
      enabled ? organizationId : "",
      cacheScope
    ),
    { enabled: enabled && Boolean(organizationId) }
  );
  const data = query.error ? null : result.data ?? null;
  return {
    ...query,
    data,
    isForbidden: getResponseStatus(query.error) === 403,
    isReady: query.isReady && data !== null,
  };
};
