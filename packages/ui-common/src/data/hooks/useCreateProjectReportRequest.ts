import { useQueryClient } from "@tanstack/react-query";
import { storeProjectReportRequest } from "../collections/reports";
import type {
  CreateProjectReportRequestDto,
  ProjectReportRequestDto,
  RetryProjectReportRequestDto,
} from "../../api";
import { projectReportsClient } from "../../clients/serviceClients";
import type { MutationOptions } from "../core/useMutation";
import { useMutation } from "../core/useMutation";

export interface CreateProjectReportRequestVariables {
  organizationId: string;
  projectId: string;
  request: CreateProjectReportRequestDto;
}

/**
 * Persists a reviewed project-report request. The request's idempotency key
 * makes a resubmission of the same draft return the same durable request.
 */
export function useCreateProjectReportRequest(
  options: MutationOptions<ProjectReportRequestDto> = {}
) {
  const queryClient = useQueryClient();
  return useMutation(
    async ({
      organizationId,
      projectId,
      request,
    }: CreateProjectReportRequestVariables): Promise<ProjectReportRequestDto> => {
      const response = await projectReportsClient.createProjectReportRequest({
        organizationId,
        projectId,
        createProjectReportRequestDto: request,
      });
      const next = response.data.data;
      storeProjectReportRequest(queryClient, organizationId, projectId, next);
      return next;
    },
    options
  );
}

export interface RetryProjectReportRequestVariables {
  organizationId: string;
  projectId: string;
  requestId: string;
  retry: RetryProjectReportRequestDto;
}

/** Retries generation of the persisted submitted request and scope. */
export function useRetryProjectReportRequest(
  options: MutationOptions<ProjectReportRequestDto> = {}
) {
  const queryClient = useQueryClient();
  return useMutation(
    async ({
      organizationId,
      projectId,
      requestId,
      retry,
    }: RetryProjectReportRequestVariables): Promise<ProjectReportRequestDto> => {
      const response = await projectReportsClient.retryProjectReportRequest({
        organizationId,
        projectId,
        requestId,
        retryProjectReportRequestDto: retry,
      });
      const next = response.data.data;
      storeProjectReportRequest(queryClient, organizationId, projectId, next);
      return next;
    },
    options
  );
}
