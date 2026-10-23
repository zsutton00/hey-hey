import {
  AgentSessionListSort,
  AgentSessionStatus,
  AgentSessionType,
} from "@hey-hey/ui-common/api";
import {
  AgentSessionListItem,
  AgentSessionUserFilter,
  type AgentSessionUserFilterValue,
} from "@hey-hey/ui-common/components";
import { usePaginatedAgentSessions } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  Stack,
  Switch,
} from "@mui/material";
import { motion, useReducedMotion } from "motion/react";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { MOBILE_ACTIONS_CAPSULE_CLEARANCE } from "../Explorer/mobileActionsCapsule";
import { useSessionFeedPresentation } from "./useSessionFeedPresentation";

const ALL_AGENT_SESSION_STATUSES = Object.values(AgentSessionStatus);
const ACTIVE_ONLY_STORAGE_KEY = "coding-sessions-active-only";

const readInitialActiveOnly = (): boolean => {
  try {
    return localStorage.getItem(ACTIVE_ONLY_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

type PaginatedSessionFeedVariant = "coding" | "conversations";

export interface PaginatedSessionFeedProps {
  organizationId: string;
  projectId: string;
  variant: PaginatedSessionFeedVariant;
  serviceId?: string;
  taskId?: string;
  buildSessionPath?: (agentSessionId: string) => string;
  limit?: number;
  loading?: boolean;
  emptyMessage?: string;
  search?: string;
  sortBy?: string;
  onSessionDelete?: (sessionId: string) => Promise<void>;
  onSessionNavigate?: () => void;
}

const activityStaleTimeMs = 30000;

const visuallyHidden = {
  border: 0,
  clip: "rect(0 0 0 0)",
  height: "1px",
  margin: "-1px",
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: "1px",
} as const;

export const PaginatedSessionFeed: React.FC<PaginatedSessionFeedProps> = ({
  organizationId,
  projectId,
  variant,
  serviceId,
  taskId,
  buildSessionPath,
  limit = 10,
  loading: externalLoading = false,
  emptyMessage,
  search = "",
  sortBy,
  onSessionDelete,
  onSessionNavigate,
}) => {
  const [activeOnly, setActiveOnly] = useState(readInitialActiveOnly);
  const isCoding = variant === "coding";
  const userIdentity = useUserIdentity();
  const [userFilter, setUserFilter] =
    useState<AgentSessionUserFilterValue>("all");
  const selectedUserId =
    isCoding && userFilter === "mine" ? userIdentity?.userId : undefined;
  const userFilterReady =
    !isCoding || userFilter === "all" || Boolean(selectedUserId);
  const {
    items,
    hasNextPage,
    isLoading,
    isFetching,
    isFetchingNextPage,
    hasPendingUpdates,
    isApplyingUpdates,
    error,
    loadNextPage,
    refetch,
  } = usePaginatedAgentSessions(organizationId, projectId, {
    ...(isCoding
      ? {
          type: AgentSessionType.Coding,
          ...(serviceId ? { serviceId } : {}),
          ...(taskId ? { taskId } : {}),
          enabled: userFilterReady,
          userId: selectedUserId,
          statuses: activeOnly
            ? [AgentSessionStatus.InProgress]
            : ALL_AGENT_SESSION_STATUSES,
        }
      : {
          type: AgentSessionType.EntityConversation,
          hasUserMessage: true,
        }),
    sort: AgentSessionListSort.LastMessage,
    limit,
    staleTimeMs: activityStaleTimeMs,
  });
  const [deleteError, setDeleteError] = useState<Error | null>(null);
  const handleDeleteSession = useCallback(
    async (sessionId: string): Promise<void> => {
      if (!onSessionDelete) return;

      setDeleteError(null);
      try {
        await onSessionDelete(sessionId);
        if ((await refetch()) === "applied") {
          scrollAfterApplyRef.current = true;
          setAppliedVersion((version) => version + 1);
        }
      } catch (caughtError) {
        setDeleteError(
          caughtError instanceof Error
            ? caughtError
            : new Error("Failed to delete coding session."),
        );
      }
    },
    [onSessionDelete, refetch],
  );
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const [appliedVersion, setAppliedVersion] = useState(0);
  const scrollAfterApplyRef = useRef(false);
  const handleApplyUpdates = async () => {
    try {
      if ((await refetch()) === "applied") {
        scrollAfterApplyRef.current = true;
        setAppliedVersion((version) => version + 1);
      }
    } catch {
      // The hook retains the snapshot and exposes the retryable error.
    }
  };
  useLayoutEffect(() => {
    if (!scrollAfterApplyRef.current) return;
    scrollAfterApplyRef.current = false;
    const beginning = feedRef.current;
    if (!beginning) return;
    let viewport = beginning.parentElement;
    while (viewport) {
      const overflow = getComputedStyle(viewport).overflowY;
      if (
        /(auto|scroll)/.test(overflow) &&
        viewport.scrollHeight > viewport.clientHeight
      ) {
        viewport.scrollTop +=
          beginning.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top;
        return;
      }
      viewport = viewport.parentElement;
    }
    window.scrollTo({
      top: window.scrollY + beginning.getBoundingClientRect().top,
    });
  }, [appliedVersion]);
  const prefersReducedMotion = useReducedMotion();
  const isLoadingState =
    isLoading ||
    externalLoading ||
    (isCoding && userFilter === "mine" && !userIdentity?.userId);
  const itemName = isCoding ? "coding-session" : "conversation";
  const codingCollectionKey = [
    organizationId,
    projectId,
    serviceId ?? "",
    taskId ?? "",
    userFilter,
    userIdentity?.userId ?? "",
    activeOnly ? "active" : "all",
    limit,
  ].join("\u0000");
  const isReloading = isFetching && !isFetchingNextPage && items.length > 0;
  const presentation = useSessionFeedPresentation(
    items,
    search,
    sortBy,
    `${variant}\u0000${codingCollectionKey}\u0000${appliedVersion}`,
  );

  const visibleItems = presentation.items;
  const hasWaitingUpdates = hasPendingUpdates || presentation.hasPendingUpdates;
  const showUpdatesPill =
    hasWaitingUpdates || isApplyingUpdates || Boolean(error);
  const updatesAnnouncement = isApplyingUpdates
    ? "Loading updates…"
    : error
      ? "Updates could not be loaded. Try again."
      : hasWaitingUpdates
        ? "There is new content. Load it?"
        : "";

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !hasNextPage) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !isFetching && !isApplyingUpdates) {
          loadNextPage();
        }
      },
      { rootMargin: "300px 0px" },
    );
    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [hasNextPage, isFetching, isApplyingUpdates, loadNextPage]);

  return (
    <Stack
      ref={feedRef}
      data-testid={`paginated-${itemName}s-feed`}
      spacing={1.5}
    >
      {isCoding ? (
        <Stack
          alignItems="center"
          direction="row"
          spacing={2}
          sx={{ flexWrap: "wrap" }}
        >
          <FormControlLabel
            control={
              <Switch
                checked={activeOnly}
                onChange={(event) => {
                  const nextActiveOnly = event.target.checked;
                  setActiveOnly(nextActiveOnly);
                  try {
                    localStorage.setItem(
                      ACTIVE_ONLY_STORAGE_KEY,
                      String(nextActiveOnly),
                    );
                  } catch {
                    // localStorage unavailable
                  }
                }}
              />
            }
            label="Active only"
          />
          <AgentSessionUserFilter onChange={setUserFilter} value={userFilter} />
        </Stack>
      ) : null}
      {isCoding ? (
        <Box role="status" aria-live="polite" sx={visuallyHidden}>
          {updatesAnnouncement}
        </Box>
      ) : null}
      <Box
        sx={{
          position: "fixed",
          left: "50%",
          transform: "translateX(-50%)",
          bottom: {
            xs: `calc(${MOBILE_ACTIONS_CAPSULE_CLEARANCE}px + env(safe-area-inset-bottom) + 8px)`,
            md: 24,
          },
          zIndex: (theme) => theme.zIndex.speedDial,
          maxWidth: "calc(100vw - 32px)",
          pointerEvents: "none",
        }}
      >
        {showUpdatesPill ? (
          <Button
            data-testid="session-feed-apply-updates"
            disabled={isApplyingUpdates}
            onClick={() => {
              void handleApplyUpdates();
            }}
            variant="contained"
            sx={{
              pointerEvents: "auto",
              borderRadius: 999,
              px: 2.5,
              boxShadow: 4,
              whiteSpace: "nowrap",
              maxWidth: "100%",
            }}
          >
            {isApplyingUpdates
              ? "Applying updates…"
              : error
                ? "Retry updates"
                : isCoding
                  ? "Load updates"
                  : "Updates available"}
          </Button>
        ) : null}
      </Box>
      {error ? <Alert severity="error">{error.message}</Alert> : null}
      {deleteError ? (
        <Alert severity="error">{deleteError.message}</Alert>
      ) : null}
      {isLoadingState && items.length === 0 ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
          <CircularProgress size={24} />
        </Box>
      ) : visibleItems.length === 0 ? (
        <Box sx={{ color: "text.secondary", py: 3, textAlign: "center" }}>
          {emptyMessage ??
            (isCoding ? "No coding sessions found" : "No conversations found")}
        </Box>
      ) : (
        <Stack
          aria-busy={isReloading || isApplyingUpdates}
          data-testid={`${itemName}-results`}
          spacing={1.5}
          sx={{
            opacity: !isCoding && isReloading ? 0.5 : 1,
            ...(!isCoding && { transition: "opacity 200ms ease-in-out" }),
          }}
        >
          {visibleItems.map((item) => {
            const sessionListItem = (
              <AgentSessionListItem
                buildSessionPath={buildSessionPath}
                item={item}
                onDeleteSession={
                  onSessionDelete
                    ? () => handleDeleteSession(item.agentSession.id)
                    : undefined
                }
                onSessionNavigate={onSessionNavigate}
                projectId={projectId}
                variant={variant}
              />
            );

            return isCoding ? (
              <motion.div
                data-session-result-id={item.agentSession.id}
                key={item.agentSession.id}
                layout={prefersReducedMotion ? false : "position"}
                transition={{
                  layout: { duration: 0.2, ease: "easeInOut" },
                }}
              >
                {sessionListItem}
              </motion.div>
            ) : (
              <React.Fragment key={item.agentSession.id}>
                {sessionListItem}
              </React.Fragment>
            );
          })}
        </Stack>
      )}
      {hasNextPage ? (
        <Box
          aria-label={`Loading more ${
            isCoding ? "coding sessions" : "conversations"
          }`}
          ref={loadMoreSentinelRef}
          sx={{
            display: "flex",
            justifyContent: "center",
            minHeight: 24,
            py: 0.5,
          }}
        >
          {isFetchingNextPage ? <CircularProgress size={20} /> : null}
        </Box>
      ) : null}
    </Stack>
  );
};
