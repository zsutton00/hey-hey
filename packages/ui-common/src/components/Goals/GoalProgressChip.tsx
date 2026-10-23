import React from "react";
import { Chip } from "@mui/material";
import { useTranslation } from "react-i18next";
import type { TaskResponseDto } from "../../api";
import {
  deriveGoalStatus,
  deriveGoalStatusFromSummary,
  goalStatusChipDescriptor,
} from "../../utils/goalStatus";

export interface GoalProgressChipProps {
  goal: Pick<
    TaskResponseDto,
    "dueDate" | "trackedEntities" | "trackedWorkSummary"
  >;
  now?: Date;
}

/**
 * Derived goal progress (done / at-risk / on-track). Kept separate from the
 * goal's persisted lifecycle status. Renders nothing when the row carries
 * neither a tracked-work summary nor snapshots, rather than inventing progress.
 */
export const GoalProgressChip: React.FC<GoalProgressChipProps> = ({
  goal,
  now,
}) => {
  const { t } = useTranslation();
  const status = goal.trackedWorkSummary
    ? deriveGoalStatusFromSummary(
        { dueDate: goal.dueDate, trackedWorkSummary: goal.trackedWorkSummary },
        now
      )
    : goal.trackedEntities
    ? deriveGoalStatus(
        { dueDate: goal.dueDate, trackedEntities: goal.trackedEntities },
        now
      )
    : null;
  if (!status) return null;
  const chip = goalStatusChipDescriptor(status);
  return (
    <Chip
      label={t(chip.i18nKey, { defaultValue: chip.fallback })}
      color={chip.color}
      size="small"
      variant="outlined"
      data-testid="goal-progress-chip"
      data-goal-progress={status}
    />
  );
};
