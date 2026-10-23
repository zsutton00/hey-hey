import {
  Box,
  Chip,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import React, { useCallback, useMemo } from "react";
import { SelectableEntityList } from "../../SelectableEntityList";
import type { SelectableEntityListItem } from "../../SelectableEntityList";
import type { FieldComponentProps } from "./types";
import {
  type SyncRecommendationItem,
  type SyncRecommendationValue,
  SyncRecommendationNextAction,
  isSyncRecommendationValue,
} from "./types";

const SEVERITY_CONFIG: Record<
  string,
  {
    label: string;
    color: "default" | "primary" | "secondary" | "success" | "warning";
  }
> = {
  small: { label: "Small", color: "warning" },
  large: { label: "Large", color: "secondary" },
  ignored: { label: "Ignored", color: "default" },
};

const DIRECTION_LABELS: Record<string, string> = {
  design_doc: "Update design doc",
  code: "Update code",
};

const SyncRecommendationField: React.FC<
  FieldComponentProps<SyncRecommendationValue>
> = ({ value, onChange, isSubmitted, disabled }) => {
  const theme = useTheme();

  const recommendations = value?.recommendations ?? [];
  const userMessage = value?.userMessage ?? "";

  const allDecided = useMemo(
    () =>
      recommendations.length > 0 &&
      recommendations.every((r) => r.action !== "pending"),
    [recommendations],
  );

  const updateRecommendation = useCallback(
    (id: string, patch: Partial<SyncRecommendationItem>) => {
      if (!value || !onChange) return;
      const updated = value.recommendations.map((r) =>
        r.id === id ? { ...r, ...patch } : r,
      );
      const feedback = updated.map((r) => ({
        id: r.id,
        title: r.title,
        action: r.action,
        comment: r.comment,
      }));
      const everyDecided = updated.every((r) => r.action !== "pending");
      onChange({
        ...value,
        recommendations: updated,
        feedback,
        nextAction: everyDecided
          ? SyncRecommendationNextAction.ReadyForNextStep
          : SyncRecommendationNextAction.ContinueRevising,
      });
    },
    [value, onChange],
  );

  const handleAccept = useCallback(
    (id: string) => {
      updateRecommendation(id, { action: "accept" });
    },
    [updateRecommendation],
  );

  const handleReject = useCallback(
    (id: string) => {
      updateRecommendation(id, { action: "reject" });
    },
    [updateRecommendation],
  );

  const handleCommentChange = useCallback(
    (id: string, comment: string) => {
      updateRecommendation(id, { comment });
    },
    [updateRecommendation],
  );

  const handleUserMessageChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!value || !onChange) return;
      onChange({ ...value, userMessage: e.target.value });
    },
    [value, onChange],
  );

  const listItems: SelectableEntityListItem[] = useMemo(
    () =>
      recommendations.map((rec) => {
        const severity = SEVERITY_CONFIG[rec.severity] ?? SEVERITY_CONFIG.small;
        const directionLabel = DIRECTION_LABELS[rec.direction] ?? rec.direction;

        return {
          id: rec.id,
          title: rec.title,
          description: rec.reasoning,
          badgeLabel: severity.label,
          badgeColor: severity.color,
          status: rec.action,
          comment: rec.comment,
          readOnly: isSubmitted,
          notes: `Suggested: ${directionLabel}`,
          meta: rec.suggestedAlignment,
          detailContent: (
            <Chip
              label={directionLabel}
              size="small"
              variant="outlined"
              sx={{
                height: 20,
                fontSize: "0.65rem",
                color:
                  rec.direction === "code"
                    ? theme.palette.info.main
                    : theme.palette.warning.main,
                borderColor:
                  rec.direction === "code"
                    ? theme.palette.info.main
                    : theme.palette.warning.main,
              }}
            />
          ),
        };
      }),
    [recommendations, isSubmitted, theme],
  );

  const { acceptedCount, rejectedCount, pendingCount } = useMemo(() => {
    let accepted = 0;
    let rejected = 0;
    let pending = 0;
    for (const r of recommendations) {
      if (r.action === "accept") accepted++;
      else if (r.action === "reject") rejected++;
      else pending++;
    }
    return {
      acceptedCount: accepted,
      rejectedCount: rejected,
      pendingCount: pending,
    };
  }, [recommendations]);

  if (recommendations.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No sync recommendations available.
      </Typography>
    );
  }

  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Typography variant="subtitle2" color="text.secondary">
          {recommendations.length} recommendation
          {recommendations.length !== 1 ? "s" : ""}
        </Typography>
        <Stack direction="row" spacing={0.5}>
          {acceptedCount > 0 && (
            <Chip
              label={`${acceptedCount} accepted`}
              size="small"
              color="success"
              sx={{ height: 20, fontSize: "0.7rem" }}
            />
          )}
          {rejectedCount > 0 && (
            <Chip
              label={`${rejectedCount} rejected`}
              size="small"
              color="error"
              sx={{ height: 20, fontSize: "0.7rem" }}
            />
          )}
          {pendingCount > 0 && (
            <Chip
              label={`${pendingCount} pending`}
              size="small"
              variant="outlined"
              sx={{ height: 20, fontSize: "0.7rem" }}
            />
          )}
        </Stack>
      </Box>

      <SelectableEntityList
        items={listItems}
        showActions
        showBackground
        showBorder
        showEntityTypeChip={false}
        entityIconPosition="hidden"
        disabled={disabled || isSubmitted}
        onAccept={handleAccept}
        onReject={handleReject}
        onCommentChange={handleCommentChange}
      />

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
          Feedback or refinement request
        </Typography>
        <Tooltip
          title={
            allDecided
              ? ""
              : "Review all recommendations before submitting feedback"
          }
        >
          <TextField
            fullWidth
            size="small"
            multiline
            minRows={2}
            maxRows={4}
            placeholder="Add feedback, request refinements, or explain your decisions..."
            value={userMessage}
            onChange={handleUserMessageChange}
            disabled={disabled || isSubmitted}
            variant="outlined"
          />
        </Tooltip>
      </Paper>
    </Stack>
  );
};

export default SyncRecommendationField;

const createSyncRecommendationValue = (
  recommendations: SyncRecommendationItem[],
): SyncRecommendationValue => ({
  type: "SYNC_RECOMMENDATION",
  nextAction: SyncRecommendationNextAction.ContinueRevising,
  userMessage: "",
  recommendations: recommendations.map((r) => ({
    ...r,
    action: r.action ?? "pending",
  })),
  feedback: [],
});

export const prepareSyncRecommendationInitialValue = (context: {
  baseValue: unknown;
}): SyncRecommendationValue | undefined => {
  if (isSyncRecommendationValue(context.baseValue)) {
    return context.baseValue;
  }

  if (
    typeof context.baseValue === "object" &&
    context.baseValue !== null &&
    "recommendations" in context.baseValue
  ) {
    const raw = context.baseValue as {
      recommendations?: SyncRecommendationItem[];
    };
    if (Array.isArray(raw.recommendations)) {
      return createSyncRecommendationValue(raw.recommendations);
    }
  }

  return undefined;
};
