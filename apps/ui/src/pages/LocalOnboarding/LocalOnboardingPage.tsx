import { useCallback, useEffect } from "react";
import { Box, useTheme } from "@mui/material";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  AgentSessionStatus,
  AgentSessionType,
  ConversationStatus,
  ProjectStatus,
} from "@hey-hey/ui-common/api";
import { HeyHeyBranding } from "@hey-hey/ui-common/components";
import {
  TrackingProvider,
  useOrganization,
  usePageTracking,
} from "@hey-hey/ui-common/context";
import {
  useAgentSessions,
  useConversationByWorkflow,
  useProject,
} from "@hey-hey/ui-common/data";

import { OnboardingLoadingScreen } from "../Onboarding/components/Loading";
import { LocalOnboardingReadError } from "./LocalOnboardingReadError";
import { LocalOnboardingSession } from "./LocalOnboardingSession";

const ONBOARDING_STATUSES = Object.values(ConversationStatus);

/**
 * Local project onboarding. It shows the session started on `/welcome` and
 * never chooses a runtime or starts a session itself; without a started
 * session it sends the person back to `/welcome`.
 */
function LocalOnboardingPageContent() {
  const navigate = useNavigate();
  const theme = useTheme();
  const { projectId } = useParams<{ projectId: string }>();
  const { currentOrganization } = useOrganization();
  const organizationId = currentOrganization?.id;
  usePageTracking("onboarding", "project-onboarding");

  const {
    data: project,
    isFetched: isFetchedProject,
    refetch: refetchProject,
  } = useProject(organizationId, projectId);
  const conversation = useConversationByWorkflow(
    organizationId,
    projectId,
    "onboarding",
    {
      enabled: !!project,
      requireFirstMessage: true,
      requireUiElements: true,
      workflowAboutId: projectId,
      workflowAboutType: "project",
      statuses: ONBOARDING_STATUSES,
    },
  );
  const sessions = useAgentSessions(organizationId, projectId, {
    conversationId: conversation.data?.id,
    type: AgentSessionType.Coding,
    enabled: !!conversation.data?.id,
  });
  const session = sessions.agentSessions[0];

  const redirectToHelp = useCallback(() => {
    navigate(`/projects/${projectId}?tab=help`, { replace: true });
  }, [navigate, projectId]);

  useEffect(() => {
    if (project?.status === ProjectStatus.Active) {
      redirectToHelp();
    }
  }, [project?.status, redirectToHelp]);

  const handleActivated = useCallback(async () => {
    const activated = await refetchProject();
    if (activated?.status !== ProjectStatus.Active) {
      throw new Error(
        "The existing-work choice was accepted, but the project did not become active.",
      );
    }
    redirectToHelp();
  }, [redirectToHelp, refetchProject]);

  const refetchConversation = conversation.refetch;
  const refetchSessions = sessions.refetch;
  const conversationFailed = !!conversation.error;
  const handleRetryRead = useCallback(async () => {
    if (conversationFailed) {
      await refetchConversation();
      return;
    }
    await refetchSessions();
  }, [conversationFailed, refetchConversation, refetchSessions]);

  if (isFetchedProject && !project) {
    return <Navigate to="/projects" replace />;
  }
  if (project?.status === ProjectStatus.Active) {
    return null;
  }

  const readError = conversation.error ?? sessions.error;
  const sessionsSettled =
    !!conversation.data && !sessions.isLoading && !sessions.error;
  if (
    project &&
    sessionsSettled &&
    (!session || session.status === AgentSessionStatus.NotStarted)
  ) {
    return (
      <Navigate
        to={`/welcome?projectId=${encodeURIComponent(project.id)}`}
        replace
      />
    );
  }

  return (
    <Box
      data-testid="local-onboarding-page"
      sx={{ px: { xs: 2, sm: 4, md: 6 }, py: 3 }}
    >
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          mb: 3,
          "& > .MuiTypography-root": {
            color:
              theme.palette.mode === "dark" ? "common.white" : "text.primary",
          },
        }}
      >
        <HeyHeyBranding variant="header" />
      </Box>
      {readError ? (
        <LocalOnboardingReadError
          message={readError.message}
          onRetry={handleRetryRead}
        />
      ) : project && conversation.data && session ? (
        <LocalOnboardingSession
          project={project}
          conversation={conversation.data}
          session={session}
          onActivated={handleActivated}
        />
      ) : (
        <OnboardingLoadingScreen
          isNew={false}
          loadingTextConfig={[{ text: "Loading project...", delay: 300 }]}
        />
      )}
    </Box>
  );
}

const LocalOnboardingPage = () => (
  <TrackingProvider
    context={{
      page: {
        name: "onboarding",
        path: window.location.pathname,
        section: "project-setup",
      },
    }}
    enabled={true}
  >
    <LocalOnboardingPageContent />
  </TrackingProvider>
);

export default LocalOnboardingPage;
