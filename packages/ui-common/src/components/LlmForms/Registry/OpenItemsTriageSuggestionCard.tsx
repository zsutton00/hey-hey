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
  disabled,
  onSelect,
  onApply,
  itemHref,
}: OpenItemsTriageSuggestionCardProps) {
  const { t } = useTranslation();
  const items =
    suggestion.kind === "promoteGroupToGoal"
      ? suggestion.affectedMembers
      : suggestion.items;
  const busy = outcome.state === "pending";
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2 }}
      data-testid="triage-suggestion"
      data-suggestion-id={suggestion.suggestionId}
    >
      <Stack spacing={1}>
        <Stack direction="row" alignItems="center">
          <Checkbox
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
              operationLabels[suggestion.kind]
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
        {items.map((item) => (
          <Link
            key={`${item.entityType}:${item.entityId}`}
            href={itemHref(item)}
          >
            {item.title}
          </Link>
        ))}
        <Typography variant="body2">{suggestion.rationale}</Typography>
        {suggestion.evidence.length > 0 && (
          <Box
            data-testid="triage-evidence"
            sx={{ bgcolor: "action.hover", p: 1, borderRadius: 1 }}
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
