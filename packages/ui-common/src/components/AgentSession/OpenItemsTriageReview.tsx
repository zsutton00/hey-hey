import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Box, Button, Link, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import type {
  OpenItem,
  OpenItemsCollection,
  OpenItemsTriageItem,
  OpenItemsTriagePayload,
} from "../../api";
import type { TriageApplicationCoordinator } from "../../data/triage/application";
import { resolveSelection } from "../../data/triage/decisions";
import { replayTriage } from "../../data/triage/replay";
import type { WorkItemIconRegistry } from "../Entity/OpenItemIcon";
import {
  OpenItemsTriageRailCard,
  compactTitle,
} from "../LlmForms/Registry/OpenItemsTriageSuggestionCard";
import {
  OpenItemsTriagePreview,
  TRIAGE_REVIEW_CONTAINER,
} from "./OpenItemsTriagePreview";
import type { TriagePeekScope } from "./useTriageRowPeek";

const noSubscription = () => () => {};
const idleSnapshot = () => 0;
const noItems: OpenItem[] = [];
const noSelection: ReadonlySet<string> = new Set();
const NARROW = `@container ${TRIAGE_REVIEW_CONTAINER} (max-width: 800px)`;

export interface OpenItemsTriageReviewProps {
  payload: OpenItemsTriagePayload;
  scope: string;
  application: TriageApplicationCoordinator | undefined;
  /** The canonical collection the modal already reads. */
  collection: OpenItemsCollection | undefined;
  /** The project's work-item types, so rows show the sidebar's icons. */
  workItemIcons: WorkItemIconRegistry;
  /** Where the preview rows' hover Peek reads entities from. */
  peekScope: TriagePeekScope;
  itemHref: (item: OpenItemsTriageItem) => string;
  disabled: boolean;
}

/**
 * Completed results: suggestion cards beside a live before/after comparison.
 * Every available suggestion starts checked; nothing is written until Apply.
 * It fills the height it is given, with the rail and the comparison each
 * scrolling on their own.
 */
export function OpenItemsTriageReview({
  payload,
  scope,
  application,
  collection,
  workItemIcons,
  peekScope,
  itemHref,
  disabled,
}: OpenItemsTriageReviewProps) {
  const { t } = useTranslation();
  const version = useSyncExternalStore(
    application?.subscribe ?? noSubscription,
    application?.snapshot ?? idleSnapshot,
    idleSnapshot,
  );
  const [hovered, setHovered] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  useEffect(() => {
    payload.suggestions.forEach((suggestion) =>
      application?.observe(scope, suggestion),
    );
  }, [application, scope, payload]);

  const present = collection?.state === "PRESENT" ? collection : undefined;
  const items = present?.items ?? noItems;
  const groups = present?.groups;
  const suggestions = payload.suggestions;

  const checked =
    application && present
      ? application.selected(scope, suggestions, items)
      : noSelection;
  const selection = useMemo(
    () => resolveSelection(suggestions, checked, items),
    [suggestions, checked, items],
  );
  const outcomeOf = (suggestionId: string) => {
    const suggestion = suggestions.find(
      (s) => s.suggestionId === suggestionId,
    )!;
    return (
      application?.outcome(scope, suggestion) ?? { state: "idle", items: [] }
    );
  };

  // Finished suggestions are already in the collection; project only what
  // remains. `version` changes whenever the coordinator records an outcome.
  const applied = useMemo(
    () =>
      new Set(
        suggestions
          .filter((s) => application?.outcome(scope, s).state === "success")
          .map((s) => s.suggestionId),
      ),
    [suggestions, application, scope, version],
  );
  const remaining = useMemo(
    () => selection.selected.filter((id) => !applied.has(id)),
    [selection, applied],
  );

  // Hovering only reads the replay; it never recomputes it.
  const preview = useMemo(
    () =>
      replayTriage({
        items,
        groups: groups ?? [],
        suggestions,
        selected: remaining,
        offered: new Set(
          suggestions
            .map((s) => s.suggestionId)
            .filter((id) => !applied.has(id)),
        ),
        baselineFor: (suggestion, item) =>
          application?.baselineFor(scope, suggestion, item),
        isCompleted: (suggestion, item) =>
          application?.isCompleted(scope, suggestion, item) ?? false,
      }),
    [items, groups, suggestions, remaining, applied, application, scope],
  );

  const unavailable = disabled || !application || !present;
  const anyPending = suggestions.some(
    (s) => application?.outcome(scope, s).state === "pending",
  );
  const reason = (suggestionId: string) => {
    const block = selection.blocked.get(suggestionId);
    if (!block) {
      return undefined;
    }
    const holder = suggestions.find((s) => s.suggestionId === block.blockedBy);
    const holderName = holder ? compactTitle(holder) : block.blockedBy;
    return t(
      "triage.blocked",
      `Unavailable: ‘${block.itemTitle}’ is in selected suggestion ‘${holderName}’. Uncheck that one to choose this instead.`,
    );
  };

  const { totals } = preview;
  const summaryParts = [
    t(
      "triage.preview.summaryCount",
      `${totals.before} → ${totals.after} open items`,
    ),
    ...(totals.groupsCreated > 0
      ? [
          t(
            "triage.preview.summaryGroups",
            `${totals.groupsCreated} new ${totals.groupsCreated === 1 ? "group" : "groups"} (${totals.groupedIntoNew} items)`,
          ),
        ]
      : []),
    ...(totals.goalsCreated > 0
      ? [
          t(
            "triage.preview.summaryGoals",
            `${totals.goalsCreated} new ${totals.goalsCreated === 1 ? "Goal" : "Goals"} (${totals.goalMembersLeaving} tracked members leave, ${totals.goalMembersUngrouped} stay ungrouped)`,
          ),
        ]
      : []),
    t("triage.preview.summaryRemoved", `${totals.removed} removed`),
  ];
  const selectionLocked = unavailable || anyPending;
  const highlight = hovered
    ? { suggestionId: hovered, selected: remaining.includes(hovered) }
    : null;

  return (
    <Stack
      spacing={1.5}
      data-testid="open-items-triage-field"
      sx={{
        containerType: "inline-size",
        containerName: TRIAGE_REVIEW_CONTAINER,
        flex: 1,
        minHeight: 0,
      }}
    >
      <Box sx={{ flexShrink: 0 }}>
        <Typography
          data-testid="triage-summary-text"
          sx={
            summaryOpen
              ? undefined
              : {
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }
          }
        >
          {payload.summary}
        </Typography>
        <Link
          component="button"
          type="button"
          data-testid="triage-summary-toggle"
          onClick={() => setSummaryOpen((open) => !open)}
          sx={{ fontSize: 12 }}
        >
          {summaryOpen
            ? t("triage.summaryLess", "Show less")
            : t("triage.summaryMore", "Show more")}
        </Link>
      </Box>
      <Box
        data-testid="triage-preview-summary"
        aria-live="polite"
        sx={{
          flexShrink: 0,
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
            `If you apply the ${remaining.length} selected ${remaining.length === 1 ? "suggestion" : "suggestions"}:`,
          )}
        </b>{" "}
        {summaryParts.join(" · ")}{" "}
        <Box
          component="span"
          sx={{ color: "text.secondary", fontSize: 12, ml: 1 }}
        >
          {t("triage.preview.nothingYet", "Nothing changes until you apply.")}
        </Box>
      </Box>
      <Box
        data-testid="triage-review-layout"
        sx={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gap: 1.5,
          gridTemplateColumns: "220px minmax(0, 1fr)",
          gridTemplateRows: "minmax(0, 1fr)",
          [NARROW]: {
            gridTemplateColumns: "1fr",
            gridTemplateRows: "auto",
            overflowY: "auto",
          },
        }}
      >
        <Stack
          data-testid="triage-suggestion-rail"
          aria-label={t("triage.suggestions", "Suggestions")}
          sx={{
            minHeight: 0,
            borderRight: 1,
            borderColor: "divider",
            pr: 1.25,
            [NARROW]: { borderRight: 0, pr: 0 },
          }}
        >
          <Stack spacing={0.375} sx={{ flexShrink: 0, mb: 0.75 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
              {t("triage.suggestions", "Suggestions")}
              <Box
                component="small"
                data-testid="triage-selected-count"
                sx={{ fontWeight: 400, color: "text.secondary", ml: 0.5 }}
              >
                {t(
                  "triage.selectedCount",
                  `${selection.selected.length} of ${suggestions.length} selected`,
                )}
              </Box>
            </Typography>
            <Box sx={{ fontSize: 11 }}>
              <Link
                component="button"
                type="button"
                data-testid="triage-select-all"
                disabled={selectionLocked}
                onClick={() =>
                  application?.selectAll(scope, suggestions, items)
                }
                sx={{ fontSize: 11 }}
              >
                {t("triage.selectAll", "Select all")}
              </Link>
              {" · "}
              <Link
                component="button"
                type="button"
                data-testid="triage-clear-selection"
                disabled={selectionLocked}
                onClick={() => application?.clear(scope)}
                sx={{ fontSize: 11 }}
              >
                {t("triage.clearSelection", "Clear")}
              </Link>
            </Box>
          </Stack>
          <Stack
            spacing={0.75}
            data-testid="triage-suggestion-cards"
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              [NARROW]: { overflowY: "visible" },
            }}
          >
            {suggestions.map((suggestion) => (
              <OpenItemsTriageRailCard
                key={suggestion.suggestionId}
                suggestion={suggestion}
                outcome={outcomeOf(suggestion.suggestionId)}
                selected={selection.selected.includes(suggestion.suggestionId)}
                disabled={selectionLocked}
                unavailableReason={reason(suggestion.suggestionId)}
                highlighted={hovered === suggestion.suggestionId}
                itemHref={itemHref}
                onSelect={() =>
                  application?.toggle(scope, suggestion.suggestionId)
                }
                onHighlightChange={(on) =>
                  setHovered((current) =>
                    on
                      ? suggestion.suggestionId
                      : current === suggestion.suggestionId
                        ? null
                        : current,
                  )
                }
              />
            ))}
          </Stack>
          <Box
            sx={{
              flexShrink: 0,
              borderTop: 1,
              borderColor: "divider",
              pt: 1,
              mt: 0.5,
            }}
          >
            <Button
              data-testid="triage-apply-selected"
              variant="contained"
              size="small"
              fullWidth
              disabled={unavailable || remaining.length === 0 || anyPending}
              onClick={() => {
                void application?.applySelected(scope, suggestions, items);
              }}
            >
              {t("triage.applySelected", `Apply ${remaining.length} selected`)}
            </Button>
            <Typography
              variant="caption"
              color="text.secondary"
              data-testid="triage-apply-note"
              sx={{ display: "block", mt: 0.5, fontSize: 10 }}
            >
              {t(
                "triage.applyNote",
                "Promotion asks you to confirm the Goal name first.",
              )}
            </Typography>
          </Box>
        </Stack>
        <OpenItemsTriagePreview
          preview={preview}
          loading={!present}
          highlight={highlight}
          registry={workItemIcons}
          peekScope={peekScope}
        />
      </Box>
    </Stack>
  );
}
