import { useId } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Box, Button, Card, Stack, Typography } from "@mui/material";
import type { GoalPmRoutingCreation, GoalPmRoutingOption } from "../../../api";
import { KEYS } from "../../../i18n/keys";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";
import { GoalPmNewConversationAction } from "./GoalPmNewConversationAction";

const presentation = (option: GoalPmRoutingOption, t: TFunction) => {
  const card = KEYS.goalPmAction.card;
  switch (option.kind) {
    case "startNewConversation":
      return {
        type: t(card.newConversationType),
        action: t(card.newConversationAction),
      };
    case "existingConversation":
      return {
        type: t(card.existingConversationType),
        action: t(card.existingConversationAction),
      };
    case "refineSearch":
      return {
        type: t(card.refineSearchType),
        action: t(card.refineSearchAction),
      };
    case "trackExistingWork":
      return {
        type: t(card.existingWorkType),
        action: t(card.existingWorkAction),
      };
    case "createMissingWork":
      return { type: t(card.newTaskType), action: t(card.newTaskAction) };
    case "proposal":
      return { type: t(card.proposalType), action: t(card.proposalAction) };
  }
};

/** The conversation a completed choice created, opened from its card. */
export interface GoalPmCreatedConversation {
  conversationId: string;
  href: string;
  onOpen?: (conversationId: string) => void;
}

interface GoalPmOptionCardProps {
  organizationId: string;
  projectId: string;
  option: GoalPmRoutingOption;
  disabled: boolean;
  completed: boolean;
  createdConversation?: GoalPmCreatedConversation;
  onSelect: (
    option: GoalPmRoutingOption,
    creation?: GoalPmRoutingCreation,
  ) => void;
}

const markdownSx = {
  typography: "body2",
  color: "text.secondary",
  "& p": { m: 0 },
} as const;

export function GoalPmOptionCard({
  organizationId,
  projectId,
  option,
  disabled,
  completed,
  createdConversation,
  onSelect,
}: GoalPmOptionCardProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const { type, action } = presentation(option, t);
  const title =
    option.kind === "trackExistingWork" ? option.target.title : option.title;

  return (
    <Card
      variant="outlined"
      component="section"
      aria-labelledby={titleId}
      data-testid="goal-pm-option-card"
      data-option-id={option.optionId}
      sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 2 }}
    >
      <Stack spacing={2}>
        <Box>
          <Typography variant="overline" color="text.secondary">
            {type}
          </Typography>
          <Typography
            id={titleId}
            component="h3"
            variant="h6"
            sx={{ mt: 0.5, overflowWrap: "anywhere" }}
          >
            {title}
          </Typography>
        </Box>
        <MarkdownRenderer allowMentionEscapes badgeMentions sx={markdownSx}>
          {option.rationale}
        </MarkdownRenderer>
        {option.kind === "existingConversation" && (
          <Stack spacing={1.5}>
            {option.evidence.map((evidence) => (
              <Box
                key={evidence.messageId}
                sx={{ pl: 2, borderLeft: 2, borderColor: "divider" }}
              >
                <Typography variant="body2">“{evidence.excerpt}”</Typography>
                <Box sx={{ mt: 0.5, typography: "caption" }}>
                  <MarkdownRenderer
                    allowMentionEscapes
                    badgeMentions
                    sx={{ ...markdownSx, typography: "caption" }}
                  >
                    {evidence.rationale}
                  </MarkdownRenderer>
                </Box>
              </Box>
            ))}
          </Stack>
        )}
        {createdConversation ? (
          <Button
            variant="outlined"
            component="a"
            href={createdConversation.href}
            data-testid="goal-pm-created-conversation-link"
            onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
              if (
                !createdConversation.onOpen ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey ||
                event.button !== 0
              )
                return;
              event.preventDefault();
              createdConversation.onOpen(createdConversation.conversationId);
            }}
            sx={{ alignSelf: "flex-start", textTransform: "none" }}
          >
            {t(KEYS.goalPmAction.card.openConversation)}
          </Button>
        ) : option.kind === "startNewConversation" && !completed ? (
          <GoalPmNewConversationAction
            organizationId={organizationId}
            projectId={projectId}
            optionId={option.optionId}
            label={action}
            disabled={disabled}
            onStart={(creation) => onSelect(option, creation)}
          />
        ) : (
          <Button
            variant="outlined"
            data-testid="goal-pm-record-choice"
            data-option-id={option.optionId}
            disabled={disabled}
            onClick={() => onSelect(option)}
            sx={{ alignSelf: "flex-start", textTransform: "none" }}
          >
            {completed && option.kind === "startNewConversation"
              ? t(KEYS.goalPmAction.card.created)
              : action}
          </Button>
        )}
      </Stack>
    </Card>
  );
}
