import React from "react";
import { useParams } from "react-router-dom";
import { CircularProgress, Box, Alert } from "@mui/material";
import {
  EntityConversationChat,
  OpenBrowserCapsuleAction,
  RunBrowserProvider,
  type ConversationScrollPolicy,
} from "@hey-hey/ui-common/components";
import {
  useAgentSession,
  useFeatureLookup,
  useFullEntityContext,
  useProject,
  useTaskHierarchy,
} from "@hey-hey/ui-common/data";
import { EntityType } from "@hey-hey/ui-common/api";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { compose } from "@hey-hey/ui-common/i18n";
import {
  CanonicalPageBoundary,
  TrackingProvider,
} from "@hey-hey/ui-common/context";
import {
  buildDefaultSurfaceSelection,
  ENTITY_CONVERSATION_SURFACE_ID,
  readSurfaceSelection,
  resolveEntityConversationRuntimeSelection,
} from "@hey-hey/ui-common/components";
import { WebPathService } from "@hey-hey/ui-common/services";
import type { BreadcrumbItem } from "@hey-hey/ui-common/utils";
import { PageBreadcrumbs } from "../../components/Layout";
import { useFeatureAncestors } from "../../components/useFeatureAncestors";
import { useSuppressLayoutMainBottomSpacing } from "../../components/Layout/LayoutMainBottomSpacingContext";
import { useLayoutMainScrollOwner } from "../../components/Layout/LayoutMainScrollOwnerContext";
import { AgentSessionDiscussActionCapsule } from "./AgentSessionDiscussActionCapsule";
import { buildEntityConversationPageComposition } from "./entityConversationPageComposition";
import { buildAgentSessionPresentation } from "./agentSessionPresentation";
import { useAcknowledgeAgentSessionOutputAttentionOnOpen } from "./useAcknowledgeAgentSessionOutputAttentionOnOpen";

function normalizeWorkflowAboutType(aboutType: string): string {
  return aboutType.toLowerCase().replace(/_/g, "-");
}

function entityPathFor(
  projectId: string,
  entityId: string,
  aboutType: string,
): string | null {
  switch (aboutType) {
    case "task":
      return WebPathService.task({ projectId, taskId: entityId });
    case "initiative":
      return WebPathService.initiativeDetail({
        projectId,
        initiativeId: entityId,
      });
    case "plan":
      return WebPathService.plan({ projectId, planId: entityId });
    case "design-doc":
      return WebPathService.designDoc({ projectId, designDocId: entityId });
    default:
      return null;
  }
}

export const EntityConversationPage: React.FC = () => {
  const {
    projectId,
    agentSessionId,
    conversationId: routeConversationId,
  } = useParams<{
    projectId: string;
    agentSessionId: string;
    conversationId: string;
  }>();
  const organizationId = useUserIdentity()?.currentOrgId ?? "";
  useSuppressLayoutMainBottomSpacing(true, { suppressMainScroll: false });
  const layoutMainScrollOwner = useLayoutMainScrollOwner();
  const mainContentRef = layoutMainScrollOwner?.mainContentRef ?? null;
  const entityConversationScrollPolicy =
    React.useMemo<ConversationScrollPolicy>(
      () =>
        mainContentRef
          ? { mode: "owned", ownerRef: mainContentRef }
          : { mode: "disabled" },
      [mainContentRef],
    );

  const { agentSession, error, isFetched, isLoading } = useAgentSession(
    organizationId || undefined,
    projectId,
    agentSessionId,
  );
  useAcknowledgeAgentSessionOutputAttentionOnOpen({
    organizationId,
    projectId,
    agentSessionId,
    enabled: isFetched && !error && !!agentSession,
  });

  const { data: project } = useProject(organizationId, projectId ?? "", {
    enabled: !!organizationId && !!projectId,
    preferStale: true,
  });

  const aboutId = agentSession?.entityId ?? "";
  const aboutType = normalizeWorkflowAboutType(agentSession?.entityType ?? "");
  const entityTypeEnum = agentSession?.entityType ?? null;

  const { data: entityContext } = useFullEntityContext({
    organizationId,
    projectId: projectId ?? "",
    entityType: entityTypeEnum ?? EntityType.Task,
    entityId: aboutId,
    enabled: !!organizationId && !!projectId && !!aboutId && !!entityTypeEnum,
    includeFeatureHierarchy: true,
    includeProposals: false,
    includeAvailableMcpTools: false,
  });

  const runtimeSelection = React.useMemo(
    () =>
      agentSession
        ? resolveEntityConversationRuntimeSelection(
            agentSession,
            readSurfaceSelection(ENTITY_CONVERSATION_SURFACE_ID) ??
              buildDefaultSurfaceSelection(),
          )
        : buildDefaultSurfaceSelection(),
    [agentSession],
  );

  // The Run exists once the conversation does; before that the pencil on a
  // mockup is disabled, like the Open browser button.
  const runBrowserRunId =
    (routeConversationId ?? agentSession?.conversationId)
      ? (agentSession?.id ?? null)
      : null;
  const runBrowserMachineId = agentSession?.machineId ?? null;
  const runBrowserContext = React.useMemo(
    () => ({ runId: runBrowserRunId, sessionMachineId: runBrowserMachineId }),
    [runBrowserRunId, runBrowserMachineId],
  );

  // TASK subjects resolve their nearest feature from the cached hierarchy:
  // a feature subject from its own cached entry, any other task through its
  // hierarchy read. The entity-context read stays the fallback.
  const isTaskSubject = entityTypeEnum === EntityType.Task && !!aboutId;
  const featureLookup = useFeatureLookup(organizationId, projectId ?? "");
  const cachedSubjectFeature = isTaskSubject
    ? featureLookup.get(aboutId)
    : undefined;
  const { hierarchy: subjectHierarchy } = useTaskHierarchy(
    organizationId,
    projectId ?? "",
    aboutId,
    {
      enabled:
        isTaskSubject && !featureLookup.isLoading && !cachedSubjectFeature,
      includeAgentSessionCounts: false,
      includeDesignDocCounts: false,
    },
  );
  const { ancestors: taskFeatureAncestors } = useFeatureAncestors({
    organizationId,
    projectId: projectId ?? "",
    task: isTaskSubject
      ? (cachedSubjectFeature ?? subjectHierarchy?.task)
      : null,
    parent: cachedSubjectFeature ? null : subjectHierarchy?.parent,
    fallbackHierarchy: entityContext?.featureHierarchy,
  });

  const nearestAncestorFeature = isTaskSubject
    ? (taskFeatureAncestors.at(-1) ?? null)
    : (entityContext?.featureHierarchy
        ?.filter((f) => f.relationship === "ancestor")
        .sort(
          (a, b) =>
            (a.distance ?? Number.MAX_SAFE_INTEGER) -
            (b.distance ?? Number.MAX_SAFE_INTEGER),
        )[0] ?? null);

  if (isLoading || !isFetched) {
    return (
      <Box
        data-testid="entity-conversation-loading"
        display="flex"
        justifyContent="center"
        py={4}
      >
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (error || !agentSession) {
    return (
      <Alert severity="error">
        {error?.message ?? "Unable to load agent session."}
      </Alert>
    );
  }

  const entityPath =
    projectId && aboutId ? entityPathFor(projectId, aboutId, aboutType) : null;
  const canonicalConversationId =
    routeConversationId ?? agentSession.conversationId ?? "";
  const pageComposition = buildEntityConversationPageComposition({
    preview: false,
    agentSessionId: agentSession.id,
    entityType: aboutType,
    entityId: aboutId,
    presentation: buildAgentSessionPresentation(
      agentSession,
      undefined,
      {
        conversationId: canonicalConversationId,
        entityId: aboutId,
        entityType: aboutType,
      },
      agentSession.title === "Agent Session" ? undefined : agentSession.title,
      isTaskSubject
        ? (cachedSubjectFeature?.name ??
            subjectHierarchy?.task.name ??
            entityContext?.displayName)
        : undefined,
    ),
  });

  return (
    <TrackingProvider
      context={{
        page: {
          name: "entity-conversation",
          path: `/projects/${projectId}/agent-sessions/${agentSessionId}/entity-conversations/${canonicalConversationId}`,
          section: "conversation",
        },
        workflow: {
          id: agentSession.id,
          name: "entity-conversation",
        },
        attentionEntity: {
          id: agentSession.id,
          type: "agent_session",
          name: agentSession.title || "Agent Session",
          status: agentSession.status,
          projectId: agentSession.projectId,
        },
      }}
    >
      <RunBrowserProvider value={runBrowserContext}>
        <CanonicalPageBoundary composition={pageComposition}>
          <AgentSessionDiscussActionCapsule
            organizationId={organizationId}
            projectId={projectId ?? ""}
            agentSession={agentSession}
          />
          <OpenBrowserCapsuleAction
            runId={runBrowserContext.runId}
            sessionMachineId={runBrowserContext.sessionMachineId}
            order={35}
          />
          <Box data-testid="entity-conversation-page">
            <PageBreadcrumbs
              sx={{ mb: 2, flexShrink: 0 }}
              items={(() => {
                const items: BreadcrumbItem[] = [
                  { label: "Projects", to: "/projects" },
                  {
                    label: project?.name ?? compose("{{term.Project}}"),
                    to: `/projects/${projectId}`,
                    type: project?.name ? "project" : undefined,
                  },
                ];
                if (nearestAncestorFeature && projectId) {
                  items.push({
                    label: nearestAncestorFeature.name,
                    to: WebPathService.feature({
                      projectId,
                      featureId: nearestAncestorFeature.id,
                    }),
                    type: "feature",
                    entityId: nearestAncestorFeature.id,
                  });
                }
                if (entityContext?.displayName && entityPath) {
                  items.push({
                    label: entityContext.displayName,
                    to: entityPath,
                    type: aboutType,
                    entityId: aboutId,
                  });
                }
                items.push({ label: "Agent Session", isCurrent: true });
                return items;
              })()}
            />

            <EntityConversationChat
              organizationId={organizationId}
              projectId={projectId ?? ""}
              agentSession={agentSession}
              entityId={aboutId}
              entityType={aboutType}
              runtimeSelection={runtimeSelection}
              machineId={agentSession.machineId ?? ""}
              scrollPolicy={entityConversationScrollPolicy}
            />
          </Box>
        </CanonicalPageBoundary>
      </RunBrowserProvider>
    </TrackingProvider>
  );
};
