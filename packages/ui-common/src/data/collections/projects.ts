import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { ProjectResponseDto } from "../../api";
import { platformClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
export const projectKeys = {
  root: () => ["projects"] as const,
  all: (org: string) => ["projects", org] as const,
  project: (org: string, project: string) =>
    ["projects", org, project] as const,
  list: (org: string) => ["projects", org, "list"] as const,
  detail: (org: string, project: string) =>
    ["projects", org, project, "detail"] as const,
  members: (org: string, project: string) =>
    ["projects", org, project, "members"] as const,
  metrics: (org: string, project: string | null) =>
    ["projects", org, project, "metrics"] as const,
  counts: (org: string, project: string) =>
    ["projects", org, project, "counts"] as const,
  sessionCosts: (org: string, project: string) =>
    ["projects", org, project, "sessionCosts"] as const,
  providerUsage: (org: string, project: string) =>
    ["projects", org, project, "providerUsage"] as const,
};
export const projectQueryOptions = (
  organizationId: string,
  projectId: string
) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: projectKeys.detail(organizationId, projectId),
    queryFn: async () => {
      const project = (
        await platformClient.findOneProject(
          { organizationId, projectId },
          captureRequestOptions()
        )
      ).data?.data;
      if (!project) throw new Error(`Project not found: ${projectId}`);
      return project;
    },
  });
export const projectsQueryOptions = (organizationId: string) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: projectKeys.list(organizationId),
    queryFn: async () =>
      (
        await platformClient.findAllProjects(
          { organizationId },
          captureRequestOptions()
        )
      ).data?.data?.filter((project) => !project.deletedAt) ?? [],
  });
export function writeProject(
  client: QueryClient,
  org: string,
  project: ProjectResponseDto
) {
  client.setQueryData(projectKeys.detail(org, project.id), project);
  client.setQueryData<ProjectResponseDto[]>(projectKeys.list(org), (rows) =>
    rows?.map((row) => (row.id === project.id ? project : row))
  );
}
export function removeCachedProject(
  client: QueryClient,
  org: string,
  id: string
) {
  client.setQueryData<ProjectResponseDto[]>(projectKeys.list(org), (rows) =>
    rows?.filter((row) => row.id !== id)
  );
  client.removeQueries({ queryKey: projectKeys.project(org, id) });
}
