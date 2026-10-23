import { Alert, Button, Stack, Typography } from "@mui/material";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../../i18n/keys";
import {
  GoalPmOptionCard,
  type GoalPmCreatedConversation,
} from "./GoalPmOptionCard";
import type {
  GoalPmRoutingAnswer,
  GoalPmRoutingCreation,
  GoalPmRoutingOption,
  GoalPmRoutingPayload,
} from "../../../api";

export interface GoalPmActionFieldProps {
  organizationId: string;
  projectId: string;
  payload: GoalPmRoutingPayload;
  answer?: GoalPmRoutingAnswer;
  legacy?: boolean;
  disabled?: boolean;
  pending?: boolean;
  canRetry?: boolean;
  error?: string | null;
  onSelect: (
    option: GoalPmRoutingOption,
    creation?: GoalPmRoutingCreation,
  ) => void;
  conversationHref?: (conversationId: string) => string;
  onOpenConversation?: (conversationId: string) => void;
}

const optionLabel = (option: GoalPmRoutingOption, t: TFunction): string => {
  switch (option.kind) {
    case "existingConversation":
      return t(KEYS.goalPmAction.optionContinue, { title: option.title });
    case "startNewConversation":
      return t(KEYS.goalPmAction.optionCreateConversation, {
        title: option.title,
      });
    case "refineSearch":
      return option.title;
    case "trackExistingWork":
      return t(KEYS.goalPmAction.optionTrack, { title: option.target.title });
    case "createMissingWork":
      return t(KEYS.goalPmAction.optionReviewTask, { title: option.title });
    case "proposal":
      return t(KEYS.goalPmAction.optionReviewProposal, { title: option.title });
  }
};

export function GoalPmActionField({
  organizationId,
  projectId,
  payload,
  answer,
  legacy,
  disabled,
  pending,
  canRetry = false,
  error,
  onSelect,
  conversationHref,
  onOpenConversation,
}: GoalPmActionFieldProps) {
  const { t } = useTranslation();
  const createdConversation: GoalPmCreatedConversation | undefined =
    answer?.state === "COMPLETED" &&
    answer.outcome?.entityType === "CONVERSATION" &&
    conversationHref
      ? {
          conversationId: answer.outcome.entityId,
          href: conversationHref(answer.outcome.entityId),
          onOpen: onOpenConversation,
        }
      : undefined;

  return (
    <Stack spacing={2} data-testid="goal-pm-action-field" sx={{ my: 2 }}>
      {answer && !createdConversation ? (
        <Alert
          severity={answer.state === "COMPLETED" ? "success" : "info"}
          data-testid="goal-pm-recorded-choice"
        >
          {t(KEYS.goalPmAction.selected, {
            title: answer.outcome
              ? answer.outcome.title
              : optionLabel(answer.selectedOption, t),
          })}{" "}
          {answer.state === "PENDING"
            ? t(KEYS.goalPmAction.pending)
            : t(KEYS.goalPmAction.completed)}
        </Alert>
      ) : null}
      {legacy && !answer ? (
        <Alert severity="info">{t(KEYS.goalPmAction.legacy)}</Alert>
      ) : null}
      {payload.options.map((option) => (
        <GoalPmOptionCard
          key={option.optionId}
          organizationId={organizationId}
          projectId={projectId}
          option={option}
          completed={
            answer?.state === "COMPLETED" &&
            answer.selectedOption.optionId === option.optionId
          }
          createdConversation={
            answer?.selectedOption.optionId === option.optionId
              ? createdConversation
              : undefined
          }
          disabled={!!(disabled || pending || answer || legacy)}
          onSelect={onSelect}
        />
      ))}
      {answer?.state === "PENDING" ? (
        <Button
          data-testid="goal-pm-retry-handoff"
          disabled={pending || !canRetry}
          onClick={() => onSelect(answer.selectedOption)}
        >
          {t(KEYS.goalPmAction.retry)}
        </Button>
      ) : null}
      {pending ? (
        <Typography role="status">{t(KEYS.goalPmAction.applying)}</Typography>
      ) : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
    </Stack>
  );
}
