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
      return `Group ${plural(suggestion.items.length)} · ${
        suggestion.group.kind === "existingGroup"
          ? suggestion.group.name
          : suggestion.group.newGroupName
      }`;
    case "trackOnGoal":
      return `Track ${plural(suggestion.items.length)} on ${
        suggestion.goal.kind === "existingGoal"
          ? suggestion.goal.title
          : suggestion.goal.newGoal.name
      }`;
    case "promoteGroupToGoal":
      return `Promote ${suggestion.groupName} to Goal`;
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
  const busy = outcome.state === "pending";
  return (
    <Paper
      variant="outlined"
      sx={{
        p: compact ? 1.25 : 2,
        ...(compact && selected && { borderColor: "success.main" }),
        ...(compact &&
          unavailableReason && { opacity: 0.7, borderStyle: "dashed" }),
      }}
      data-testid="triage-suggestion"
      data-suggestion-id={suggestion.suggestionId}
    >
      <Stack spacing={compact ? 0.75 : 1}>
        <Stack direction="row" alignItems="center" spacing={compact ? 0.5 : 0}>
          <Checkbox
            size={compact ? "small" : "medium"}
            sx={compact ? { p: 0.25 } : undefined}
            checked={selected}
            disabled={disabled || busy || outcome.state === "success"}
            onChange={onSelect}
            inputProps={{
              "aria-label": t("triage.select", "Select suggestion"),
            }}
          />
          <Typography
            fontWeight={600}
            sx={compact ? { fontSize: 13 } : undefined}
          >
            {compact
              ? compactTitle(suggestion)
              : t(
                  `triage.kind.${suggestion.kind}`,
                  operationLabels[suggestion.kind],
                )}
          </Typography>
        </Stack>
        {!compact && suggestion.kind === "groupOpenItems" && (
          <Typography>
            {suggestion.group.kind === "existingGroup"
              ? suggestion.group.name
              : suggestion.group.newGroupName}
          </Typography>
        )}
        {!compact && suggestion.kind === "trackOnGoal" && (
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
          <Alert
            severity="info"
            data-testid="triage-unavailable"
            sx={compact ? { py: 0, fontSize: 12 } : undefined}
          >
            {unavailableReason}
          </Alert>
        )}
        <Box
          sx={
            compact
              ? {
                  display: "flex",
                  flexWrap: "wrap",
                  columnGap: 1,
                  rowGap: 0.25,
                }
              : { display: "contents" }
          }
        >
          {items.map((item) => (
            <Link
              key={`${item.entityType}:${item.entityId}`}
              href={itemHref(item)}
              sx={compact ? { fontSize: 12 } : undefined}
            >
              {item.title}
            </Link>
          ))}
        </Box>
        <Typography variant="body2" sx={compact ? { fontSize: 12 } : undefined}>
          {suggestion.rationale}
        </Typography>
        {compact && selected && !unavailableReason && (
          <Typography
            variant="caption"
            color="success.main"
            fontWeight={600}
            data-testid="triage-accepted-label"
          >
            {t("triage.accepted", "Accepted")}
          </Typography>
        )}
        {suggestion.evidence.length > 0 && (
          <Box
            data-testid="triage-evidence"
            sx={{
              bgcolor: "action.hover",
              p: compact ? 0.75 : 1,
              borderRadius: 1,
            }}
          >
            {suggestion.evidence.map((evidence, index) => (
              <Typography
                key={index}
                variant="body2"
                color="text.secondary"
                sx={compact ? { fontSize: 11 } : undefined}
              >
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
