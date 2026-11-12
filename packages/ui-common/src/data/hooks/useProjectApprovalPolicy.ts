import { useQueryClient } from "@tanstack/react-query";
import type {
  ProjectApprovalPolicyReplaceRequest,
  ProjectApprovalPolicyRestoreRequest,
} from "../../api";
import {
  changeProjectApprovalPolicy,
  projectApprovalPolicyQueryOptions,
} from "../collections/projectApprovalPolicy";
import { useMutation } from "../core/useMutation";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export function useProjectApprovalPolicy(
  organizationId: string,
  projectId: string,
) {
  const client = useQueryClient();
  const { result, state } = useDataLayerQuery(
    projectApprovalPolicyQueryOptions(organizationId, projectId),
    { enabled: !!organizationId && !!projectId },
  );
  const change = useMutation(
    (
      request:
        | ProjectApprovalPolicyReplaceRequest
        | ProjectApprovalPolicyRestoreRequest,
    ) =>
      changeProjectApprovalPolicy(client, organizationId, projectId, request),
  );
  return { ...state, data: result.data ?? null, change };
}
