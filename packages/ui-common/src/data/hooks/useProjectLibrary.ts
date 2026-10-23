import { useMemo } from "react";
import type { DesignDocLibraryNodeDto } from "../../api";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import { designDocLibraryQueryOptions } from "../collections/designDocLibrary";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export type UseProjectLibraryOptions =
  CollectionHookOptions<DesignDocLibraryNodeDto>;

export interface UseProjectLibraryReturn
  extends DataCollectionHookReturn<DesignDocLibraryNodeDto> {
  library: DesignDocLibraryNodeDto[];
}

const EMPTY_LIBRARY: DesignDocLibraryNodeDto[] = [];
export function useProjectLibrary(
  organizationId: string | undefined,
  projectId: string,
  options: UseProjectLibraryOptions = {}
): UseProjectLibraryReturn {
  const queryOptions = useMemo(
    () => designDocLibraryQueryOptions(organizationId ?? "__noop__", projectId),
    [organizationId, projectId]
  );
  const { result, state } = useDataLayerQuery(queryOptions, {
    ...options,
    enabled: (options.enabled ?? true) && !!organizationId && !!projectId,
  });
  const library = result.data ?? EMPTY_LIBRARY;
  return { ...state, data: library, library };
}
