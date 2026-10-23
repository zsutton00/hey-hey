import { Stack } from "@mui/material";
import { useMemo, useRef } from "react";
import { type AgentSessionDto } from "../../api";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import { apiClient } from "../../clients/client.js";
import { LocalPromptType } from "../../api";
import type { RunCreatePayloadValidationWalkthrough } from "../../api";
import { AgentConversationView } from "./AgentConversationView";
import { LoadingPanel } from "./LoadingPanel";
import { LocalRuntimeUnavailableAlert } from "./LocalRuntimeUnavailableAlert";
import { useAgentRunLifecycle } from "./useAgentRunLifecycle";
import { useLaunchRunOrchestration } from "./useLaunchRunOrchestration";
import { SessionErrorAlert } from "./SessionErrorAlert";
import { useSurfaceCatalogNotice } from "./useSurfaceCatalogNotice";
import { useSurfaceSelection } from "./useSurfaceSelection";

// Stable per-surface id for the provider/model/effort triple. No picker UI on
// this surface, so the selection silently defaults from the catalog of the CLI on
// the session's machine.
const VALIDATION_SESSION_SURFACE_ID = "validation-session";

export interface ValidationSessionProps {
  organizationId: string;
  projectId: string;
  agentSession: AgentSessionDto;
  taskData: WorkItemResponseDto | null;
}

export const ValidationSession = ({
  organizationId,
  projectId,
  agentSession,
  taskData,
}: ValidationSessionProps) => {
  const conversationId = agentSession.conversationId;
  const agentSessionId = agentSession.id;

  const launch = useLaunchRunOrchestration({
    organizationId,
    apiClient,
    projectId,
    agentSessionId,
    ...(conversationId ? { conversationId } : {}),
  });

  const context = useMemo(
    () => ({
      projectId,
      taskId: taskData?.id ?? null,
      ...(taskData?.name ? { taskName: taskData.name } : {}),
    }),
    [projectId, taskData?.id, taskData?.name],
  );

  const capturedAt = useRef(new Date().toISOString());
  const contextMetadata = useMemo(
    () => ({
      capturedAt: capturedAt.current,
      organizationId,
      projectId,
      agentSessionId,
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
    }),
    [organizationId, projectId, agentSessionId],
  );

  // Silent catalog-default provider/model/reasoningEffort — no picker on this
  // surface, but all three are required on the start-run envelope. They exist
  // only once the session's CLI has reported its catalog.
  const catalogSource = useMemo(
    () =>
      agentSession.machineId
        ? { organizationId, projectId, machineId: agentSession.machineId }
        : null,
    [organizationId, projectId, agentSession.machineId],
  );
  const { selection } = useSurfaceSelection({
    surfaceId: VALIDATION_SESSION_SURFACE_ID,
    catalogSource,
    resetKey: null,
  });
  const catalogNotice = useSurfaceCatalogNotice(
    catalogSource,
    "validation-session",
  );

  // Turn-firing arm: the walkthrough's scope + in-scope entity are bound at
  // start-run from the session's validationLaunchContext (set by
  // useValidationLauncher); follow-up turns then post the validation_walkthrough
  // routing arm only.
  const startRunPayload = useMemo<
    RunCreatePayloadValidationWalkthrough | undefined
  >(() => {
    const ctx = agentSession.validationLaunchContext;
    if (!ctx) return undefined;
    return {
      entity: {
        entityType:
          ctx.scope === "plan_stage" ? ("TASK" as const) : ("TASK" as const),
        entityId: ctx.entityId,
      },
      scope: ctx.scope,
      entityId: ctx.entityId,
      promptType: "validation_walkthrough",
    };
  }, [agentSession.validationLaunchContext]);

  const lifecycle = useAgentRunLifecycle({
    apiClient,
    // The start-run needs the CLI's provider/model, so it waits for them.
    enabled: Boolean(conversationId) && selection !== null,
    organizationId,
    projectId,
    agentSessionId,
    agentSessionStatus: agentSession.status,
    agentSessionConversationId: conversationId,
    context,
    contextMetadata,
    ...(selection
      ? {
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort
            ? { reasoningEffort: selection.reasoningEffort }
            : {}),
        }
      : {}),
    ...(startRunPayload
      ? {
          promptType: LocalPromptType.ValidationWalkthrough,
          payload: startRunPayload,
        }
      : {}),
    launch,
  });

  if (!conversationId) {
    return <LoadingPanel label="Preparing validation session..." />;
  }

  if (catalogNotice) {
    return <>{catalogNotice}</>;
  }

  if (lifecycle.error) {
    return (
      <Stack spacing={2}>
        <SessionErrorAlert
          error={lifecycle.error}
          errorCode={lifecycle.errorCode}
          onRetry={lifecycle.retryInit}
        />
        <LocalRuntimeUnavailableAlert error={lifecycle.error} />
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <AgentConversationView
        organizationId={organizationId}
        projectId={projectId}
        agentSessionId={agentSessionId}
        conversationId={conversationId}
        onStopRun={lifecycle.stopRun}
        stoppingRun={lifecycle.stoppingRun}
      />
    </Stack>
  );
};
