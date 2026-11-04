import type { UxFlowMembership } from "../../api";
import { uxFlowMembershipQueryOptions } from "../collections/uxFlowMemberships";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

/** The UX flows whose screens canonically reference this Mockup; empty while loading or when none. */
export function useUxFlowsForMockup(
  organizationId: string | undefined,
  projectId: string | undefined,
  mockupId: string | undefined,
): { flows: readonly UxFlowMembership[]; isLoading: boolean } {
  const { result, state } = useDataLayerQuery(
    uxFlowMembershipQueryOptions(
      organizationId ?? "",
      projectId ?? "",
      mockupId ?? "",
    ),
    { enabled: Boolean(organizationId && projectId && mockupId) },
  );

  return { flows: result.data?.flows ?? [], isLoading: state.isLoading };
}
