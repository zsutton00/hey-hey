import type { AxiosRequestConfig } from "axios";
import { captureRequestOptions } from "../core/requestInitiator";
import type {
  ActivityActorScopeMode,
  ProjectMetricsResponseDto,
  ProjectsApiGetProjectMetricsRequest,
} from "../../api";
import { projectsClient } from "../../clients/serviceClients";
import { queryOptions } from "@tanstack/react-query";
import { projectKeys } from "./projects";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

export interface ProjectMetricsQueryParams {
  organizationId: string;
  projectId?: string | null;
  actorScope?: ActivityActorScopeMode;
  actorUserId?: string | null;
}

const normalizeProjectId = (
  projectId: string | null | undefined
): string | null => {
  const normalizedProjectId = projectId?.trim();
  return normalizedProjectId ? normalizedProjectId : null;
};

export function buildProjectMetricsRequest({
  organizationId,
  projectId,
  actorScope = "ORGANIZATION",
  actorUserId,
}: ProjectMetricsQueryParams): ProjectsApiGetProjectMetricsRequest {
  const normalizedProjectId = normalizeProjectId(projectId);

  return normalizedProjectId
    ? {
        organizationId,
        actorScope,
        ...(actorUserId ? { actorUserId } : {}),
        projectId: normalizedProjectId,
      }
    : {
        organizationId,
        actorScope,
        ...(actorUserId ? { actorUserId } : {}),
      };
}

export async function fetchProjectMetrics(
  params: ProjectMetricsQueryParams,
  requestOptions: AxiosRequestConfig = captureRequestOptions()
): Promise<ProjectMetricsResponseDto | null> {
  if (!params.organizationId) {
    throw new Error("An organization is required to load project metrics");
  }

  const response = await projectsClient.getProjectMetrics(
    buildProjectMetricsRequest(params),
    requestOptions
  );

  return response.data?.data ?? null;
}

export const projectMetricsQueryOptions = (
  params: ProjectMetricsQueryParams
) => {
  const normalized = {
    ...params,
    projectId: normalizeProjectId(params.projectId),
    actorScope: params.actorScope ?? "ORGANIZATION",
    actorUserId: params.actorUserId?.trim() || null,
  } satisfies ProjectMetricsQueryParams;
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: [
      ...projectKeys.metrics(normalized.organizationId, normalized.projectId),
      normalized.actorScope,
      normalized.actorUserId,
    ] as const,
    queryFn: () => fetchProjectMetrics(normalized),
  });
};
