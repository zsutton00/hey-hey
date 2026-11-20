import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type {
  ProjectApprovalPolicyReplaceRequest,
  ProjectApprovalPolicyRestoreRequest,
  ProjectApprovalPolicySnapshot,
} from "../../api";
import { platformClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";
import { entityContextKeys } from "./entityContext";
import { messageKeys } from "./messages";
import { proposalKeys } from "./proposals";

export const projectApprovalPolicyRoot = () =>
  ["projectApprovalPolicy"] as const;
export const projectApprovalPolicyKey = (
  organizationId: string,
  projectId: string,
) => ["projectApprovalPolicy", organizationId, projectId] as const;
export const projectApprovalPolicyQueryOptions = (
  organizationId: string,
  projectId: string,
) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: projectApprovalPolicyKey(organizationId, projectId),
    queryFn: async ({ signal }) =>
      (
        await platformClient.getProjectApprovalPolicy(
          { organizationId, projectId },
          { ...captureRequestOptions(), signal },
        )
      ).data.data,
  });

export async function changeProjectApprovalPolicy(
  client: QueryClient,
  organizationId: string,
  projectId: string,
  change:
    ProjectApprovalPolicyReplaceRequest | ProjectApprovalPolicyRestoreRequest,
): Promise<ProjectApprovalPolicySnapshot> {
  const options = captureRequestOptions();
  const response =
    "rules" in change
      ? await platformClient.replaceProjectApprovalPolicy(
          {
            organizationId,
            projectId,
            projectApprovalPolicyReplaceRequest: change,
          },
          options,
        )
      : await platformClient.restoreProjectApprovalPolicyDefaults(
          {
            organizationId,
            projectId,
            projectApprovalPolicyRestoreRequest: change,
          },
          options,
        );
  const key = projectApprovalPolicyKey(organizationId, projectId);
  await client.cancelQueries({ queryKey: key, exact: true });
  client.setQueryData(key, response.data.data);
  void invalidateWithFollowUpRead(client, { queryKey: key, exact: true });
  // Review projections carry API-resolved approval state; re-read them so
  // pending reviews show the rule the server now enforces.
  for (const queryKey of [
    proposalKeys.project(organizationId, projectId),
    messageKeys.project(organizationId, projectId),
    entityContextKeys.all(organizationId, projectId),
  ]) {
    void invalidateWithFollowUpRead(client, { queryKey });
  }
  return response.data.data;
}
