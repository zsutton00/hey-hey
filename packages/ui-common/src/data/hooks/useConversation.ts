import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConversationResponseDto, ConversationStatus } from "../../api";
import {
  conversationQueryOptions,
  workflowConversationListQueryOptions,
} from "../collections/conversations";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";

export type ConversationQueryOptions =
  | { conversationId: string }
  | {
      workflowName: string;
      workflowAboutId: string;
      status?: ConversationStatus;
    }
  | { workflowName: string };

export interface UseConversationOptions
  extends CollectionHookOptions<ConversationResponseDto> {
  /** Custom polling interval in ms when no conversation found (default: 2000) */
  pollingInterval?: number;
  /** Maximum retry attempts (default: 10) */
  maxRetries?: number;
  /** Enable aggressive polling when no data found (default: true) */
  enablePolling?: boolean;
  /** Include suggestion decisions in the conversation response (default: false) */
  includeSuggestionDecisions?: boolean;
}

export interface UseConversationReturn
  extends DataHookReturn<ConversationResponseDto> {
  // Additional data for workflow-based fetching
  workflowId?: string | null;
  isReady: boolean;
  retryCount: number;
}

const newestConversation = (
  conversations: readonly ConversationResponseDto[]
): ConversationResponseDto | null =>
  conversations.reduce<ConversationResponseDto | null>(
    (latest, current) =>
      !latest || current.createdAt > latest.createdAt ? current : latest,
    null
  );

export function useConversation(
  organizationId: string | undefined,
  projectId: string | undefined,
  queryOptions: ConversationQueryOptions,
  options: UseConversationOptions = {}
): UseConversationReturn {
  const {
    pollingInterval = 2000,
    maxRetries = 10,
    enablePolling = true,
    includeSuggestionDecisions,
    ...baseOptions
  } = options;

  // Extract query parameters
  const conversationId =
    "conversationId" in queryOptions ? queryOptions.conversationId : undefined;
  const workflowName =
    "workflowName" in queryOptions ? queryOptions.workflowName : undefined;
  const workflowAboutId =
    "workflowAboutId" in queryOptions
      ? queryOptions.workflowAboutId
      : undefined;
  const workflowStatus =
    "workflowName" in queryOptions && "status" in queryOptions
      ? queryOptions.status
      : undefined;

  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const isPolling = useRef<boolean>(false);
  const [isInitialFetch, setIsInitialFetch] = useState(true);

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);
  const activeConversationRef = useRef<ConversationResponseDto | null>(null);

  // Determine fetching strategy:
  // - If conversationId is provided, use direct conversation fetching
  // - If workflow parameters are provided, use workflow-based fetching with polling
  const shouldUseWorkflowFetch =
    !conversationId && !!workflowName && !!workflowAboutId;

  const workflowQueryOptions = useMemo(
    () =>
      workflowConversationListQueryOptions(
        organizationId ?? "__noop__",
        projectId ?? "__noop__",
        {
          workflowName: workflowName ?? "__noop__",
          workflowAboutId: workflowAboutId ?? "__noop__",
          status: workflowStatus,
        }
      ),
    [organizationId, projectId, workflowName, workflowAboutId, workflowStatus]
  );

  const workflowQueryEnabled =
    shouldUseWorkflowFetch &&
    baseOptions.enabled !== false &&
    !!organizationId &&
    !!projectId &&
    !!workflowName &&
    !!workflowAboutId;

  const { result: workflowResult, state: workflowConversationsQuery } =
    useDataLayerQuery(workflowQueryOptions, {
      enabled: workflowQueryEnabled,
    });

  // Find active conversation from workflow results
  const findActiveWorkflowConversation = useCallback(() => {
    if (!shouldUseWorkflowFetch) return null;

    const data = workflowResult.data;

    // Handle the case where data could be array or unknown
    let conversations: ConversationResponseDto[];
    if (Array.isArray(data)) {
      conversations = data;
    } else {
      return null;
    }

    if (conversations.length === 0) return null;

    // Select metadata independently of Message readiness.
    return newestConversation(conversations);
  }, [shouldUseWorkflowFetch, workflowResult.data]);

  const workflowActiveConversation = findActiveWorkflowConversation();
  const effectiveConversationId =
    conversationId || workflowActiveConversation?.id;

  // Direct conversation fetching (when conversationId is known)
  const directQueryOptions = useMemo(
    () =>
      conversationQueryOptions(
        organizationId ?? "__noop__",
        projectId ?? "__noop__",
        effectiveConversationId ?? "__noop__",
        includeSuggestionDecisions ?? false
      ),
    [organizationId, projectId, effectiveConversationId, includeSuggestionDecisions]
  );

  const directQueryEnabled =
    baseOptions.enabled !== false &&
    !!organizationId &&
    !!projectId &&
    !!effectiveConversationId;

  const { result: directResult, state: directQuery } = useDataLayerQuery(
    directQueryOptions,
    {
      enabled: directQueryEnabled,
      refetchOnMount: baseOptions.refetchOnMount,
      refetchOnWindowFocus: baseOptions.refetchOnWindowFocus,
      staleTimeMs: baseOptions.staleTimeMs,
      maxCacheAgeMs: baseOptions.maxCacheAgeMs,
    }
  );

  // Update refs with current values to avoid stale closures
  useEffect(() => {
    retryCountRef.current = retryCount;
    activeConversationRef.current = workflowActiveConversation;
  }, [retryCount, workflowActiveConversation]);

  // Track initial fetch completion
  useEffect(() => {
    if (shouldUseWorkflowFetch && workflowConversationsQuery.isFetched) {
      setIsInitialFetch(false);
    }
  }, [shouldUseWorkflowFetch, workflowConversationsQuery.isFetched]);

  // Polling state machine - only start polling AFTER initial fetch fails
  useEffect(() => {
    // Clear any existing polling interval
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
      isPolling.current = false;
    }

    // Check if polling should be enabled
    if (
      !shouldUseWorkflowFetch ||
      !enablePolling ||
      baseOptions.enabled === false ||
      !organizationId ||
      !projectId ||
      !workflowName ||
      !workflowAboutId
    ) {
      return;
    }

    // Only start polling if:
    // 1. Initial fetch has completed
    // 2. No active conversation found
    // 3. Not already polling
    // 4. Under retry limit
    // 5. Not currently loading
    const shouldStartPolling =
      !isInitialFetch &&
      !workflowActiveConversation &&
      !isPolling.current &&
      retryCount < maxRetries &&
      !workflowConversationsQuery.isLoading;

    if (shouldStartPolling) {
      isPolling.current = true;
      pollingIntervalRef.current = setInterval(() => {
        const currentRetryCount = retryCountRef.current;
        const currentConversation = activeConversationRef.current;

        if (currentRetryCount >= maxRetries || currentConversation) {
          // Stop polling if we've reached max retries or found conversation
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
            isPolling.current = false;
          }
          return;
        }

        setRetryCount((prev) => prev + 1);
        void workflowConversationsQuery.refetch().catch(() => {});
      }, pollingInterval);
    }

    // Cleanup function
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        isPolling.current = false;
      }
    };
  }, [
    shouldUseWorkflowFetch,
    enablePolling,
    baseOptions.enabled,
    organizationId,
    projectId,
    workflowName,
    workflowAboutId,
    pollingInterval,
    maxRetries,
    isInitialFetch,
    workflowActiveConversation,
    isPolling,
    retryCount,
    workflowConversationsQuery.isLoading,
  ]);

  // Reset retry count and stop polling when conversation is found
  useEffect(() => {
    if (workflowActiveConversation && (retryCount > 0 || isPolling)) {
      setRetryCount(0);

      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        isPolling.current = false;
      }

      // Extract workflowId if available
      if (workflowActiveConversation.workflowId && !workflowId) {
        setWorkflowId(workflowActiveConversation.workflowId);
      }
    }
  }, [workflowActiveConversation, retryCount, isPolling, workflowId]);

  // Enhanced refetch that resets polling state
  const refetch =
    useCallback(async (): Promise<ConversationResponseDto | null> => {
      // Reset polling state on manual refetch
      setRetryCount(0);
      setIsInitialFetch(true);

      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        isPolling.current = false;
      }

      if (shouldUseWorkflowFetch) {
        const conversations = await workflowConversationsQuery.refetch();
        return newestConversation(conversations ?? []);
      }

      return directQuery.refetch();
    }, [
      shouldUseWorkflowFetch,
      workflowConversationsQuery,
      directQuery,
    ]);

  // Determine the final data and loading states
  const directConversation = directResult.data ?? null;
  const finalData = shouldUseWorkflowFetch
    ? directConversation ?? workflowActiveConversation
    : directConversation;

  const finalIsLoading = shouldUseWorkflowFetch
    ? workflowConversationsQuery.isLoading ||
      (isPolling && !workflowActiveConversation)
    : directQuery.isLoading;

  const finalIsFetching = shouldUseWorkflowFetch
    ? workflowConversationsQuery.isFetching ||
      (isPolling && !workflowActiveConversation)
    : directQuery.isFetching;

  const finalError = shouldUseWorkflowFetch
    ? workflowConversationsQuery.error
    : directQuery.error;

  const finalIsStale = shouldUseWorkflowFetch
    ? workflowConversationsQuery.isStale
    : directQuery.isStale;

  const finalIsFetched = shouldUseWorkflowFetch
    ? workflowConversationsQuery.isFetched || retryCount > 0
    : directQuery.isFetched || directQuery.error !== null;

  const markStale = useCallback(() => {
    if (shouldUseWorkflowFetch) {
      workflowConversationsQuery.markStale();
    } else {
      directQuery.markStale();
    }
  }, [shouldUseWorkflowFetch, workflowConversationsQuery, directQuery]);

  const finalIsReady = finalIsFetched && !finalError;

  useWebsocketSubscriptions(
    {
      conversationIds: effectiveConversationId ? [effectiveConversationId] : [],
    },
    {
      enabled: baseOptions.enabled !== false,
    }
  );

  return {
    data: finalData,
    isLoading: finalIsLoading,
    isFetching: finalIsFetching,
    isFetched: finalIsFetched,
    isReady: finalIsReady,
    error: finalError,
    isStale: finalIsStale,
    refetch,
    markStale,
    workflowId: shouldUseWorkflowFetch
      ? workflowId || (finalData as ConversationResponseDto)?.workflowId || null
      : undefined,
    retryCount,
  };
}
