import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { EntityType, type EntityStarDto } from "../../api";
import { starsClient } from "../../clients/serviceClients";
import {
  entityStarKeys,
  entityStarsQueryOptions,
  filterEntityStars,
} from "../collections/entityStars";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export interface UseEntityStarsOptions
  extends CollectionHookOptions<EntityStarDto> {
  entityType?: EntityType;
}

export interface UseEntityStarsReturn
  extends DataCollectionHookReturn<EntityStarDto> {
  stars: EntityStarDto[];
  isStarred: (entityType: EntityType, entityId: string) => boolean;
  isMutating: boolean;
  mutationError: Error | null;
  star: (entityType: EntityType, entityId: string) => Promise<EntityStarDto>;
  unstar: (entityType: EntityType, entityId: string) => Promise<void>;
  starEntity: (
    entityType: EntityType,
    entityId: string,
  ) => Promise<EntityStarDto>;
  unstarEntity: (entityType: EntityType, entityId: string) => Promise<void>;
  refresh: () => Promise<EntityStarDto[] | null>;
  clearError: () => void;
}

export interface UseEntityStarReturn
  extends Omit<UseEntityStarsReturn, "isStarred" | "star" | "unstar"> {
  isStarred: boolean;
  star: () => Promise<EntityStarDto>;
  unstar: () => Promise<void>;
  toggle: () => Promise<EntityStarDto | void>;
}

const NO_STARS: EntityStarDto[] = [];

const normalizeError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

export function useEntityStars(
  organizationId: string | undefined,
  options: UseEntityStarsOptions = {},
): UseEntityStarsReturn {
  const {
    entityType,
    enabled: enabledOption,
    refetchOnMount,
    refetchOnWindowFocus,
    staleTimeMs,
    maxCacheAgeMs,
  } = options;
  const enabled = enabledOption !== false && !!organizationId;
  const queryClient = useQueryClient();
  const baseOptions = useMemo(
    () => entityStarsQueryOptions(organizationId ?? "__noop__"),
    [organizationId],
  );
  const select = useCallback(
    (allStars: EntityStarDto[]) => filterEntityStars(allStars, entityType),
    [entityType],
  );
  const { result, state: query } = useDataLayerQuery(
    { ...baseOptions, select },
    { enabled, refetchOnMount, refetchOnWindowFocus, staleTimeMs, maxCacheAgeMs },
  );

  const stars = result.data ?? NO_STARS;
  const [isMutating, setIsMutating] = useState(false);
  const [mutationError, setMutationError] = useState<Error | null>(null);
  const inFlightRef = useRef<Promise<unknown> | null>(null);

  const refetch = query.refetch;

  const runMutation = useCallback(
    <T,>(operation: () => Promise<T>): Promise<T> => {
      if (inFlightRef.current) {
        return inFlightRef.current as Promise<T>;
      }

      setMutationError(null);
      setIsMutating(true);
      const promiseHolder: { current: Promise<T> | null } = { current: null };
      const promise = (async () => {
        try {
          const result = await operation();
          if (organizationId) {
            await queryClient.invalidateQueries({
              queryKey: entityStarKeys.all(organizationId),
            });
          }
          return result;
        } catch (cause) {
          const error = normalizeError(cause);
          setMutationError(error);
          throw error;
        } finally {
          if (inFlightRef.current === promiseHolder.current) {
            inFlightRef.current = null;
            setIsMutating(false);
          }
        }
      })();
      promiseHolder.current = promise;
      inFlightRef.current = promise;
      return promise;
    },
    [organizationId, queryClient],
  );

  const star = useCallback(
    (starEntityType: EntityType, entityId: string) => {
      if (!organizationId) {
        return Promise.reject(new Error("Organization ID is required"));
      }

      return runMutation(async () => {
        const response = await starsClient.starEntity({
          organizationId,
          entityType: starEntityType,
          entityId,
        });
        const starData = response.data?.data;
        if (!starData) {
          throw new Error("Star response did not include a star");
        }
        return starData;
      });
    },
    [organizationId, runMutation],
  );

  const unstar = useCallback(
    (unstarEntityType: EntityType, entityId: string) => {
      if (!organizationId) {
        return Promise.reject(new Error("Organization ID is required"));
      }

      return runMutation(async () => {
        await starsClient.unstarEntity({
          organizationId,
          entityType: unstarEntityType,
          entityId,
        });
      });
    },
    [organizationId, runMutation],
  );

  const isStarred = useCallback(
    (starEntityType: EntityType, entityId: string): boolean =>
      stars.some(
        (star) =>
          star.entityType === starEntityType && star.entityId === entityId,
      ),
    [stars],
  );

  const clearError = useCallback(() => setMutationError(null), []);

  return {
    data: stars,
    stars,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetched: query.isFetched,
    isReady: query.isFetched && !query.error && !mutationError,
    error: mutationError ?? query.error,
    isStale: query.isStale,
    refetch,
    refresh: refetch,
    markStale: query.markStale,
    isStarred,
    isMutating,
    mutationError,
    star,
    unstar,
    starEntity: star,
    unstarEntity: unstar,
    clearError,
  };
}

export function useEntityStar(
  organizationId: string | undefined,
  entityType: EntityType,
  entityId: string,
  options: Omit<UseEntityStarsOptions, "entityType"> = {},
): UseEntityStarReturn {
  const stars = useEntityStars(organizationId, {
    ...options,
    entityType,
  });
  const { isStarred: isEntityStarred, star: starEntity, unstar: unstarEntity } =
    stars;
  const isStarred = isEntityStarred(entityType, entityId);
  const star = useCallback(
    () => starEntity(entityType, entityId),
    [entityId, entityType, starEntity],
  );
  const unstar = useCallback(
    () => unstarEntity(entityType, entityId),
    [entityId, entityType, unstarEntity],
  );
  const toggle = useCallback(
    () => (isStarred ? unstar() : star()),
    [isStarred, star, unstar],
  );

  return {
    ...stars,
    isStarred,
    star,
    unstar,
    toggle,
  };
}
