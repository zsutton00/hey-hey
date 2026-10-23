import React, { useCallback, useMemo, useState } from "react";
import {
  AgentSessionOutputAttentionState,
  type AgentSessionDto,
  type EntityType,
} from "../../api";
import { usePathService } from "../../contexts";
import { useAgentSessions } from "../../data/hooks/useAgentSessions";
import { useConversationPhases } from "../../data/hooks/useConversationPhase";
import { useUserIdentity } from "../../hooks/useUserIdentity";
import { EntityGrid, EntityListItem, agentSessionAdapter } from "../Entity";
import { ConversationPhaseIndicator } from "../Conversation/Components/ConversationPhaseIndicator";
import { AgentSessionCurrentStateIndicator } from "../AgentSession/AgentSessionCurrentStateIndicator";
import { AgentSessionOutputAttentionIndicator } from "../AgentSession/AgentSessionOutputAttentionIndicator";
import {
  getAgentSessionRowSignalPresentation,
  type AgentSessionRowLifecycleSignal,
} from "../AgentSession/agentSessionCurrentStatePresentation";
import {
  AgentSessionUserFilter,
  type AgentSessionUserFilterValue,
} from "./AgentSessionUserFilter";

const renderLifecycleSignal = (
  signal: AgentSessionRowLifecycleSignal,
): React.ReactNode => {
  switch (signal.kind) {
    case "currentState":
      return (
        <AgentSessionCurrentStateIndicator
          currentState={signal.currentState}
          presentation="icon"
        />
      );
    case "conversationPhase":
      return <ConversationPhaseIndicator phase={signal.phase} />;
    case "none":
      return undefined;
  }
};

export interface AgentSessionsListProps {
  organizationId: string;
  projectId: string;
  userId?: string;
  conversationId?: string;
  entityType?: EntityType;
  entityId?: string;
  serviceId?: string;
  loading?: boolean;
  emptyMessage?: string;
  search?: string;
  sortBy?: string;
  displayMode?: "default" | "minimal";
  onSessionClick?: (session: AgentSessionDto) => void;
  onSessionDeleted?: (sessionId: string) => void;
}

export const AgentSessionsList: React.FC<AgentSessionsListProps> = ({
  organizationId,
  projectId,
  userId,
  conversationId,
  entityType,
  entityId,
  serviceId,
  loading: externalLoading = false,
  emptyMessage = "No agent sessions found",
  search = "",
  sortBy = "created-desc",
  displayMode = "default",
  onSessionClick,
  onSessionDeleted,
}) => {
  const pathService = usePathService();
  const userIdentity = useUserIdentity();
  const [userFilter, setUserFilter] =
    useState<AgentSessionUserFilterValue>("mine");
  const selectedUserId =
    userFilter === "mine" ? (userId ?? userIdentity?.userId) : undefined;

  const { agentSessions, outputAttentionById, isLoading, remove } = useAgentSessions(
    organizationId,
    projectId,
    {
      enabled: userFilter === "all" || Boolean(selectedUserId),
      userId: selectedUserId,
      conversationId,
      entityType,
      entityId,
      serviceId,
      includeOutputAttention: true,
    }
  );

  const isLoadingState = isLoading || externalLoading;

  const handleDelete = useCallback(
    (sessionId: string) => {
      return async () => {
        try {
          await remove(sessionId, {
            onSuccess: () => {
              onSessionDeleted?.(sessionId);
            },
            onError: (error: Error) => {
              console.error("Failed to delete coding session:", error);
            },
          });
        } catch (error) {
          console.error("Delete failed:", error);
        }
      };
    },
    [remove, onSessionDeleted]
  );

  const filteredAndSortedSessions = useMemo(() => {
    let filtered = [...agentSessions];

    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter((session) => {
        const title = (session.title || "").toLowerCase();
        const userName = session.user?.name?.toLowerCase() || "";
        const serviceName = session.service?.name?.toLowerCase() || "";
        return (
          title.includes(searchLower) ||
          userName.includes(searchLower) ||
          serviceName.includes(searchLower)
        );
      });
    }

    filtered.sort((a, b) => {
      switch (sortBy) {
        case "created-asc":
          return (
            new Date(a.sessionDate).getTime() -
            new Date(b.sessionDate).getTime()
          );
        case "created-desc":
          return (
            new Date(b.sessionDate).getTime() -
            new Date(a.sessionDate).getTime()
          );
        case "name-asc":
          return (a.title || "").localeCompare(b.title || "");
        case "name-desc":
          return (b.title || "").localeCompare(a.title || "");
        default:
          return (
            new Date(b.sessionDate).getTime() -
            new Date(a.sessionDate).getTime()
          );
      }
    });

    return filtered;
  }, [agentSessions, search, sortBy]);
  const visibleConversationIds = useMemo(
    () =>
      filteredAndSortedSessions.flatMap((session) =>
        session.conversationId ? [session.conversationId] : [],
      ),
    [filteredAndSortedSessions],
  );
  const conversationPhaseById = useConversationPhases(visibleConversationIds);

  return (
    <>
      <AgentSessionUserFilter
        onChange={setUserFilter}
        value={userFilter}
      />
      <EntityGrid
        items={filteredAndSortedSessions}
        loading={
          isLoadingState ||
          (userFilter === "mine" && !userIdentity?.userId)
        }
        renderItem={(session) => {
          const props = agentSessionAdapter.toEntityListItemProps(session, {
            projectId,
            pathService,
          });
          const sessionItemProps =
            displayMode === "minimal"
              ? {
                  ...props,
                  description: undefined,
                  tags: undefined,
                  metadata: undefined,
                }
              : props;
          const messageReady =
            outputAttentionById[session.id]?.state ===
            AgentSessionOutputAttentionState.MessageReady;
          const conversationPhase = session.conversationId
            ? conversationPhaseById[session.conversationId]?.phase
            : undefined;
          const rowSignals = getAgentSessionRowSignalPresentation(
            session.currentState,
            messageReady,
            conversationPhase,
          );

          const handleClick = onSessionClick
            ? (event: React.MouseEvent<HTMLElement>) => {
                if (!props.href) {
                  event.preventDefault();
                }
                onSessionClick(session);
              }
            : undefined;

          return (
            <EntityListItem
              {...sessionItemProps}
              conversationId={undefined}
              leadingContent={renderLifecycleSignal(rowSignals.lifecycle)}
              attentionContent={
                rowSignals.showMessageReadyIcon ? (
                  <AgentSessionOutputAttentionIndicator
                    state={AgentSessionOutputAttentionState.MessageReady}
                  />
                ) : undefined
              }
              displayMode={displayMode}
              onClick={handleClick}
              onDelete={handleDelete(session.id)}
            />
          );
        }}
        keyExtractor={(session) => session.id}
        emptyMessage={emptyMessage}
        skeletonHeight={displayMode === "minimal" ? 72 : 120}
      />
    </>
  );
};
