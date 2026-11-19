import type { ApolloClient } from "@apollo/client";
import { AgentEdgeType } from "../../api";
import {
  GetModeAvailabilityDocument,
  GetProposalGraphTargetDocument,
  GetTaskPickerAncestorDocument,
  GetWorkItemParentDocument,
} from "../../graphql/generated/graphql";
import type { GraphQLProjectScope } from "./client";
import { queryProject } from "./queryProject";

export async function fetchWorkItemParent(
  client: ApolloClient,
  scope: GraphQLProjectScope,
  id: string,
) {
  const data = await queryProject(client, scope, GetWorkItemParentDocument, {
    id,
  });
  if (!data) {
    throw new Error("Failed to fetch work item");
  }

  return data.workItem;
}

export async function fetchModeAvailability(
  client: ApolloClient,
  scope: GraphQLProjectScope,
  id: string,
) {
  // The edges here are a partial projection. Keep them from replacing the
  // full edge records held by other queries with the same filter.
  const data = await queryProject(
    client,
    scope,
    GetModeAvailabilityDocument,
    { id, edgeTypes: ["DependsOn"] },
    "no-cache",
  );
  const mode = data?.workItem;
  if (!mode) {
    return null;
  }

  return {
    id: mode.id,
    type: mode.type,
    edges: (mode.edges ?? []).map(
      ({ type, source, target, targetNodeType }) => ({
        type: AgentEdgeType[type],
        sourceNodeId: source.entityId,
        targetNodeId: target.entityId,
        targetNodeType: targetNodeType ?? undefined,
        targetNodeName: target.name ?? undefined,
      }),
    ),
  };
}

export async function fetchProposalGraphTarget(
  client: ApolloClient,
  scope: GraphQLProjectScope,
  id: string,
) {
  const data = await queryProject(
    client,
    scope,
    GetProposalGraphTargetDocument,
    { id },
  );
  return data?.workItem;
}

export async function fetchTaskPickerAncestor(
  client: ApolloClient,
  scope: GraphQLProjectScope,
  id: string,
) {
  const data = await queryProject(
    client,
    scope,
    GetTaskPickerAncestorDocument,
    { id },
  );
  return data?.workItem;
}
