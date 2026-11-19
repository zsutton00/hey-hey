import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Box, Button, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type {
  OpenItem,
  OpenItemsCollection,
  OpenItemsTriageItem,
  OpenItemsTriagePayload,
} from "../../api";
import type { TriageApplicationCoordinator } from "../../data/triage/application";
import { replayTriage, resolveSelection } from "../../data/triage/replay";
import { OpenItemsTriageSuggestionCard } from "../LlmForms/Registry/OpenItemsTriageSuggestionCard";
import { OpenItemsTriagePreview } from "./OpenItemsTriagePreview";

const noSubscription = () => () => {};
const idleSnapshot = () => 0;
const noItems: OpenItem[] = [];

export interface OpenItemsTriageReviewProps {
  payload: OpenItemsTriagePayload;
  scope: string;
  application: TriageApplicationCoordinator | undefined;
  /** The canonical collection the modal already reads. */
  collection: OpenItemsCollection | undefined;
  itemHref: (item: OpenItemsTriageItem) => string;
  disabled: boolean;
}

/**
 * Completed results: suggestion cards beside a live before/after comparison.
 * Selection is transient and owned here; nothing is written until Apply.
 */
export function OpenItemsTriageReview({
  payload,
  scope,
  application,
  collection,
  itemHref,
  disabled,
}: OpenItemsTriageReviewProps) {
  const { t } = useTranslation();
  useSyncExternalStore(
    application?.subscribe ?? noSubscription,
    application?.snapshot ?? idleSnapshot,
    idleSnapshot,
  );
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    setAccepted(new Set());
  }, [scope]);
  useEffect(() => {
    payload.suggestions.forEach((suggestion) =>
      application?.observe(scope, suggestion),
    );
  }, [application, scope, payload]);

  const present = collection?.state === "PRESENT" ? collection : undefined;
  const items = present?.items ?? noItems;
  const groups = present?.groups;
  const suggestions = payload.suggestions;

  const selection = useMemo(
    () => resolveSelection(suggestions, accepted, items),
    [suggestions, accepted, items],
  );
  const outcomeOf = (suggestionId: string) => {
    const suggestion = suggestions.find(
      (s) => s.suggestionId === suggestionId,
    )!;
    return (
      application?.outcome(scope, suggestion) ?? { state: "idle", items: [] }
    );
  };
  // Finished suggestions are already in the collection; project only what remains.
  const remaining = selection.accepted.filter(
    (id) => outcomeOf(id).state !== "success",
  );
  const preview = replayTriage({
    items,
    groups: groups ?? [],
    suggestions,
    accepted: remaining,
    baselineFor: (suggestion, item) =>
      application?.baselineFor(scope, suggestion, item),
    isCompleted: (suggestion, item) =>
      application?.isCompleted(scope, suggestion, item) ?? false,
  });

  const unavailable = disabled || !application;
  const anyPending = suggestions.some(
    (s) => application?.outcome(scope, s).state === "pending",
  );
  const toggle = (suggestionId: string) => {
    const next = new Set(accepted);
    if (next.has(suggestionId)) {
      next.delete(suggestionId);
    } else {
      next.add(suggestionId);
    }
    setAccepted(next);
  };
  const reason = (suggestionId: string) => {
    const block = selection.blocked.get(suggestionId);
    if (!block) {
      return undefined;
    }
    const holder = suggestions.find((s) => s.suggestionId === block.blockedBy);
    const holderName = holder ? holder.rationale.slice(0, 60) : block.blockedBy;
    return t(
      "triage.blocked",
      `Unavailable: "${block.itemTitle}" is already part of the accepted suggestion "${holderName}". Un-accept it to restore this one.`,
    );
  };

  return (
    <Stack spacing={2} data-testid="open-items-triage-field">
      <Typography>{payload.summary}</Typography>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", lg: "minmax(300px, 2fr) 3fr" },
          alignItems: "start",
        }}
      >
        <Stack spacing={2} data-testid="triage-suggestion-rail">
          {suggestions.map((suggestion) => (
            <OpenItemsTriageSuggestionCard
              key={suggestion.suggestionId}
              suggestion={suggestion}
              outcome={outcomeOf(suggestion.suggestionId)}
              selected={selection.accepted.includes(suggestion.suggestionId)}
              disabled={unavailable}
              unavailableReason={reason(suggestion.suggestionId)}
              itemHref={itemHref}
              onSelect={() => toggle(suggestion.suggestionId)}
              onApply={() => {
                void application?.apply(scope, suggestion);
              }}
            />
          ))}
          <Stack direction="row" justifyContent="flex-end">
            <Button
              data-testid="triage-apply-all"
              variant="contained"
              size="small"
              disabled={
                unavailable || selection.accepted.length === 0 || anyPending
              }
              onClick={() => {
                void application?.applyAll(
                  scope,
                  suggestions.filter((s) =>
                    selection.accepted.includes(s.suggestionId),
                  ),
                );
              }}
            >
              {t("triage.applyAll", "Apply all selected")}
            </Button>
          </Stack>
          <Typography
            variant="body2"
            color="text.secondary"
            data-testid="triage-apply-note"
          >
            {t(
              "triage.applyNote",
              "Each suggestion is applied independently. Promotion asks you to confirm its name and optional date.",
            )}
          </Typography>
        </Stack>
        <OpenItemsTriagePreview preview={preview} loading={!present} />
      </Box>
    </Stack>
  );
}
