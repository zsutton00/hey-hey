import type { TaskResponseDto } from "../../api";
import { useWorkItems } from "./useWorkItems";

export interface UseFeaturesReturn {
  features: TaskResponseDto[];
  isLoading: boolean;
  error: Error | null;
}

/** The project's top-level features, from the shared work-item records. */
export function useFeatures(
  organizationId: string,
  projectId: string,
): UseFeaturesReturn {
  const { workItems, isLoading, error } = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    { taskType: "FEATURE", parentTaskId: null },
  );

  return { features: workItems, isLoading, error };
}
