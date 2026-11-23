import { Alert, Button, Stack, Typography } from "@mui/material";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type {
  AgentSessionCurrentState,
  OpenItemsCollection,
  OpenItemsTriageItem,
} from "../../api";
import type { TriageApplicationCoordinator } from "../../data/triage/application";
import type { WorkItemIconRegistry } from "../Entity/OpenItemIcon";
import { useConversation } from "../../data/hooks/useConversation";
import { useConversationMessages } from "../../data/hooks/useConversationMessages";
import { OpenItemsTriageReview } from "./OpenItemsTriageReview";
import { OpenItemsTriageFollowUp } from "./OpenItemsTriageFollowUp";
import { OpenItemsTriageThinkingConversation } from "./OpenItemsTriageThinkingConversation";
import {
  latestOpenItemsTriageResult,
  openItemsTriageReviewStartedAt,
} from "./openItemsTriageResult";

export interface OpenItemsTriageResultsProps {
  organizationId: string;
  projectId: string;
  conversationId: string;
  application: TriageApplicationCoordinator | undefined;
  /** The canonical Open Items collection the comparison is replayed against. */
  collection: OpenItemsCollection | undefined;
  /** The project's work-item types, so preview rows show the sidebar's icons. */
  workItemIcons: WorkItemIconRegistry;
  itemHref: (item: OpenItemsTriageItem) => string;
  pending: boolean;
  disabled: boolean;
  onSend: (text: string) => Promise<void>;
  /**
   * Request message ids submitted by a transient review. When set, only replies
   * to these requests render, and a review with no correlated reply yet shows
   * no empty state, so a reused conversation never restores an older review.
   */
  requestMessageIds?: readonly string[];
  /** Reports whether a correlated result is currently rendered. */
  onResultPresenceChange?: (present: boolean) => void;
  /** The review session's current state, driving the thinking animation. */
  currentState?: AgentSessionCurrentState;
}

export function OpenItemsTriageResults({
  organizationId,
  projectId,
  conversationId,
  application,
  collection,
  workItemIcons,
  itemHref,
  pending,
  disabled,
  onSend,
  requestMessageIds,
  onResultPresenceChange,
  currentState,
}: OpenItemsTriageResultsProps) {
  const { t } = useTranslation();
  // Retain the existing conversation subscription so generated results arrive live.
  useConversation(organizationId, projectId, { conversationId });
  const messages = useConversationMessages(
    organizationId,
    projectId,
    conversationId,
  );
  const result = latestOpenItemsTriageResult(
    messages.orderedData,
    requestMessageIds,
  );
  const hasResult = !!result;
  useEffect(() => {
    onResultPresenceChange?.(hasResult);
  }, [hasResult, onResultPresenceChange]);
  return (
    <Stack
      spacing={2}
      data-testid="open-items-triage-results"
      sx={{ flex: 1, minHeight: 0 }}
    >
      {(pending || messages.isLoading) && (
        <OpenItemsTriageThinkingConversation
          messages={messages.orderedData}
          startedAt={
            requestMessageIds
              ? openItemsTriageReviewStartedAt(
                  messages.orderedData,
                  requestMessageIds,
                )
              : null
          }
          currentState={currentState}
        />
      )}
      {messages.error && (
        <Alert severity="error" data-testid="triage-results-error">
          {t("triage.resultsError", "Unable to load suggestions.")}{" "}
          <Button onClick={() => void messages.refetch()}>
            {t("common.retry", "Retry")}
          </Button>
        </Alert>
      )}
      {result ? (
        <OpenItemsTriageReview
          key={result.scope}
          payload={result.payload}
          scope={result.scope}
          application={application}
          collection={collection}
          workItemIcons={workItemIcons}
          itemHref={itemHref}
          disabled={disabled}
        />
      ) : (
        !pending &&
        !requestMessageIds &&
        !messages.isLoading &&
        !messages.error && (
          <Typography data-testid="triage-empty">
            {t(
              "triage.empty",
              "No suggestions yet. Run triage to review your Open Items.",
            )}
          </Typography>
        )
      )}
      <OpenItemsTriageFollowUp
        key={conversationId}
        pending={pending}
        disabled={disabled}
        onSend={onSend}
      />
    </Stack>
  );
}
