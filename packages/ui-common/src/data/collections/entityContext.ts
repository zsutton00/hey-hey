import { queryOptions } from "@tanstack/react-query";
import type { EntityType, FullEntityContextDto } from "../../api";
import { entityContextClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

export interface EntityContextParams {
  organizationId: string;
  projectId: string;
  entityType: EntityType;
  entityId: string;
  includeRelatedEntities?: boolean;
  includeFeatureHierarchy?: boolean;
  includeProposals?: boolean;
  includeAvailableMcpTools?: boolean;
}

export const entityContextKeys = {
  root: () => ["entityContext"] as const,
  all: (organizationId: string, projectId: string) =>
    [...entityContextKeys.root(), organizationId, projectId] as const,
  entity: (
    organizationId: string,
    projectId: string,
    entityType: EntityType,
    entityId: string
  ) =>
    [
      ...entityContextKeys.all(organizationId, projectId),
      entityType,
      entityId,
    ] as const,
  context: (params: EntityContextParams) =>
    [
      ...entityContextKeys.entity(
        params.organizationId,
        params.projectId,
        params.entityType,
        params.entityId
      ),
      {
        includeRelatedEntities: params.includeRelatedEntities,
        includeFeatureHierarchy: params.includeFeatureHierarchy,
        includeProposals: params.includeProposals,
        includeAvailableMcpTools: params.includeAvailableMcpTools,
      },
    ] as const,
};

export function entityContextQueryOptions(params: EntityContextParams) {
  const queryKey = entityContextKeys.context(params);
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey,
    queryFn: async ({ signal }): Promise<FullEntityContextDto | null> => {
      const response = await entityContextClient.getEntityContext(
        {
          organizationId: params.organizationId,
          projectId: params.projectId,
          entityType: params.entityType,
          entityId: params.entityId,
          ...queryKey[5],
          relatedEntityDepth: 1,
        },
        { ...captureRequestOptions(), signal }
      );
      return response.data?.data ?? null;
    },
  });
}
