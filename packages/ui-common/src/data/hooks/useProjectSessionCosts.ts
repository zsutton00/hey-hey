import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CliReadError,
  CliReadProjectSessionCostRow,
  CliReadProjectSessionCostsListErrorResponseDto,
  CliReadProjectSessionCostsListSuccessResponseDto,
  CliReadProjectSessionCostsResultSourceAvailabilityEnum,
} from "../../api";
import {
  buildProjectSessionCostsParams,
  projectSessionCostsQueryOptions,
  type ProjectSessionCostsFilters,
  type ProjectSessionCostsPage,
} from "../collections/projectSessionCosts";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export interface UseProjectSessionCostsOptions
  extends Omit<ProjectSessionCostsFilters, "cursor"> {
  enabled?: boolean;
}

export interface ProjectSessionCostsCollectionResult {
  items: CliReadProjectSessionCostRow[];
  nextCursor: string | null;
  sourceAvailability: CliReadProjectSessionCostsResultSourceAvailabilityEnum;
  costReadAt: string;
}

export interface UseProjectSessionCostsReturn {
  result: ProjectSessionCostsCollectionResult | null;
  typedError: CliReadError | null;
  requestError: Error | null;
  isInitialLoading: boolean;
  isLoadingMore: boolean;
  hasNextPage: boolean;
  loadNextPage: () => void;
}

interface AccumulatedCosts {
  filterKey: string;
  result: ProjectSessionCostsCollectionResult | null;
}

const emptyAccumulation = (filterKey: string): AccumulatedCosts => ({
  filterKey,
  result: null,
});

const isSuccessfulPage = (
  page: ProjectSessionCostsPage
): page is ProjectSessionCostsPage & {
  response: CliReadProjectSessionCostsListSuccessResponseDto;
} => page.response.status === "success";

const isFailedPage = (
  page: ProjectSessionCostsPage
): page is ProjectSessionCostsPage & {
  response: CliReadProjectSessionCostsListErrorResponseDto;
} => page.response.status === "error";

export function useProjectSessionCosts(
  organizationId: string | undefined,
  projectId: string | undefined,
  routingAgentSessionId: string | undefined,
  options: UseProjectSessionCostsOptions = {}
): UseProjectSessionCostsReturn {
  const {
    activityFrom,
    activityTo,
    minKnownCostUsd,
    limit,
    enabled = true,
  } = options;
  const filters = useMemo<ProjectSessionCostsFilters>(
    () => ({
      activityFrom,
      activityTo,
      minKnownCostUsd,
      limit,
    }),
    [activityFrom, activityTo, limit, minKnownCostUsd]
  );
  const filterKey = useMemo(
    () =>
      JSON.stringify(
        buildProjectSessionCostsParams(
          organizationId ?? "__noop__",
          projectId ?? "__noop__",
          routingAgentSessionId ?? "__noop__",
          filters
        )
      ),
    [filters, organizationId, projectId, routingAgentSessionId]
  );
  const [cursor, setCursor] = useState<string | undefined>();
  const [accumulated, setAccumulated] = useState<AccumulatedCosts>(() =>
    emptyAccumulation(filterKey)
  );
  const [typedError, setTypedError] = useState<{
    filterKey: string;
    error: CliReadError;
  } | null>(null);
  const currentFilterKeyRef = useRef(filterKey);
  const processedRequestIdsRef = useRef(new Set<string>());
  currentFilterKeyRef.current = filterKey;

  useEffect(() => {
    processedRequestIdsRef.current.clear();
    setCursor(undefined);
    setAccumulated(emptyAccumulation(filterKey));
    setTypedError(null);
  }, [filterKey]);

  const queryKey = useMemo(
    () =>
      buildProjectSessionCostsParams(
        organizationId ?? "__noop__",
        projectId ?? "__noop__",
        routingAgentSessionId ?? "__noop__",
        { ...filters, cursor }
      ),
    [cursor, filters, organizationId, projectId, routingAgentSessionId]
  );
  const canRead =
    enabled && !!organizationId && !!projectId && !!routingAgentSessionId;
  const { result: read, state: query } = useDataLayerQuery(
    projectSessionCostsQueryOptions(queryKey),
    { enabled: canRead }
  );
  const page = read.data ?? null;

  useEffect(() => {
    if (
      !page ||
      currentFilterKeyRef.current !== filterKey ||
      processedRequestIdsRef.current.has(page.id)
    ) {
      return;
    }
    processedRequestIdsRef.current.add(page.id);

    if (isFailedPage(page)) {
      setTypedError({ filterKey, error: page.response.error });
      if (cursor === undefined) {
        setAccumulated(emptyAccumulation(filterKey));
      }
      return;
    }

    if (!isSuccessfulPage(page)) {
      return;
    }

    setTypedError(null);
    setAccumulated((current) => {
      const next = page.response.result;
      if (cursor === undefined) {
        return {
          filterKey,
          result: next,
        };
      }

      const existing =
        current.filterKey === filterKey ? current.result?.items ?? [] : [];
      const seen = new Set(existing.map((item) => item.agentSessionId));
      const appended = next.items.filter((item) => {
        if (seen.has(item.agentSessionId)) {
          return false;
        }
        seen.add(item.agentSessionId);
        return true;
      });
      return {
        filterKey,
        result: {
          ...next,
          items: [...existing, ...appended],
        },
      };
    });
  }, [cursor, filterKey, page]);

  const visibleResult =
    accumulated.filterKey === filterKey ? accumulated.result : null;
  const visibleTypedError =
    typedError?.filterKey === filterKey ? typedError.error : null;
  const loadNextPage = useCallback(() => {
    if (!query.isFetching && visibleResult?.nextCursor) {
      setCursor(visibleResult.nextCursor);
    }
  }, [query.isFetching, visibleResult?.nextCursor]);
  return {
    result: visibleResult,
    typedError: visibleTypedError,
    requestError: query.error,
    isInitialLoading: canRead && query.isLoading && !visibleResult,
    isLoadingMore: query.isFetching && cursor !== undefined,
    hasNextPage: visibleResult?.nextCursor !== null && !!visibleResult,
    loadNextPage,
  };
}
