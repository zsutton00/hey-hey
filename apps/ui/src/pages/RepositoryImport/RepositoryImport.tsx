import {
  Conversation,
  DISABLED_CONVERSATION_SCROLL_POLICY,
  useConversationMessageSubmitter,
  type RepositoryImportReplySubmission,
} from "@hey-hey/ui-common/components";
import {
  TrackingProvider,
  useOrganization,
  usePageTracking,
} from "@hey-hey/ui-common/context";
import { AgentSessionType, ConversationStatus } from "@hey-hey/ui-common/api";
import {
  useAgentSessions,
  useConversation,
  useConversationByWorkflow,
  useProject,
  useSubmitRepositoryImportReply,
} from "@hey-hey/ui-common/data";
import { WebPathService } from "@hey-hey/ui-common";
import type { BreadcrumbItem } from "@hey-hey/ui-common/utils";
import { Alert, Box, CircularProgress, Typography } from "@mui/material";
import { useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { PageBreadcrumbs } from "../../components/Layout";
import { ProjectDetailsForm } from "../Onboarding/components/ProjectDetailsForm";

const REPOSITORY_IMPORT_CONVERSATION_STATUSES: ConversationStatus[] = [
  ConversationStatus.NotStarted,
  ConversationStatus.Started,
  ConversationStatus.InProgress,
  ConversationStatus.GeneratingResponse,
  ConversationStatus.Completed,
  ConversationStatus.Failed,
  ConversationStatus.Recoverable,
];

const RepositoryImportPageContent = () => {
  const { currentOrganization } = useOrganization();
  const currentOrgId = currentOrganization?.id;
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const requestedConversationId =
    searchParams.get("conversationId") ?? undefined;

  usePageTracking("repository-import", "project-repository-import");

  const {
    data: project,
    isLoading: isLoadingProject,
    error: projectError,
  } = useProject(currentOrgId, projectId);
  const {
    data: activeImportConversation,
    isLoading: isLoadingActiveImport,
    error: activeImportError,
  } = useConversationByWorkflow(currentOrgId, projectId, "repository-import", {
    enabled: !!project && !requestedConversationId,
    requireFirstMessage: false,
    requireUiElements: false,
    workflowAboutId: projectId,
    workflowAboutType: "project",
    statuses: REPOSITORY_IMPORT_CONVERSATION_STATUSES,
  });
  const {
    data: requestedImportConversation,
    isLoading: isLoadingRequestedImport,
    error: requestedImportError,
  } = useConversation(
    currentOrgId,
    projectId,
    { conversationId: requestedConversationId ?? "" },
    {
      enabled: !!project && !!requestedConversationId,
    },
  );

  const conversation = requestedConversationId
    ? requestedImportConversation
    : activeImportConversation;
  const conversationError = requestedConversationId
    ? requestedImportError
    : activeImportError;
  const isLoadingConversation = requestedConversationId
    ? isLoadingRequestedImport
    : isLoadingActiveImport;

  const { agentSessions } = useAgentSessions(currentOrgId, projectId, {
    conversationId: conversation?.id,
    type: AgentSessionType.Coding,
    enabled: !!project && !!conversation?.id,
  });
  const { mutate: submitRepositoryImportReply } =
    useSubmitRepositoryImportReply();
  const submitEnrichmentReply = useConversationMessageSubmitter({
    organizationId: currentOrgId,
    projectId,
    agentSessionId: agentSessions[0]?.id,
    conversationId: conversation?.id,
  });

  const handleSubmitRepositoryImportReply = useCallback(
    async (submission: RepositoryImportReplySubmission): Promise<void> => {
      if (!project || !projectId || !conversation?.id) {
        throw new Error(
          "The repository import reply cannot be submitted before the import conversation is ready.",
        );
      }

      await submitRepositoryImportReply({
        organizationId: project.organizationId,
        projectId,
        conversationId: conversation.id,
        ...submission,
      });
    },
    [conversation?.id, project, projectId, submitRepositoryImportReply],
  );

  if (isLoadingProject || isLoadingConversation) {
    return (
      <Box
        sx={{
          display: "flex",
          minHeight: "50vh",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
        }}
      >
        <CircularProgress />
        <Typography color="text.secondary">
          Loading repository import...
        </Typography>
      </Box>
    );
  }

  if (projectError || conversationError) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          {projectError?.message ??
            conversationError?.message ??
            "Failed to load repository import"}
        </Alert>
      </Box>
    );
  }

  if (!project || !conversation) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          No repository import conversation is available for this project.
        </Alert>
      </Box>
    );
  }

  const breadcrumbs: BreadcrumbItem[] = [
    { label: "Projects", to: WebPathService.projects() },
    {
      label: project.name,
      to: WebPathService.project(project.id),
      type: "project",
      entityId: project.id,
    },
    { label: "Import existing work", isCurrent: true },
  ];

  return (
    <Box sx={{ px: { xs: 2, sm: 4, md: 6 }, py: 3 }}>
      <PageBreadcrumbs sx={{ mb: 2 }} items={breadcrumbs} />
      <ProjectDetailsForm
        project={project}
        organizationId={project.organizationId}
      />
      <Conversation
        animationType="minimal"
        navigationOrientation="vertical"
        conversation={conversation}
        project={project}
        agentSessionId={agentSessions[0]?.id}
        agentSessionCurrentState={agentSessions[0]?.currentState}
        showAgentSessionCurrentStateIndicator
        scrollPolicy={DISABLED_CONVERSATION_SCROLL_POLICY}
        stepCount={-1}
        showNavigation
        onSubmitRepositoryImportReply={handleSubmitRepositoryImportReply}
        onDirectTrigger={submitEnrichmentReply}
      />
    </Box>
  );
};

const RepositoryImportPage = () => (
  <TrackingProvider
    context={{
      page: {
        name: "repository-import",
        path: window.location.pathname,
        section: "services",
      },
    }}
    enabled
  >
    <RepositoryImportPageContent />
  </TrackingProvider>
);

export default RepositoryImportPage;
