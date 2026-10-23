import { Box, Button, type SxProps, type Theme } from "@mui/material";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { InitiativeResponseDto, TaskResponseDto } from "../api";
import { WorkStatus as WorkStatusEnum } from "../api";
import { useWorkItemUpdateMethods } from "../data/hooks";
import { KEYS } from "../i18n/keys";

export interface WorkItemEditControlsProps {
  workItem: InitiativeResponseDto | TaskResponseDto;
  isEditMode: boolean;
  onEditModeChange: (isEditMode: boolean) => void;
  organizationId: string;
  projectId: string;
  initiativeId?: string;
  sx?: SxProps<Theme>;
}

/**
 * WorkItemEditControls - Manages edit/done toggling and set-to-ready transitions
 *
 * Behavior:
 * - If work item is still refining:
 *   - Shows "Set Ready" button only when status === REFINING_ACCEPTANCE_CRITERIA
 *   - No button shown for other refining states
 * - If work item is done refining:
 *   - Shows Edit/Done toggle buttons to control edit mode
 *   - Edit: enables edit mode (isEditMode = true)
 *   - Done: disables edit mode (isEditMode = false)
 */
export const WorkItemEditControls: React.FC<WorkItemEditControlsProps> = ({
  workItem,
  isEditMode,
  onEditModeChange,
  organizationId,
  projectId,
  initiativeId,
  sx,
}) => {
  const { t } = useTranslation();

  // Determine entity type from workItem structure
  const entityType = "task" as const;

  const { updateTask } = useWorkItemUpdateMethods(
    organizationId,
    entityType,
    projectId,
    undefined,
    {
      initiativeId,
    }
  );

  const isRefining = workItem.status.startsWith("REFINING_");
  const isReadyForApproval =
    workItem.status === WorkStatusEnum.RefiningAcceptanceCriteria;

  const handleSetReady = useCallback(async () => {
    try {
      await updateTask(workItem.id, {
        status: WorkStatusEnum.Backlog,
      });
    } catch (error) {
      console.error("Failed to set work item to ready:", error);
    }
  }, [workItem.id, updateTask]);

  const handleEditToggle = useCallback(() => {
    onEditModeChange(!isEditMode);
  }, [isEditMode, onEditModeChange]);

  const containerSx: SxProps<Theme> = {
    display: "flex",
    gap: 1,
    ...sx,
  };

  // Refining state: show "Set Ready" only when acceptance criteria stage
  if (isRefining) {
    if (isReadyForApproval) {
      return (
        <Box sx={containerSx}>
          <Button
            variant="contained"
            color="success"
            onClick={handleSetReady}
            size="small"
          >
            {t(KEYS.workItems.editor.setReady)}
          </Button>
        </Box>
      );
    }
    // Other refining states: no button
    return null;
  }

  // Done refining: show Edit/Done toggle
  return (
    <Box sx={containerSx}>
      <Button
        variant={isEditMode ? "outlined" : "contained"}
        color="primary"
        onClick={handleEditToggle}
        size="small"
      >
        {isEditMode ? t(KEYS.tasks.status.done) : t(KEYS.common.edit)}
      </Button>
    </Box>
  );
};
