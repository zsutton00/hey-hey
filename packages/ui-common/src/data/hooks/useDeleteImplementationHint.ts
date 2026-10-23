import { useCallback } from "react";
import type { MutationCallbacks } from "../core/types";
import { useImplementationHints } from "./useImplementationHints";

export interface UseDeleteImplementationHintOptions {
  organizationId: string;
  serviceId: string;
}

export interface UseDeleteImplementationHintReturn {
  deleteImplementationHint: (
    hintId: string,
    callbacks?: MutationCallbacks<void>
  ) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function useDeleteImplementationHint(
  options: UseDeleteImplementationHintOptions
): UseDeleteImplementationHintReturn {
  const { organizationId, serviceId } = options;
  const { remove, isLoading, error } = useImplementationHints(
    organizationId,
    serviceId
  );

  const deleteImplementationHint = useCallback(
    async (
      hintId: string,
      callbacks?: MutationCallbacks<void>
    ): Promise<void> => remove(hintId, callbacks),
    [remove]
  );

  return {
    deleteImplementationHint,
    isLoading,
    error,
  };
}
