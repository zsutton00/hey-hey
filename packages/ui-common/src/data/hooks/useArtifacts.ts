import { useCallback } from "react";
import type {
  ArtifactResponseDto,
  ArtifactType,
  ArtifactStatus,
} from "../../api";
import { artifactsQueryOptions } from "../collections/artifacts";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
export interface UseArtifactsOptions
  extends CollectionHookOptions<ArtifactResponseDto> {
  /** Filter by artifact type */
  type?: ArtifactType;
  /** Filter by artifact status */
  status?: ArtifactStatus;
  /** Filter by source type */
  sourceType?: string;
  /** Filter by source ID */
  sourceId?: string;
  /** Filter by tags (comma-separated) */
  tags?: string;
  /** Filter by category */
  category?: string;
  /** Filter by parent ID */
  parentId?: string;
  /** Filter public artifacts only */
  publicOnly?: boolean;
}

export function useArtifacts(
  organizationId: string | undefined,
  projectId: string | undefined,
  options: UseArtifactsOptions = {}
): DataCollectionHookReturn<ArtifactResponseDto> {
  const {
    type,
    status,
    sourceType,
    sourceId,
    tags,
    category,
    parentId,
    publicOnly,
    ...baseOptions
  } = options;
  const { result, state: query } = useDataLayerQuery(
    artifactsQueryOptions(organizationId ?? "__noop__", projectId, {
      type,
      status,
      sourceType,
      sourceId,
      tags,
      category,
      parentId,
      publicOnly,
    }),
    { ...baseOptions, enabled: !!organizationId && options.enabled !== false }
  );
  const refetchRead = query.refetch;
  const refetch = useCallback(async () => {
    try {
      return await refetchRead();
    } catch {
      return null;
    }
  }, [refetchRead]);
  return { ...query, data: result.data ?? [], refetch };
}
