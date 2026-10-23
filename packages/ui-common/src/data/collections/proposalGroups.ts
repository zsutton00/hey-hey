import { queryOptions } from "@tanstack/react-query";
import type { WebSocketProposalGroupLifecycleEvent } from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { proposalKeys } from "./proposals";

export interface ProposalGroupScope {
  organizationId: string;
  projectId: string;
  groupId: string;
}
export const isProposalGroupLifecycleEventForScope = (
  event: WebSocketProposalGroupLifecycleEvent,
  scope: ProposalGroupScope
): boolean =>
  event.organizationId === scope.organizationId &&
  event.projectId === scope.projectId &&
  event.groupId === scope.groupId;

export function proposalGroupQueryOptions(
  organizationId: string,
  projectId: string,
  groupId: string
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: proposalKeys.group(organizationId, projectId, groupId),
    queryFn: async ({ signal }) => {
      const response = await proposalsClient.getProposalGroup(
        { organizationId, projectId, groupId },
        { ...captureRequestOptions(), signal }
      );
      const group = response.data.data;
      if (!group || !("dependencies" in group)) {
        throw new Error("Proposal group is not frozen for review");
      }
      return group;
    },
  });
}
