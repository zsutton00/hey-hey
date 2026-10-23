import { AnimatedConditional, FadeIn } from "@hey-hey/ui-common/animations";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  Conversation,
  DISABLED_CONVERSATION_SCROLL_POLICY,
  determineMessageState,
  HeyHeyBranding,
  type OnboardingReplySubmission,
} from "@hey-hey/ui-common/components";
import { WebPathService } from "@hey-hey/ui-common";
import type { BreadcrumbItem } from "@hey-hey/ui-common/utils";
import {
  TrackingProvider,
  useDebugActions,
  useOrganization,
  usePageTracking,
} from "@hey-hey/ui-common/context";
import {
  ConversationStatus,
  ExtendedUIFieldType,
  ProjectStatus,
  AgentSessionType,
  type MessageResponseDto,
} from "@hey-hey/ui-common/api";
import {
  useAgentSessions,
  useConversation,
  useConversationByWorkflow,
  useConversationMessages,
  useProject,
  useSubmitOnboardingReply,
} from "@hey-hey/ui-common/data";
import { Box, useTheme } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import type { ConversationMessage } from "../../types/conversation";
import { PageBreadcrumbs } from "../../components/Layout";
import { OnboardingLoadingScreen } from "./components/Loading";
import { ProjectDetailsForm } from "./components/ProjectDetailsForm";

const ONBOARDING_CONVERSATION_STATUSES: ConversationStatus[] = [
  ConversationStatus.NotStarted,
  ConversationStatus.Started,
  ConversationStatus.InProgress,
  ConversationStatus.GeneratingResponse,
  ConversationStatus.Completed,
  ConversationStatus.Failed,
  ConversationStatus.Recoverable,
];

const hasRepositoryGroundingPrerequisites = (
  messages: readonly MessageResponseDto[] | null | undefined,
): boolean => {
  const pending = [...(messages ?? [])];
  while (pending.length > 0) {
    const message = pending.shift();
    if (!message) continue;

    const uiElements = (
      message.data as { uiElements?: Array<{ id?: string; type?: string }> }
    )?.uiElements;
    if (
      uiElements?.some(
        (element) =>
          element.id === "repository_grounding" ||
          element.type === ExtendedUIFieldType.RepositoryGrounding,
      )
    ) {
      return true;
    }

    pending.push(...(message.responses ?? []));
  }

  return false;
};

const isSelectedExistingWorkIntentAnswer = (answer: unknown): boolean =>
  answer === "yes" ||
  (typeof answer === "object" &&
    answer !== null &&
    !Array.isArray(answer) &&
    (answer as { choice?: unknown }).choice === "yes");

// Container component for data loading and orchestration
const OnboardingPageContent = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  // Read the active org from the app-wide OrganizationContext — the same source
  // every other page (and project creation) uses. The JWT's currentOrgId is a
  // stale snapshot from token-issue time and diverges once a multi-org user
  // switches orgs, which 404s freshly-created projects and bounces onboarding.
  const { currentOrganization } = useOrganization();
  const currentOrgId = currentOrganization?.id;
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams({
    isNew: "f",
  });
  const isNew = searchParams.get("isNew") === "t";
  const isExistingProjectImport = searchParams.get("entry") === "existing";
  const requestedConversationId =
    searchParams.get("conversationId") ?? undefined;

  // Add page tracking
  usePageTracking(
    "onboarding",
    projectId ? "project-onboarding" : "project-selection",
  );

  const {
    data: project,
    isLoading: isLoadingProject,
    isFetched: isFetchedProject,
    refetch: refetchProject,
  } = useProject(currentOrgId, projectId);

  const { mutate: submitOnboardingReply } = useSubmitOnboardingReply();

  // Use the new focused useConversationByCategory hook for simple category-based fetching
  const {
    data: activeOnboardingConversation,
    messages: onboardingMessages,
    isLoading: isLoadingConversation,
    error: conversationError,
  } = useConversationByWorkflow(currentOrgId, projectId, "onboarding", {
    enabled: !!project && !requestedConversationId, // Direct imports fetch by their authoritative conversation identity below.
    requireFirstMessage: !isExistingProjectImport,
    requireUiElements: !isExistingProjectImport,
    // Scope to this project's onboarding workflow so a COMPLETED conversation
    // can still be resumed while the project itself sits in ONBOARDING. Without
    // these the lookup falls back to the active-only endpoint and misses the
    // already-completed onboarding conversation.
    workflowAboutId: projectId,
    workflowAboutType: "project",
    statuses: ONBOARDING_CONVERSATION_STATUSES,
  });

  // Services Import navigates with the conversation identity returned by the
  // create endpoint. Fetch that conversation directly so a just-created import
  // cannot be lost behind the project conversation list's cache or propagation
  // delay, then fetch its canonical Messages separately for prerequisite
  // readiness and rendering.
  const {
    data: requestedOnboardingConversation,
    isLoading: isLoadingRequestedConversation,
    error: requestedConversationError,
  } = useConversation(
    currentOrgId,
    projectId,
    { conversationId: requestedConversationId ?? "" },
    {
      enabled: !!project && !!requestedConversationId,
    },
  );
  const {
    data: requestedOnboardingMessages,
    isLoading: isLoadingRequestedMessages,
    error: requestedMessagesError,
  } = useConversationMessages(
    currentOrgId,
    projectId,
    requestedOnboardingConversation?.id,
    { enabled: !!project && !!requestedOnboardingConversation?.id },
  );

  const resolvedOnboardingConversation = requestedConversationId
    ? requestedOnboardingConversation
    : activeOnboardingConversation;
  const resolvedConversationLoading = requestedConversationId
    ? isLoadingRequestedConversation || isLoadingRequestedMessages
    : isLoadingConversation;
  const resolvedConversationError = requestedConversationId
    ? requestedConversationError ?? requestedMessagesError
    : conversationError;
  const resolvedOnboardingMessages = requestedConversationId
    ? requestedOnboardingMessages
    : onboardingMessages;
  const importPrerequisitesReady = requestedConversationId
    ? hasRepositoryGroundingPrerequisites(resolvedOnboardingMessages)
    : true;

  const { agentSessions } = useAgentSessions(currentOrgId, projectId, {
    conversationId: resolvedOnboardingConversation?.id,
    type: AgentSessionType.Coding,
    enabled: !!project && !!resolvedOnboardingConversation?.id,
  });
  const resolvedAgentSession = agentSessions[0];

  const redirectToHelp = useCallback(() => {
    if (!projectId) return;
    navigate(`/projects/${projectId}?tab=help`, { replace: true });
  }, [navigate, projectId]);

  // ACTIVE is terminal for question-led onboarding. Do not make that redirect
  // depend on conversation recovery: activation can become observable before
  // the completed conversation is returned by the collection query. A direct
  // existing-work import remains available while it is in progress, then
  // converges here once its completed conversation is observable.
  useEffect(() => {
    const isCompletedDirectImport =
      isExistingProjectImport &&
      resolvedOnboardingConversation?.status === ConversationStatus.Completed;

    if (
      project?.status === ProjectStatus.Active &&
      (!isExistingProjectImport || isCompletedDirectImport)
    ) {
      redirectToHelp();
    }
  }, [
    isExistingProjectImport,
    project?.status,
    redirectToHelp,
    resolvedOnboardingConversation,
  ]);

  // Debug actions (won't re-render on debug data changes)
  const { setWorkflowId, setOrganizationId, setConversationMessages } =
    useDebugActions();

  // Stable workflowId state to prevent flickering
  const [stableWorkflowId, setStableWorkflowId] = useState<string | null>(null);

  // Update stable workflowId when we have a valid one
  useEffect(() => {
    const currentWorkflowId = resolvedOnboardingConversation?.workflowId;
    console.log("[Onboarding] useEffect triggered:", {
      conversationWorkflowId: resolvedOnboardingConversation?.workflowId,
      currentWorkflowId,
      stableWorkflowId,
      shouldUpdate: currentWorkflowId && currentWorkflowId !== stableWorkflowId,
    });
    if (currentWorkflowId && currentWorkflowId !== stableWorkflowId) {
      console.log("[Onboarding] Setting stableWorkflowId:", currentWorkflowId);
      setStableWorkflowId(currentWorkflowId);
      setWorkflowId(currentWorkflowId); // Update debug context
    }
  }, [
    activeOnboardingConversation?.workflowId,
    stableWorkflowId,
    setWorkflowId,
    resolvedOnboardingConversation?.workflowId,
  ]);

  // Update organization ID in debug context
  useEffect(() => {
    if (currentOrgId) {
      setOrganizationId(currentOrgId);
    }
  }, [currentOrgId, setOrganizationId]);

  // Update conversation messages in debug context - convert MessageResponseDto[] to ConversationMessage[]
  useEffect(() => {
    if (resolvedOnboardingMessages.length > 0) {
      const conversationMessages: ConversationMessage[] =
        resolvedOnboardingMessages.map((message) => ({
          message,
          state: determineMessageState(message),
          canEdit: false, // For debug purposes, messages are read-only
        }));
      setConversationMessages(conversationMessages);
    }
  }, [resolvedOnboardingMessages, setConversationMessages]);

  // WebSocket integration is handled automatically by the conversation system

  // Handle project loading error
  useEffect(() => {
    if (isFetchedProject && !isLoadingProject && !project && projectId) {
      console.error("Project not found, redirecting to projects");
      navigate("/projects", { replace: true });
    }
  }, [isFetchedProject, isLoadingProject, project, projectId, navigate]);

  // Handle conversation loading error
  useEffect(() => {
    if (resolvedConversationError) {
      console.error(
        "Failed to load onboarding conversation:",
        resolvedConversationError,
      );
    }
  }, [resolvedConversationError]);

  // Clear 'isNew' param once fully loaded
  useEffect(() => {
    if (
      isNew &&
      !isExistingProjectImport &&
      project &&
      resolvedOnboardingConversation
    ) {
      setSearchParams({}, { replace: true });
    }
  }, [
    isExistingProjectImport,
    isNew,
    project,
    resolvedOnboardingConversation,
    setSearchParams,
  ]);

  const isLoading = isLoadingProject || resolvedConversationLoading;
  const isLoaded = Boolean(
    !isLoading &&
    project &&
    resolvedOnboardingConversation &&
    (!isExistingProjectImport || importPrerequisitesReady),
  );

  const existingImportBreadcrumbs: BreadcrumbItem[] | null =
    isExistingProjectImport && project
      ? [
          { label: "Projects", to: WebPathService.projects() },
          {
            label: project.name,
            to: WebPathService.project(project.id),
            type: "project",
            entityId: project.id,
          },
          { label: "Import existing work", isCurrent: true },
        ]
      : null;

  const handleSubmitOnboardingReply = useCallback(
    async (submission: OnboardingReplySubmission): Promise<void> => {
      const conversationId = resolvedOnboardingConversation?.id;
      if (!project || !projectId || !conversationId) {
        throw new Error(
          "The onboarding reply cannot be submitted before the project conversation is ready.",
        );
      }

      const shouldRedirectAfterExistingWorkSelection =
        isSelectedExistingWorkIntentAnswer(
          submission.answers.repository_grounding_intent,
        );

      await submitOnboardingReply({
        organizationId: project.organizationId,
        projectId,
        conversationId,
        ...submission,
      });

      if (shouldRedirectAfterExistingWorkSelection) {
        const activatedProject = await refetchProject();
        if (activatedProject?.status !== ProjectStatus.Active) {
          throw new Error(
            "The existing-work choice was accepted, but the project did not become active.",
          );
        }
        redirectToHelp();
      }
    },
    [
      project,
      projectId,
      refetchProject,
      redirectToHelp,
      resolvedOnboardingConversation?.id,
      submitOnboardingReply,
    ],
  );

  if (project?.status === ProjectStatus.Active && !isExistingProjectImport) {
    return null;
  }

  // Debug logging removed to prevent re-render cycles
  return (
    <Box sx={{ px: { xs: 2, sm: 4, md: 6 }, py: 3 }}>
      {existingImportBreadcrumbs ? (
        <PageBreadcrumbs sx={{ mb: 2 }} items={existingImportBreadcrumbs} />
      ) : null}
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

      <AnimatedConditional show={!isLoaded} animationType="fade">
        <OnboardingLoadingScreen
          isNew={isNew}
          loadingTextConfig={[
            { text: "Initializing Project...", delay: 300 },
            { text: "Loading project...", delay: 500 },
          ]}
        />
      </AnimatedConditional>

      <AnimatedConditional
        show={!!isLoaded}
        animationType="fade"
        duration="slow"
      >
        {isLoaded && resolvedOnboardingConversation && project && (
          <FadeIn delay={0.26} duration="slow">
            <ProjectDetailsForm
              project={project}
              organizationId={currentOrgId!}
            />
            <Conversation
              animationType="minimal"
              navigationOrientation="vertical"
              conversation={resolvedOnboardingConversation}
              project={project}
              agentSessionId={resolvedAgentSession?.id}
              agentSessionCurrentState={resolvedAgentSession?.currentState}
              scrollPolicy={DISABLED_CONVERSATION_SCROLL_POLICY}
              stepCount={-1}
              showNavigation
              onSubmitOnboardingReply={handleSubmitOnboardingReply}
            />
          </FadeIn>
        )}
      </AnimatedConditional>
    </Box>
  );
};

// Wrap the page with TrackingProvider for onboarding-specific context
const OnboardingPage = () => {
  return (
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
      <OnboardingPageContent />
    </TrackingProvider>
  );
};

export default OnboardingPage;
