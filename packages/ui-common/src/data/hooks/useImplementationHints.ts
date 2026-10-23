import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import orderBy from "lodash/orderBy.js";
import type {
  CreateImplementationHintDto,
  ImplementationHintDto,
  UpdateImplementationHintDto,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import {
  implementationHintKeys,
  implementationHintsQueryOptions,
} from "../collections/implementationHints";
import type { CollectionHookOptions, MutationCallbacks } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import {
  cancelEntityReads,
  changeCachedEntity,
  replaceListEntity,
} from "../query/optimisticEntityCache";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";
export interface UseImplementationHintsReturn {
  hints: ImplementationHintDto[];
  isLoading: boolean;
  isFetching: boolean;
  isFetched: boolean;
  isReady: boolean;
  error: string | null;
  isStale: boolean;
  create: (
    hintData: CreateImplementationHintDto,
    callbacks?: MutationCallbacks<ImplementationHintDto>
  ) => Promise<boolean>;
  update: (
    hintId: string,
    updates: UpdateImplementationHintDto,
    callbacks?: MutationCallbacks<ImplementationHintDto>
  ) => Promise<ImplementationHintDto>;
  remove: (
    hintId: string,
    callbacks?: MutationCallbacks<void>
  ) => Promise<void>;
  refetch: () => Promise<ImplementationHintDto[] | null>;
  markStale: () => void;
  clearError: () => void;
}
export interface UseImplementationHintsOptions
  extends CollectionHookOptions<ImplementationHintDto> {
  agentSessionId?: string;
}
function optimisticHint(
  input: CreateImplementationHintDto,
  id: string
): ImplementationHintDto {
  const now = new Date().toISOString();
  return {
    id,
    serviceId: input.serviceId,
    agentSessionId: input.agentSessionId,
    featureName: input.featureName,
    description: input.description,
    sourceType: input.sourceType,
    hint: input.description,
    createdAt: now,
    updatedAt: now,
  };
}
function useHintCreate(
  organizationId: string | undefined,
  serviceId: string | undefined,
  agentSessionId: string | undefined
) {
  const client = useQueryClient();
  return useCallback(
    async (
      input: CreateImplementationHintDto,
      callbacks?: MutationCallbacks<ImplementationHintDto>
    ) => {
      if (!organizationId || !serviceId)
        throw new Error("Organization ID and Service ID are required");
      const key = implementationHintKeys.list(organizationId, {
        serviceId,
        agentSessionId,
      });
      const id = `temp-${crypto.randomUUID()}`;
      await client.cancelQueries({ queryKey: key, exact: true });
      client.setQueryData<ImplementationHintDto[]>(key, (items) => [
        ...(items ?? []),
        optimisticHint(input, id),
      ]);
      try {
        const response = await unifiedApiClient.createImplementationHint({
          organizationId,
          createImplementationHintDto: input,
        });
        const created = response.data?.data;
        if (!created) throw new Error("No hint data returned from API");
        replaceListEntity(client, key, id, created);
        client.setQueryData(
          implementationHintKeys.detail(
            organizationId,
            created.serviceId,
            created.id
          ),
          created
        );
        void invalidateWithFollowUpRead(client, {
          queryKey: implementationHintKeys.lists(organizationId),
        });
        callbacks?.onSuccess?.(created);
        return true;
      } catch (error) {
        replaceListEntity(client, key, id, null);
        callbacks?.onError?.(
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      } finally {
        callbacks?.onSettled?.();
      }
    },
    [client, organizationId, serviceId, agentSessionId]
  );
}
function useHintUpdate(
  organizationId: string | undefined,
  serviceId: string | undefined
) {
  const client = useQueryClient();
  return useCallback(
    async (
      id: string,
      updates: UpdateImplementationHintDto,
      callbacks?: MutationCallbacks<ImplementationHintDto>
    ) => {
      if (!organizationId || !serviceId)
        throw new Error("Organization ID and Service ID are required");
      const scope = {
        lists: implementationHintKeys.lists(organizationId),
        details: implementationHintKeys.details(organizationId),
      };
      await cancelEntityReads<ImplementationHintDto>(
        client,
        scope,
        id,
        implementationHintKeys.detail(organizationId, serviceId, id)
      );
      const rollback = changeCachedEntity<ImplementationHintDto>(
        client,
        scope,
        id,
        (current) => ({
          ...current,
          ...updates,
          updatedAt: new Date().toISOString(),
        })
      );
      try {
        const response = await unifiedApiClient.updateImplementationHint({
          organizationId,
          hintId: id,
          updateImplementationHintDto: updates,
        });
        const updated = response.data?.data;
        if (!updated) throw new Error("No hint data returned from API");
        changeCachedEntity<ImplementationHintDto>(
          client,
          scope,
          id,
          () => updated
        );
        client.setQueryData(
          implementationHintKeys.detail(organizationId, updated.serviceId, id),
          updated
        );
        void invalidateWithFollowUpRead(client, { queryKey: scope.lists });
        callbacks?.onSuccess?.(updated);
        return updated;
      } catch (error) {
        rollback();
        callbacks?.onError?.(
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      } finally {
        callbacks?.onSettled?.();
      }
    },
    [client, organizationId, serviceId]
  );
}
function useHintRemove(
  organizationId: string | undefined,
  serviceId: string | undefined
) {
  const client = useQueryClient();
  return useCallback(
    async (id: string, callbacks?: MutationCallbacks<void>) => {
      if (!organizationId || !serviceId)
        throw new Error("Organization ID and Service ID are required");
      const scope = {
        lists: implementationHintKeys.lists(organizationId),
        details: implementationHintKeys.details(organizationId),
      };
      await cancelEntityReads<ImplementationHintDto>(
        client,
        scope,
        id,
        implementationHintKeys.detail(organizationId, serviceId, id)
      );
      const rollback = changeCachedEntity<ImplementationHintDto>(
        client,
        scope,
        id,
        () => null
      );
      try {
        await unifiedApiClient.deleteImplementationHint({
          organizationId,
          hintId: id,
        });
        void invalidateWithFollowUpRead(client, { queryKey: scope.lists });
        callbacks?.onSuccess?.();
      } catch (error) {
        rollback();
        callbacks?.onError?.(
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      } finally {
        callbacks?.onSettled?.();
      }
    },
    [client, organizationId, serviceId]
  );
}
export function useImplementationHints(
  organizationId: string | undefined,
  serviceId: string | undefined,
  options: UseImplementationHintsOptions = {}
): UseImplementationHintsReturn {
  const client = useQueryClient();
  const { agentSessionId, ...collectionOptions } = options;
  const readOptions = implementationHintsQueryOptions(
    organizationId ?? "__noop__",
    { serviceId, agentSessionId }
  );
  const { result, state: query } = useDataLayerQuery(readOptions, {
    ...collectionOptions,
    enabled: !!organizationId && options.enabled !== false,
  });
  const create = useHintCreate(organizationId, serviceId, agentSessionId);
  const update = useHintUpdate(organizationId, serviceId);
  const remove = useHintRemove(organizationId, serviceId);
  const clearError = useCallback(() => {
    if (!organizationId) return;
    const cached = client.getQueryCache().find({
      queryKey: implementationHintKeys.list(organizationId, {
        serviceId,
        agentSessionId,
      }),
      exact: true,
    });
    if (!cached?.state.error) return;
    // Dismiss the failure without discarding data, refreshing, or extending its age.
    cached.setState({
      error: null,
      errorUpdatedAt: 0,
      errorUpdateCount: 0,
      fetchFailureCount: 0,
      fetchFailureReason: null,
      status: cached.state.data === undefined ? "pending" : "success",
    });
  }, [client, organizationId, serviceId, agentSessionId]);
  const sort = collectionOptions.sort ?? ["createdAt", "desc"];
  return {
    ...query,
    hints: orderBy(result.data ?? [], sort[0], sort[1]),
    error: query.error?.message ?? null,
    create,
    update,
    remove,
    clearError,
  };
}
