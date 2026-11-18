import { useEffect, useRef, useState } from "react";
import { AgentSessionType, type AgentSessionDto } from "../../api";
import { useConversation } from "../../data/hooks/useConversation";
import { useConversationMessages } from "../../data/hooks/useConversationMessages";
import { useProject } from "../../data/hooks/useProject";
import { useResolveWorkItemCoordinator } from "../../data/hooks/useResolveWorkItemCoordinator";
import logger from "../../utils/logger";

export interface UseTaskMonitorConversationOptions {
  organizationId: string;
  projectId: string;
  session: AgentSessionDto | null;
}

export const useTaskMonitorConversation = ({
  organizationId,
  projectId,
  session,
}: UseTaskMonitorConversationOptions) => {
  const hasConversation = Boolean(session?.conversationId);
  const projectQuery = useProject(organizationId, projectId, {
    enabled: hasConversation,
    refetchOnMount: true,
  });
  const conversationQuery = useConversation(
    organizationId,
    projectId,
    { conversationId: session?.conversationId ?? "" },
    {
      enabled: Boolean(session?.conversationId),
    },
  );
  const messagesQuery = useConversationMessages(
    organizationId,
    projectId,
    session?.conversationId ?? undefined,
    { enabled: hasConversation, refetchOnWindowFocus: true },
  );
  return {
    conversation: conversationQuery.data,
    messages: messagesQuery.data,
    project: projectQuery.data,
    loading:
      hasConversation &&
      (conversationQuery.isLoading ||
        messagesQuery.isLoading ||
        projectQuery.isLoading),
    fetched:
      !hasConversation ||
      (conversationQuery.isFetched &&
        messagesQuery.isFetched &&
        projectQuery.isFetched),
    errorMessage:
      hasConversation &&
      (conversationQuery.error || messagesQuery.error || projectQuery.error)
        ? "The canonical conversation could not be loaded."
        : null,
  };
};

export interface UseTaskMonitorCoordinatorConversationOptions {
  organizationId: string;
  projectId: string;
  monitorId: string;
  sessionDate: string | null;
}

export const useTaskMonitorCoordinatorConversation = ({
  organizationId,
  projectId,
  monitorId,
  sessionDate,
}: UseTaskMonitorCoordinatorConversationOptions) => {
  const [session, setSession] = useState<AgentSessionDto | null>(null);
  const requestedMonitorId = useRef<string | null>(null);
  const coordinator = useResolveWorkItemCoordinator({
    onSuccess: ({ agentSession }) => setSession(agentSession),
  });

  const resolveCoordinator = coordinator.mutate;
  useEffect(() => {
    if (
      !organizationId ||
      !projectId ||
      !monitorId ||
      !sessionDate ||
      requestedMonitorId.current === monitorId
    ) {
      return;
    }
    requestedMonitorId.current = monitorId;
    void resolveCoordinator({
      organizationId,
      projectId,
      body: {
        type: AgentSessionType.TaskMonitor,
        workItemType: "TASK_MONITOR",
        workItemId: monitorId,
        sessionDate,
      },
    }).catch((error: unknown) => {
      logger.warn("data_hooks", "Coordinator resolution failed", {
        code: "TASK_MONITOR_COORDINATOR_RESOLUTION_FAILED",
        monitorId,
        cause: error instanceof Error ? error.message : String(error),
      });
    });
  }, [resolveCoordinator, monitorId, organizationId, projectId, sessionDate]);

  const conversation = useTaskMonitorConversation({
    organizationId,
    projectId,
    session,
  });

  return {
    ...conversation,
    session,
    loading: coordinator.isPending || conversation.loading,
    fetched: !sessionDate
      ? true
      : coordinator.isSuccess
        ? conversation.fetched
        : coordinator.isError,
    errorMessage: !sessionDate
      ? "The Task Monitor coordinator cannot be resolved without its session date."
      : coordinator.error
        ? `Monitor activity could not be loaded. ${coordinator.error.message}`
        : conversation.errorMessage,
  };
};
