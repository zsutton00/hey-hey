import React from "react";
import { Alert, Box, CircularProgress, Typography } from "@mui/material";
import { FeatureTreeConversationChat } from "@hey-hey/ui-common/components";
import {
  CanonicalPageBoundary,
  createCanonicalPageDescriptor,
  type CanonicalPageComposition,
  TrackingProvider,
} from "@hey-hey/ui-common/context";
import { useAgentSession, useProject } from "@hey-hey/ui-common/data";
import { compose } from "@hey-hey/ui-common/i18n";
import type { BreadcrumbItem } from "@hey-hey/ui-common/utils";
import { PageBreadcrumbs } from "../../components/Layout";
import { AgentSessionDiscussActionCapsule } from "./AgentSessionDiscussActionCapsule";
import { buildAgentSessionPresentation } from "./agentSessionPresentation";
import { useAcknowledgeAgentSessionOutputAttentionOnOpen } from "./useAcknowledgeAgentSessionOutputAttentionOnOpen";

export interface FeatureTreeConversationPageProps {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  preview?: boolean;
}

export const FeatureTreeConversationPage: React.FC<
  FeatureTreeConversationPageProps
> = ({ organizationId, projectId, agentSessionId, preview = false }) => {
  const { agentSession, error, isLoading, isFetched } = useAgentSession(
    organizationId || undefined,
    projectId,
    agentSessionId,
    { enabled: !!organizationId && !!agentSessionId },
  );
  useAcknowledgeAgentSessionOutputAttentionOnOpen({
    organizationId,
    projectId,
    agentSessionId,
    enabled: !preview && isFetched && !error && !!agentSession,
  });

  const { data: project } = useProject(organizationId, projectId ?? "", {
    enabled: !!organizationId && !!projectId,
    preferStale: true,
  });

  if (!projectId || !agentSessionId) {
    return <Alert severity="error">Missing required route parameters.</Alert>;
  }

  if (isLoading || !isFetched) {
    return (
      <Box display="flex" justifyContent="center" py={4} gap={2}>
        <CircularProgress size={24} />
        <Typography variant="body2" color="text.secondary">
          Loading conversation...
        </Typography>
      </Box>
    );
  }

  if (!agentSession) {
    return <Alert severity="warning">Conversation not found.</Alert>;
  }

  const items: BreadcrumbItem[] = [
    { label: "Projects", to: "/projects", type: "project" },
    {
      label: project?.name ?? compose("{{term.Project}}"),
      to: `/projects/${projectId}`,
      type: project?.name ? "project" : undefined,
    },
    { label: "Feature Tree Conversation", isCurrent: true },
  ];
  const pageComposition: CanonicalPageComposition = preview
    ? { kind: "observational" }
    : {
        kind: "canonical",
        descriptor: createCanonicalPageDescriptor(
          "agent_session",
          agentSession.id,
          null,
          buildAgentSessionPresentation(
            agentSession,
            undefined,
            undefined,
            agentSession.title,
          ),
        ),
      };

  return (
    <TrackingProvider
      context={{
        page: {
          name: preview
            ? "feature-tree-conversation-preview"
            : "feature-tree-conversation",
          path: preview
            ? `/projects/${projectId}/agent-sessions/${agentSession.id}/preview`
            : `/projects/${projectId}/agent-sessions/${agentSession.id}`,
          section: preview ? "preview" : "conversation",
        },
        workflow: {
          id: agentSession.id,
          name: "feature-tree-conversation",
        },
        ...(!preview
          ? {
              attentionEntity: {
                id: agentSession.id,
                type: "agent_session" as const,
                name: agentSession.title || "Agent Session",
                status: agentSession.status,
                projectId: agentSession.projectId,
              },
            }
          : {}),
      }}
    >
      <CanonicalPageBoundary composition={pageComposition}>
        {!preview && (
          <AgentSessionDiscussActionCapsule
            organizationId={organizationId}
            projectId={projectId}
            agentSession={agentSession}
          />
        )}
        {!preview && <PageBreadcrumbs sx={{ mb: 2 }} items={items} />}
        <FeatureTreeConversationChat
          organizationId={organizationId}
          projectId={projectId}
          agentSession={agentSession}
          scrollable={preview}
        />
      </CanonicalPageBoundary>
    </TrackingProvider>
  );
};
