import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import React, { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Box, CircularProgress, Typography } from "@mui/material";
import { AgentSessionType, EntityType } from "@hey-hey/ui-common/api";
import { useAgentSession, useWorkItem, isTask } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { buildEntityConversationPath } from "./entityConversationRoute";

/**
 * Resolves an agent session by its ID and redirects to the appropriate view
 * based on the session type.
 *
 * - CODING → standard agent-session page
 * - ENTITY_CONVERSATION → entity-conversation route with entity params
 * - TASK_REFINING → task or feature page with ?editing=true
 * - DESIGN_DOC_REFINING → design doc page with ?editing=true
 * - PROPOSAL_REFINING (Agent fix) → its conversation, like other session types
 * - DAILY_SESSION → project page with the Daily Session view selected
 * - PROJECT_CONVERSATION → project conversation session page
 */
export const AgentSessionByIdResolver: React.FC = () => {
  const { projectId, agentSessionId } = useParams<{
    projectId: string;
    agentSessionId: string;
  }>();
  const navigate = useNavigate();
  const organizationId = useUserIdentity()?.currentOrgId ?? "";

  const {
    agentSession,
    error: sessionError,
    isFetched: sessionFetched,
    isLoading: sessionLoading,
  } = useAgentSession(organizationId || undefined, projectId, agentSessionId, {
    enabled: !!organizationId && !!agentSessionId,
  });

  const refinerTaskId =
    agentSession?.type === AgentSessionType.TaskRefining &&
    agentSession.entityType === EntityType.Task
      ? agentSession.entityId
      : undefined;

  const needsTaskLookup = !!refinerTaskId;

  const taskQuery = useWorkItem(
    organizationId,
    "task",
    refinerTaskId ?? "__noop__",
    {
      projectId,
      enabled: !!organizationId && !!projectId && needsTaskLookup,
    },
  );

  const taskData =
    taskQuery.workItem && isTask(taskQuery.workItem)
      ? taskQuery.workItem
      : null;

  const isLoading =
    sessionLoading ||
    !sessionFetched ||
    (needsTaskLookup && (taskQuery.isLoading || !taskQuery.isFetched));

  useEffect(() => {
    if (isLoading || !agentSession || !projectId) {
      return;
    }

    const sessionType = agentSession.type;
    const base = `/projects/${projectId}/agent-sessions/${agentSession.id}`;

    switch (sessionType) {
      case AgentSessionType.Coding: {
        navigate(base, { replace: true });
        return;
      }

      case AgentSessionType.EntityConversation: {
        navigate(
          buildEntityConversationPath(projectId, {
            agentSessionId: agentSession.id,
            conversationId: agentSession.conversationId,
            entityId: agentSession.entityId,
            entityType: agentSession.entityType,
          }) ?? base,
          { replace: true },
        );
        return;
      }

      case AgentSessionType.TaskRefining: {
        const taskId =
          agentSession.entityType === EntityType.Task
            ? agentSession.entityId
            : undefined;
        if (taskId) {
          const isFeature = taskData?.type === WORK_ITEM_TYPE_KEYS.Feature;
          const entityPath = isFeature
            ? `/projects/${projectId}/features/${taskId}`
            : `/projects/${projectId}/tasks/${taskId}`;
          navigate(`${entityPath}?editing=true`, { replace: true });
        } else {
          navigate(`/projects/${projectId}`, { replace: true });
        }
        return;
      }

      case AgentSessionType.DesignDocRefining: {
        const designDocId =
          agentSession.entityType === EntityType.DesignDoc
            ? agentSession.entityId
            : undefined;
        if (designDocId) {
          navigate(
            `/projects/${projectId}/design-docs/${designDocId}?editing=true`,
            { replace: true },
          );
        } else {
          navigate(`/projects/${projectId}`, { replace: true });
        }
        return;
      }

      case AgentSessionType.DailySession: {
        navigate(`/projects/${projectId}?tab=project&view=daily-session`, {
          replace: true,
        });
        return;
      }

      case AgentSessionType.ProjectConversation: {
        navigate(`/projects/${projectId}/agent-sessions/${agentSession.id}`, {
          replace: true,
        });
        return;
      }

      default: {
        // Unknown type — fall back to conversation resolver if possible
        if (agentSession.conversationId) {
          navigate(
            `/projects/${projectId}/resolve-agent-session/${agentSession.conversationId}`,
            { replace: true },
          );
        } else {
          navigate(base, { replace: true });
        }
      }
    }
  }, [isLoading, agentSession, projectId, taskData, navigate]);

  if (isLoading) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        py={8}
        gap={2}
      >
        <CircularProgress size={28} />
        <Typography variant="body2" color="text.secondary">
          Loading agent session...
        </Typography>
      </Box>
    );
  }

  if (sessionError) {
    return (
      <Alert severity="error">
        {sessionError.message || "Unable to load agent session."}
      </Alert>
    );
  }

  if (!agentSession) {
    return <Alert severity="error">Unable to find agent session.</Alert>;
  }

  return null;
};
