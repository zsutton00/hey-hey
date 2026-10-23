import { Alert, Box, Stack, Typography } from "@mui/material";
import type { Stable } from "../../../types";
import React, { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  ConversationResponseDto,
  CreateConversationDto,
  WorkflowName,
} from "../../../api";
import { usePathService } from "../../../contexts";
import { useCreateConversation } from "../../../data/hooks/useCreateConversation";
import { useWorkflowConversations } from "../../../data/hooks/useWorkflowConversations";
import { TERMS } from "../../../i18n/terminology";
import { EntityActionButton } from "../../EntityActionButton";
import { EntityGrid, EntityListItem, conversationAdapter } from "../../Entity";

export interface ConversationPathBuilderParams {
  projectId: string;
  conversationId: string;
  conversation: ConversationResponseDto;
}

export type ConversationPathBuilder = (
  params: ConversationPathBuilderParams,
) => string;

export interface WorkflowConversationLauncherContentProps {
  organizationId: string;
  projectId: string;
  workflowName: WorkflowName;
  workflowAboutId: string;
  createConversationDto: Stable<() => CreateConversationDto>;
  buildConversationPath?: ConversationPathBuilder;
  listTitle?: string;
  /** Display noun for the create action; defaults to the conversation term. */
  createNoun?: string;
  emptyMessage?: string;
  dataTestId?: string;
}

export const WorkflowConversationLauncherContent: React.FC<
  WorkflowConversationLauncherContentProps
> = ({
  organizationId,
  projectId,
  workflowName,
  workflowAboutId,
  createConversationDto,
  buildConversationPath,
  listTitle,
  createNoun = TERMS.Conversation,
  emptyMessage,
  dataTestId = "workflow-conversation-launcher-content",
}) => {
  const navigate = useNavigate();
  const pathService = usePathService();
  const [createError, setCreateError] = useState<string | null>(null);

  const {
    data: conversations,
    isLoading,
    error: workflowConversationsError,
  } = useWorkflowConversations(
    organizationId,
    projectId,
    workflowName,
    workflowAboutId,
    {
      sortBy: "updatedAt",
      sortOrder: "desc",
      enabled:
        organizationId !== "" &&
        projectId !== "" &&
        workflowAboutId !== "" &&
        workflowName !== undefined,
    },
  );

  const getConversationPath = useCallback(
    (conversation: ConversationResponseDto): string => {
      if (buildConversationPath) {
        return buildConversationPath({
          projectId,
          conversationId: conversation.id,
          conversation,
        });
      }

      return pathService.conversation({
        projectId,
        conversationId: conversation.id,
      });
    },
    [buildConversationPath, pathService, projectId],
  );

  const openConversation = useCallback(
    (conversation: ConversationResponseDto) => {
      navigate(getConversationPath(conversation));
    },
    [getConversationPath, navigate],
  );

  const createConversationMutation = useCreateConversation({
    onSuccess: (conversation) => {
      setCreateError(null);
      openConversation(conversation);
    },
    onError: (error) => {
      setCreateError(error.message);
    },
  });

  const handleCreateConversation = useCallback(() => {
    setCreateError(null);

    createConversationMutation.mutate({
      organizationId,
      projectId,
      conversationDto: createConversationDto(),
    });
  }, [
    createConversationDto,
    createConversationMutation,
    organizationId,
    projectId,
  ]);
  const conversationItems = conversations ?? [];

  return (
    <Box data-testid={dataTestId}>
      <Stack spacing={2}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1.5}
        >
          <Typography variant="subtitle1" fontWeight={600}>
            {listTitle ?? "Conversations"}
          </Typography>
          <EntityActionButton
            variant="contained"
            verb="create"
            noun={createNoun}
            entityType="conversation"
            onClick={handleCreateConversation}
            disabled={createConversationMutation.isPending}
            data-testid={`${dataTestId}-create-button`}
          />
        </Stack>

        {workflowConversationsError && (
          <Alert severity="error" data-testid={`${dataTestId}-load-error`}>
            {workflowConversationsError.message}
          </Alert>
        )}

        {createError && (
          <Alert severity="error" data-testid={`${dataTestId}-create-error`}>
            {createError}
          </Alert>
        )}

        <EntityGrid
          items={conversationItems}
          loading={isLoading}
          keyExtractor={(conversation) => conversation.id}
          emptyMessage={emptyMessage ?? "No conversations yet"}
          spacing={1.5}
          renderItem={(conversation) => {
            const listItemProps = conversationAdapter.toEntityListItemProps(
              conversation,
              {
                onClick: () => openConversation(conversation),
              },
            );

            return <EntityListItem {...listItemProps} />;
          }}
        />
      </Stack>
    </Box>
  );
};
