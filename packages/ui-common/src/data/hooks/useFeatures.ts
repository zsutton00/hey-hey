import { useState, useEffect } from "react";
import {
  type OrganizationsOrganizationIdProjectsProjectIdTasksGet200Response,
  type TaskResponseDto,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import type { AxiosResponse } from "axios";

export interface UseFeaturesReturn {
  features: TaskResponseDto[];
  isLoading: boolean;
  error: Error | null;
}

export function useFeatures(
  organizationId: string,
  projectId: string
): UseFeaturesReturn {
  const [features, setFeatures] = useState<TaskResponseDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!organizationId || !projectId) return;

    setIsLoading(true);
    setError(null);

    unifiedApiClient
      .getTasks({
        organizationId,
        projectId,
        parentTaskId: null,
        type: "FEATURE",
      })
      .then(
        (
          response: AxiosResponse<OrganizationsOrganizationIdProjectsProjectIdTasksGet200Response>
        ) => {
          const tasks = response.data?.data ?? [];
          setFeatures(tasks);
        }
      )
      .catch((err: Error) => setError(err))
      .finally(() => setIsLoading(false));
  }, [organizationId, projectId]);

  return { features, isLoading, error };
}
