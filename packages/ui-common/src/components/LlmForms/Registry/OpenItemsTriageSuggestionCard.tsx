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
  /** Dense rail presentation beside the before/after comparison. */
  compact?: boolean;
  /** Why this card cannot be accepted or applied right now. */
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
  compact = false,
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
  if (compact) {
    return (
      <CompactSuggestionCard
        suggestion={suggestion}
        outcome={outcome}
        selected={selected}
        disabled={disabled}
        unavailableReason={unavailableReason}
        onSelect={onSelect}
        onApply={onApply}
        itemHref={itemHref}
      />
    );
  }
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

/**
 * Rail card beside the comparison: title, one-line rationale, then
 * Accepted/Accept, Evidence and Apply on one line. The comparison shows the
 * items, so the card does not repeat them.
 */
function CompactSuggestionCard({
  suggestion,
  outcome,
  selected,
  disabled,
  unavailableReason,
  onSelect,
  onApply,
  itemHref,
}: Omit<OpenItemsTriageSuggestionCardProps, "compact">) {
  const { t } = useTranslation();
  const [showEvidence, setShowEvidence] = useState(false);
  const busy = outcome.state === "pending";
  const done = outcome.state === "success";
  const locked = disabled || busy || done;

  return (
    <Paper
      variant="outlined"
      data-testid="triage-suggestion"
      data-suggestion-id={suggestion.suggestionId}
      sx={{
        px: 1,
        py: 0.875,
        borderRadius: 1.5,
        ...(selected && {
          borderColor: "success.main",
          bgcolor: (theme) => alpha(theme.palette.success.main, 0.06),
        }),
        ...(unavailableReason && { opacity: 0.6, borderStyle: "dashed" }),
      }}
    >
      <Stack direction="row" alignItems="center" spacing={0.75}>
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
        }}
      >
        {unavailableReason ?? suggestion.rationale}
      </Typography>
      {showEvidence && (
        <Box data-testid="triage-evidence" sx={{ mb: 0.5 }}>
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
      <Stack direction="row" alignItems="center" spacing={1}>
        {selected && !unavailableReason ? (
          <Typography
            data-testid="triage-accepted-label"
            sx={{ fontSize: 11, fontWeight: 600, color: "success.main" }}
          >
            {t("triage.accepted", "Accepted")}
          </Typography>
        ) : (
          <Button
            data-testid="triage-accept"
            variant="outlined"
            size="small"
            disabled={locked}
            onClick={onSelect}
            sx={compactButton}
          >
            {t("triage.accept", "Accept")}
          </Button>
        )}
        {!unavailableReason && (
          <Link
            component="button"
            type="button"
            data-testid="triage-evidence-toggle"
            aria-expanded={showEvidence}
            onClick={() => setShowEvidence((open) => !open)}
            sx={{ fontSize: 11 }}
          >
            {t("triage.evidenceLink", "Evidence")}
          </Link>
        )}
        {!unavailableReason && (
          <Button
            data-testid="triage-apply"
            variant="outlined"
            size="small"
            onClick={onApply}
            disabled={locked}
            sx={compactButton}
          >
            {outcome.state === "failure"
              ? t("triage.retry", "Retry unfinished work")
              : suggestion.kind === "promoteGroupToGoal"
                ? t("triage.applyWithConfirmation", "Apply…")
                : t("triage.apply", "Apply")}
          </Button>
        )}
      </Stack>
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

const compactButton = {
  minWidth: 0,
  px: 0.875,
  py: 0,
  fontSize: 11,
  lineHeight: "20px",
};

function suggestionItemsOf(suggestion: OpenItemsTriageSuggestion) {
  return suggestion.kind === "promoteGroupToGoal"
    ? suggestion.affectedMembers
    : suggestion.items;
}
