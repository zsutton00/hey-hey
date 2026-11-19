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
import {
  OpenItemsTriageSuggestionCard,
  compactTitle,
} from "../LlmForms/Registry/OpenItemsTriageSuggestionCard";
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
  const hidePending = new Set([
    ...selection.blocked.keys(),
    ...suggestions
      .filter((s) => outcomeOf(s.suggestionId).state === "success")
      .map((s) => s.suggestionId),
  ]);
  const preview = replayTriage({
    items,
    groups: groups ?? [],
    suggestions,
    accepted: remaining,
    hidePending,
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
    const holderName = holder ? compactTitle(holder) : block.blockedBy;
    return t(
      "triage.blocked",
      `Unavailable: "${block.itemTitle}" is already in the accepted suggestion "${holderName}".`,
    );
  };

  const { totals } = preview;
  const acceptedCount = selection.accepted.length;
  return (
    <Stack
      spacing={1.5}
      data-testid="open-items-triage-field"
      sx={{ containerType: "inline-size" }}
    >
      <Typography>{payload.summary}</Typography>
      <Box
        data-testid="triage-preview-summary"
        aria-live="polite"
        sx={{
          px: 1.25,
          py: 1,
          bgcolor: "action.hover",
          borderRadius: 1,
          fontSize: 13,
        }}
      >
        <b>
          {t(
            "triage.preview.summaryLead",
            "If you apply your accepted suggestions:",
          )}
        </b>{" "}
        {t(
          "triage.preview.summary",
          `${totals.before} → ${totals.after} open items · ${totals.groupsCreated} new ${totals.groupsCreated === 1 ? "group" : "groups"} · ${totals.removed} removed`,
        )}
      </Box>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: "260px minmax(0, 1fr)",
          alignItems: "start",
          "@container (max-width: 800px)": { gridTemplateColumns: "1fr" },
        }}
      >
        <Stack
          spacing={1}
          data-testid="triage-suggestion-rail"
          aria-label={t("triage.suggestions", "Suggestions")}
        >
          <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
            {t("triage.suggestions", "Suggestions")}
          </Typography>
          {suggestions.map((suggestion) => (
            <OpenItemsTriageSuggestionCard
              key={suggestion.suggestionId}
              compact
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
              disabled={unavailable || acceptedCount === 0 || anyPending}
              onClick={() => {
                void application?.applyAll(
                  scope,
                  suggestions.filter((s) =>
                    selection.accepted.includes(s.suggestionId),
                  ),
                );
              }}
            >
              {t("triage.applyAccepted", `Apply ${acceptedCount} accepted`)}
            </Button>
          </Stack>
          <Typography
            variant="caption"
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
