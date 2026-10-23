import { captureRequestOptions } from "../core/requestInitiator";
import { queryOptions } from "@tanstack/react-query";
import type { ArtifactType, ArtifactStatus } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
export interface ArtifactFilters {
  type?: ArtifactType;
  status?: ArtifactStatus;
  sourceType?: string;
  sourceId?: string;
  tags?: string;
  category?: string;
  parentId?: string;
  publicOnly?: boolean;
}
export const artifactKeys = {
  root: () => ["artifacts"] as const,
  all: (organizationId: string) =>
    [...artifactKeys.root(), organizationId] as const,
  detail: (organizationId: string, artifactId: string) =>
    [...artifactKeys.all(organizationId), "detail", artifactId] as const,
  list: (
    organizationId: string,
    projectId: string | undefined,
    filters: ArtifactFilters = {}
  ) =>
    [
      ...artifactKeys.all(organizationId),
      "list",
      projectId || "",
      filters,
    ] as const,
};
export const artifactQueryOptions = (
  organizationId: string,
  artifactId: string
) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: artifactKeys.detail(organizationId, artifactId),
    queryFn: async ({ signal }) => {
      const response = await unifiedApiClient.getArtifact(
        { organizationId, id: artifactId },
        { ...captureRequestOptions(), signal }
      );
      return response.data?.data ?? null;
    },
  });
export const artifactsQueryOptions = (
  organizationId: string,
  projectId: string | undefined,
  filters: ArtifactFilters = {}
) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: artifactKeys.list(organizationId, projectId, filters),
    queryFn: async ({ signal }) => {
      const response = await unifiedApiClient.findManyArtifacts(
        {
          organizationId,
          projectId: projectId || undefined,
          ...filters,
          page: 1,
          limit: 100,
          orderBy: "createdAt",
          orderDirection: "desc",
        },
        { ...captureRequestOptions(), signal }
      );
      return response.data?.data ?? [];
    },
  });
