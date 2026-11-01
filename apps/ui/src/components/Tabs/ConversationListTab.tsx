import {
  useModalState,
  ModalWorkOwner,
} from "@hey-hey/ui-common/components/Modals";
import type {
  ConversationResponseDto,
  ConversationStatus,
} from "@hey-hey/ui-common/api";
import {
  ConversationStatus as ConversationStatusEnum,
  EntityType,
} from "@hey-hey/ui-common/api";
import {
  DiscussModal,
  EntityActionButton,
  NewConversationConfirmationDialog,
  type GraphConversationLaunchInput,
  useEntityConversationLauncher,
} from "@hey-hey/ui-common/components";
import {
  useConversations,
  useWebsocketSubscriptions,
} from "@hey-hey/ui-common/data";
import { TERMS } from "@hey-hey/ui-common/i18n";
import SearchIcon from "@mui/icons-material/Search";
import { Alert, Box, InputAdornment, Stack, TextField } from "@mui/material";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CardHeader } from "../CardHeader";
import type { WorkflowAboutType } from "./resolveWorkflowName";
import { ConversationArchiveList } from "./ConversationArchiveList";
import { TabContainer } from "./TabContainer";

export interface ConversationListTabProps {
  organizationId: string;
  projectId: string;
  conversationPathForId: (conversationId: string) => string;
  workflowName?: string;
  /** Name of the entity the tab sits on; titles untitled conversations. */
  entityName?: string;
  workflowAboutId?: string;
  workflowAboutType?: WorkflowAboutType;
  statuses?: ConversationStatus[];
  activeConversationId?: string | null;
  /** Null makes this an index of existing conversations only. */
  onCreateNewConversation?: ((draftText: string) => Promise<void>) | null;
  confirmBeforeNewConversation?: boolean;
}

const WORKFLOW_ABOUT_ENTITY_TYPES: Record<WorkflowAboutType, EntityType> = {
  task: EntityType.Task,
  initiative: EntityType.Initiative,
  plan: EntityType.Task,
  "plan-stage": EntityType.Task,
  "design-doc": EntityType.DesignDoc,
  proposal: EntityType.Proposal,
  "agent-session": EntityType.AgentSession,
  conversation: EntityType.Conversation,
  project: EntityType.Project,
  service: EntityType.Service,
};

const sortByUpdatedAt = (
  a: ConversationResponseDto,
  b: ConversationResponseDto,
): number => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

const SEARCH_DEBOUNCE_MS = 300;

const DEFAULT_STATUSES: ConversationStatus[] = [
  ConversationStatusEnum.Started,
  ConversationStatusEnum.InProgress,
  ConversationStatusEnum.GeneratingResponse,
  ConversationStatusEnum.Completed,
];

export const ConversationListTab: React.FC<ConversationListTabProps> = ({
  organizationId,
  projectId,
  conversationPathForId,
  entityName,
  workflowAboutId,
  workflowAboutType,
  statuses = DEFAULT_STATUSES,
  activeConversationId,
  onCreateNewConversation,
  confirmBeforeNewConversation = false,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [isDiscussOpen, setIsDiscussOpen] = useState(false);
  const [
    isNewConversationConfirmationOpen,
    setIsNewConversationConfirmationOpen,
    isNewConversationConfirmationOpenOwnerKey,
  ] = useModalState(false);
  const [isCreatingNewConversation, setIsCreatingNewConversation] =
    useState(false);
  const canCreateConversation =
    onCreateNewConversation !== null &&
    Boolean(workflowAboutId && workflowAboutType);
  const navigate = useNavigate();
  const launcher = useEntityConversationLauncher({
    organizationId,
    projectId,
  });
  const focalEntity = useMemo(
    () =>
      workflowAboutId && workflowAboutType
        ? {
            kind: "entity" as const,
            entityType: WORKFLOW_ABOUT_ENTITY_TYPES[workflowAboutType],
            entityId: workflowAboutId,
          }
        : { kind: "none" as const },
    [workflowAboutId, workflowAboutType],
  );

  const {
    data: conversationsData,
    isLoading,
    error: conversationsError,
    markStale,
  } = useConversations(organizationId, projectId, {
    workflowAboutId: workflowAboutId || undefined,
    workflowAboutType: workflowAboutType || undefined,
    statuses,
    search: appliedSearch,
    enabled: !!organizationId && !!projectId,
  });

  useEffect(() => {
    const timeout = setTimeout(() => {
      setAppliedSearch(searchTerm.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchTerm]);

  const projectIds = useMemo(() => (projectId ? [projectId] : []), [projectId]);

  useWebsocketSubscriptions(
    {
      projectIds,
      events: {
        onConversationCreated: markStale,
        onConversationUpdated: markStale,
        onConversationStatusChanged: markStale,
      },
    },
    { enabled: !!projectId },
  );

  const conversations = useMemo(
    () => (conversationsData ?? []).slice().sort(sortByUpdatedAt),
    [conversationsData],
  );

  const handleConversationSelect = useCallback(
    (conversation: ConversationResponseDto) => {
      if (conversation.workflowName?.startsWith("agent-")) {
        navigate(
          `/projects/${projectId}/resolve-agent-session/${conversation.id}`,
        );
        return;
      }
      const path = conversationPathForId(conversation.id);
      if (!path) {
        return;
      }
      navigate(path);
    },
    [conversationPathForId, navigate, projectId],
  );

  const handleCreateNewConversation = useCallback(async () => {
    if (!onCreateNewConversation) return;

    setIsCreatingNewConversation(true);
    try {
      await onCreateNewConversation("");
    } finally {
      setIsCreatingNewConversation(false);
    }
  }, [onCreateNewConversation]);

  const handleOpenDiscuss = useCallback(() => {
    if (confirmBeforeNewConversation) {
      setIsNewConversationConfirmationOpen(true);
      return;
    }

    if (onCreateNewConversation) {
      void handleCreateNewConversation();
      return;
    }

    setIsDiscussOpen(true);
  }, [
    confirmBeforeNewConversation,
    handleCreateNewConversation,
    onCreateNewConversation,
  ]);

  const handleCloseNewConversationConfirmation = useCallback(() => {
    if (isCreatingNewConversation) return;
    setIsNewConversationConfirmationOpen(false);
  }, [isCreatingNewConversation]);

  const handleConfirmNewConversation = useCallback(async () => {
    if (onCreateNewConversation) {
      await handleCreateNewConversation();
      setIsNewConversationConfirmationOpen(false);
      return;
    }

    setIsNewConversationConfirmationOpen(false);
    setIsDiscussOpen(true);
  }, [handleCreateNewConversation, onCreateNewConversation]);

  const handleCloseDiscuss = useCallback(() => {
    if (launcher.isLoading) return;
    setIsDiscussOpen(false);
  }, [launcher.isLoading]);

  const handleSubmitDiscuss = useCallback(
    async (submission: GraphConversationLaunchInput): Promise<boolean> => {
      if (!workflowAboutId || !workflowAboutType) {
        return false;
      }
      const ok = await launcher.launch({
        ...submission,
        context: {
          entityId: workflowAboutId,
          entityType: WORKFLOW_ABOUT_ENTITY_TYPES[workflowAboutType],
        },
      });
      if (ok) {
        setIsDiscussOpen(false);
      }
      return ok;
    },
    [launcher, workflowAboutId, workflowAboutType],
  );

  if (conversationsError) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Failed to load conversations. Please try again later.
        </Alert>
      </Box>
    );
  }

  return (
    <TabContainer>
      <Stack spacing={2}>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <CardHeader title="Conversations" />
          {onCreateNewConversation !== null && (
            <EntityActionButton
              variant="contained"
              verb="start"
              noun={TERMS.Conversation}
              entityType="conversation"
              loading={launcher.isLoading || isCreatingNewConversation}
              loadingLabel="Starting..."
              onClick={handleOpenDiscuss}
              disabled={
                !canCreateConversation ||
                launcher.isLoading ||
                isCreatingNewConversation
              }
              data-testid="start-conversation-button"
            />
          )}
        </Box>

        <TextField
          fullWidth
          placeholder="Search conversations..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          slotProps={{
            htmlInput: {
              "data-testid": "conversation-search-input",
              "aria-label": "Search conversations",
            },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            },
          }}
        />

        <ConversationArchiveList
          organizationId={organizationId}
          projectId={projectId}
          conversations={conversations}
          entityName={entityName}
          activeConversationId={activeConversationId ?? ""}
          onConversationSelect={handleConversationSelect}
          isLoading={isLoading}
          markStale={markStale}
        />
      </Stack>

      <ModalWorkOwner.Provider
        value={isNewConversationConfirmationOpenOwnerKey}
      >
        <NewConversationConfirmationDialog
          open={isNewConversationConfirmationOpen}
          onClose={handleCloseNewConversationConfirmation}
          onConfirm={() => {
            void handleConfirmNewConversation().catch(() => undefined);
          }}
          isConfirming={isCreatingNewConversation}
        />
      </ModalWorkOwner.Provider>

      <DiscussModal
        open={isDiscussOpen}
        onClose={handleCloseDiscuss}
        onSubmit={handleSubmitDiscuss}
        walkthroughEntity={null}
        isLoading={launcher.isLoading}
        organizationId={organizationId}
        projectId={projectId}
        focalEntity={focalEntity}
        fileReferenceScope={null}
        submitError={launcher.error}
        onClearSubmitError={launcher.clearError}
      />
    </TabContainer>
  );
};
