import {
  Alert,
  Box,
  Button,
  Checkbox,
  Link,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  OpenItemsTriageItem,
  OpenItemsTriageSuggestion,
} from "../../../api";
import type { TriageOutcome } from "../../../data/triage/application";

export interface OpenItemsTriageSuggestionCardProps {
  suggestion: OpenItemsTriageSuggestion;
  outcome: TriageOutcome;
  selected: boolean;
  disabled: boolean;
  /** Why this card cannot be selected or applied right now. */
  unavailableReason?: string;
  onSelect: () => void;
  onApply: () => void;
  itemHref: (item: OpenItemsTriageItem) => string;
}
const operationLabels = {
  removeOpenItems: "Remove from Open Items",
  reopenItems: "Reopen in Open Items",
  groupOpenItems: "Group Open Items",
  trackOnGoal: "Track on Goal",
  promoteGroupToGoal: "Promote group to Goal",
};
const plural = (count: number) => `${count} ${count === 1 ? "item" : "items"}`;
/** Rail title: the action and its size, e.g. "Group 5 items". */
export function compactTitle(suggestion: OpenItemsTriageSuggestion) {
  switch (suggestion.kind) {
    case "removeOpenItems":
      return `Remove ${plural(suggestion.items.length)}`;
    case "reopenItems":
      return `Reopen ${plural(suggestion.items.length)}`;
    case "groupOpenItems":
      return `Group ${plural(suggestion.items.length)}`;
    case "trackOnGoal":
      return `Track ${plural(suggestion.items.length)} on ${
        suggestion.goal.kind === "existingGoal"
          ? suggestion.goal.title
          : suggestion.goal.newGoal.name
      }`;
    case "promoteGroupToGoal":
      return `Promote group ${suggestion.groupName}`;
  }
}
const outcomeLabels = {
  idle: "Ready",
  pending: "Applying…",
  success: "Applied",
  failure: "Some work could not be applied",
  cancelled: "Promotion cancelled",
};

export function OpenItemsTriageSuggestionCard({
  suggestion,
  outcome,
  selected,
  disabled: disabledProp,
  unavailableReason,
  onSelect,
  onApply,
  itemHref,
}: OpenItemsTriageSuggestionCardProps) {
  const { t } = useTranslation();
  const items =
    suggestion.kind === "promoteGroupToGoal"
      ? suggestion.affectedMembers
      : suggestion.items;
  const disabled = disabledProp || !!unavailableReason;
  const busy = outcome.state === "pending";
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
      }}
      data-testid="triage-suggestion"
      data-suggestion-id={suggestion.suggestionId}
    >
      <Stack spacing={1}>
        <Stack direction="row" alignItems="center" spacing={0}>
          <Checkbox
            size={"medium"}
            checked={selected}
            disabled={disabled || busy || outcome.state === "success"}
            onChange={onSelect}
            inputProps={{
              "aria-label": t("triage.select", "Select suggestion"),
            }}
          />
          <Typography fontWeight={600}>
            {t(
              `triage.kind.${suggestion.kind}`,
              operationLabels[suggestion.kind],
            )}
          </Typography>
        </Stack>
        {suggestion.kind === "groupOpenItems" && (
          <Typography>
            {suggestion.group.kind === "existingGroup"
              ? suggestion.group.name
              : suggestion.group.newGroupName}
          </Typography>
        )}
        {suggestion.kind === "trackOnGoal" && (
          <Typography>
            {suggestion.goal.kind === "existingGoal"
              ? suggestion.goal.title
              : suggestion.goal.newGoal.name}
          </Typography>
        )}
        {suggestion.kind === "promoteGroupToGoal" && (
          <Typography>
            {suggestion.groupName} → {suggestion.goalName}
          </Typography>
        )}
        {unavailableReason && (
          <Alert severity="info" data-testid="triage-unavailable">
            {unavailableReason}
          </Alert>
        )}
        <Box sx={{ display: "contents" }}>
          {items.map((item) => (
            <Link
              key={`${item.entityType}:${item.entityId}`}
              href={itemHref(item)}
            >
              {item.title}
            </Link>
          ))}
        </Box>
        <Typography variant="body2">{suggestion.rationale}</Typography>
        {suggestion.evidence.length > 0 && (
          <Box
            data-testid="triage-evidence"
            sx={{
              bgcolor: "action.hover",
              p: 1,
              borderRadius: 1,
            }}
          >
            {suggestion.evidence.map((evidence, index) => (
              <Typography key={index} variant="body2" color="text.secondary">
                {t(`triage.evidence.${evidence.kind}`, evidence.kind)}:{" "}
                {evidence.summary}
              </Typography>
            ))}
          </Box>
        )}
        {outcome.state !== "idle" && (
          <Alert
            severity={
              outcome.state === "failure"
                ? "warning"
                : outcome.state === "success"
                  ? "success"
                  : "info"
            }
            data-testid="triage-outcome"
          >
            {t(`triage.state.${outcome.state}`, outcomeLabels[outcome.state])}
          </Alert>
        )}
        {outcome.error && <Alert severity="warning">{outcome.error}</Alert>}
        {outcome.createdGoal && (
          <Link
            data-testid="triage-created-goal"
            href={itemHref(outcome.createdGoal)}
          >
            {t("triage.createdGoal", "Created Goal")}:{" "}
            {outcome.createdGoal.title}
          </Link>
        )}
        {outcome.createdGroup && (
          <Typography variant="body2">
            {t("triage.createdGroup", "Created group")}:{" "}
            {outcome.createdGroup.name}
          </Typography>
        )}
        {outcome.items.map((result) => (
          <Typography
            key={`${result.item.entityType}:${result.item.entityId}`}
            variant="body2"
            color={result.state === "failure" ? "error" : "text.secondary"}
          >
            {result.item.title}:{" "}
            {result.error ?? t("triage.state.success", "Applied")}
          </Typography>
        ))}
        <Stack direction="row" justifyContent="flex-end">
          <Button
            data-testid="triage-apply"
            variant="outlined"
            size="small"
            onClick={onApply}
            disabled={disabled || busy || outcome.state === "success"}
          >
            {outcome.state === "failure"
              ? t("triage.retry", "Retry unfinished work")
              : suggestion.kind === "promoteGroupToGoal"
                ? t("triage.applyWithConfirmation", "Apply…")
                : t("triage.apply", "Apply")}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

export interface OpenItemsTriageRailCardProps {
  suggestion: OpenItemsTriageSuggestion;
  outcome: TriageOutcome;
  selected: boolean;
  disabled: boolean;
  /** Why this card cannot be selected right now. */
  unavailableReason: string | undefined;
  /** The highlighted card's rows are outlined in the comparison. */
  highlighted: boolean;
  onSelect: () => void;
  onHighlightChange: (highlighted: boolean) => void;
  itemHref: (item: OpenItemsTriageItem) => string;
}

/**
 * Rail card beside the comparison: one checkbox, the title, a one-line
 * rationale and an Evidence link. Applying happens once, for every checked
 * card, from the rail's own button.
 */
export function OpenItemsTriageRailCard({
  suggestion,
  outcome,
  selected,
  disabled,
  unavailableReason,
  highlighted,
  onSelect,
  onHighlightChange,
  itemHref,
}: OpenItemsTriageRailCardProps) {
  const { t } = useTranslation();
  const [showEvidence, setShowEvidence] = useState(false);
  const locked =
    disabled ||
    !!unavailableReason ||
    outcome.state === "pending" ||
    outcome.state === "success";

  return (
    <Paper
      variant="outlined"
      data-testid="triage-suggestion"
      data-suggestion-id={suggestion.suggestionId}
      data-selected={selected}
      data-highlighted={highlighted}
      onMouseEnter={() => onHighlightChange(true)}
      onMouseLeave={() => onHighlightChange(false)}
      onFocus={() => onHighlightChange(true)}
      onBlur={() => onHighlightChange(false)}
      sx={{
        px: 1,
        py: 0.875,
        borderRadius: 1.5,
        ...(selected && {
          borderColor: "success.main",
          bgcolor: (theme) => alpha(theme.palette.success.main, 0.06),
        }),
        ...(unavailableReason && { opacity: 0.6, borderStyle: "dashed" }),
        ...(highlighted && {
          outline: (theme) => `2px solid ${theme.palette.warning.main}`,
          outlineOffset: "1px",
        }),
      }}
    >
      <Stack
        component="label"
        direction="row"
        alignItems="center"
        spacing={0.75}
      >
        <Checkbox
          size="small"
          sx={{ p: 0 }}
          checked={selected}
          disabled={locked}
          onChange={onSelect}
          inputProps={{ "aria-label": t("triage.select", "Select suggestion") }}
        />
        <Typography sx={{ fontSize: 12, fontWeight: 700 }}>
          {compactTitle(suggestion)}
        </Typography>
      </Stack>
      <Typography
        data-testid={unavailableReason ? "triage-unavailable" : undefined}
        sx={{
          fontSize: 11,
          color: "text.secondary",
          lineHeight: 1.3,
          mt: 0.375,
          mb: 0.5,
          ml: 2.75,
        }}
      >
        {unavailableReason ?? suggestion.rationale}
      </Typography>
      {!unavailableReason && (
        <Link
          component="button"
          type="button"
          data-testid="triage-evidence-toggle"
          aria-expanded={showEvidence}
          onClick={() => setShowEvidence((open) => !open)}
          sx={{ fontSize: 11, ml: 2.75 }}
        >
          {t("triage.evidenceLink", "Evidence")}
        </Link>
      )}
      {showEvidence && (
        <Box data-testid="triage-evidence" sx={{ mt: 0.5, ml: 2.75 }}>
          {suggestion.evidence.map((evidence, index) => (
            <Typography
              key={index}
              sx={{ fontSize: 11, color: "text.secondary" }}
            >
              {t(`triage.evidence.${evidence.kind}`, evidence.kind)}:{" "}
              {evidence.summary}
            </Typography>
          ))}
          {suggestionItemsOf(suggestion).map((item) => (
            <Link
              key={`${item.entityType}:${item.entityId}`}
              href={itemHref(item)}
              sx={{ fontSize: 11, display: "block" }}
            >
              {item.title}
            </Link>
          ))}
        </Box>
      )}
      {outcome.state !== "idle" && (
        <Alert
          severity={
            outcome.state === "failure"
              ? "warning"
              : outcome.state === "success"
                ? "success"
                : "info"
          }
          data-testid="triage-outcome"
          data-outcome={outcome.state}
          sx={{ mt: 0.75, py: 0, fontSize: 11 }}
        >
          {t(`triage.state.${outcome.state}`, outcomeLabels[outcome.state])}
        </Alert>
      )}
      {outcome.error && (
        <Alert severity="warning" sx={{ mt: 0.5, py: 0, fontSize: 11 }}>
          {outcome.error}
        </Alert>
      )}
      {outcome.createdGoal && (
        <Link
          data-testid="triage-created-goal"
          href={itemHref(outcome.createdGoal)}
          sx={{ fontSize: 11, display: "block", mt: 0.5 }}
        >
          {t("triage.createdGoal", "Created Goal")}: {outcome.createdGoal.title}
        </Link>
      )}
      {outcome.items
        .filter((result) => result.state === "failure")
        .map((result) => (
          <Typography
            key={`${result.item.entityType}:${result.item.entityId}`}
            sx={{ fontSize: 11 }}
            color="error"
          >
            {result.item.title}: {result.error}
          </Typography>
        ))}
    </Paper>
  );
}

function suggestionItemsOf(suggestion: OpenItemsTriageSuggestion) {
  return suggestion.kind === "promoteGroupToGoal"
    ? suggestion.affectedMembers
    : suggestion.items;
}
