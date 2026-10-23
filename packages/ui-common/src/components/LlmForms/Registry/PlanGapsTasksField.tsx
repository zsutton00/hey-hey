import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React, { useMemo, useState } from "react";
import { EntityLinkWithPreview } from "../../Entity";
import type { SearchEntity } from "../../AdvancedSearch/types";
import { EntityType } from "../../../api";
import type { FieldComponentProps } from "./types";
import type { PlanGapsTasksFieldConfig, PlanGapsTasksValue } from "./types";
import { createPlanGapsTasksValue } from "./planGapsUtils";
import {
  PlanGapsClarifyingSection,
  PlanGapsGapList,
  PlanGapsSearchSection,
} from "./PlanGapsShared";
import {
  sectionHeaderSx,
  usePlanGapsReviewHandlers,
  usePlanGapsReviewState,
} from "./planGapsSharedState";

export interface PlanGapsTasksFieldProps
  extends Omit<FieldComponentProps<PlanGapsTasksValue>, "config"> {
  config: PlanGapsTasksFieldConfig;
}

export const PlanGapsTasksField: React.FC<PlanGapsTasksFieldProps> = ({
  config,
  value,
  onChange,
  disabled = false,
  isSubmitted = false,
  context,
}) => {
  const payload = config.payload;
  const fallbackValue = useMemo(
    () =>
      payload
        ? createPlanGapsTasksValue(
            payload.gaps.tasks,
            payload.clarificationQuestions.tasks
          )
        : null,
    [payload]
  );
  const [showSearch, setShowSearch] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");

  const { fieldValue, gapReviews, clarifyingAnswers } =
    usePlanGapsReviewState<PlanGapsTasksValue>({
      payload,
      value,
      fallbackValue,
      gaps: payload?.gaps.tasks ?? [],
      clarificationQuestions: payload?.clarificationQuestions.tasks ?? [],
    });
  const {
    updateGapReviewAction,
    updateGapReviewComment,
    updateCoverageReviewAction,
    updateCoverageReviewComment,
    updateClarifyingAnswers,
  } = usePlanGapsReviewHandlers({
    fieldValue,
    gapReviews,
    onChange,
  });

  if (!payload || !fieldValue) {
    return (
      <Box sx={{ p: 2, color: "error.main" }}>
        <Typography>Missing plan gap tasks payload</Typography>
      </Box>
    );
  }

  const isLocked = disabled || isSubmitted;

  const handleAddTask = () => {
    const trimmedTitle = taskTitle.trim();
    if (!trimmedTitle) return;

    onChange?.({
      ...fieldValue,
      gapReviews,
      manuallyAdded: [
        ...fieldValue.manuallyAdded,
        {
          source: "user_added",
          kind: "manual",
          entityType: "tasks",
          title: trimmedTitle,
          description: taskDescription.trim() || undefined,
        },
      ],
      clarifyingAnswers,
    });

    setTaskTitle("");
    setTaskDescription("");
  };

  const handleRemoveTask = (index: number) => {
    onChange?.({
      ...fieldValue,
      gapReviews,
      clarifyingAnswers,
      manuallyAdded: fieldValue.manuallyAdded.filter(
        (_item, itemIndex) => itemIndex !== index
      ),
    });
  };

  const handleSearchSelect = (entities: SearchEntity[]) => {
    if (entities.length === 0) return;

    const existingIds = new Set(
      fieldValue.manuallyAdded.flatMap((item) =>
        item.kind === "existing" ? [item.entityId] : []
      )
    );

    const additions = entities
      .filter(
        (entity) => entity.type.toLowerCase() === EntityType.Task.toLowerCase()
      )
      .filter((entity) => !existingIds.has(entity.id))
      .map((entity) => ({
        source: "user_added" as const,
        kind: "existing" as const,
        entityType: "tasks" as const,
        entityId: entity.id,
        name: entity.name,
        description: entity.description,
      }));

    if (additions.length === 0) return;

    onChange?.({
      ...fieldValue,
      gapReviews,
      clarifyingAnswers,
      manuallyAdded: [...fieldValue.manuallyAdded, ...additions],
    });
  };

  return (
    <Stack spacing={3} data-testid={`plan-gaps-tasks-${config.field}`}>
      <Typography variant="body2" color="text.secondary">
        {config.description}
        {config.required && (
          <Typography component="span" color="error.main" sx={{ ml: 0.5 }}>
            *
          </Typography>
        )}
      </Typography>

      <PlanGapsGapList
        title="Recommended task themes"
        description="These tasks are representative of the tasks that could be useful. Accept or reject them to shape the plan."
        gaps={payload.gaps.tasks}
        gapReviews={gapReviews}
        isLocked={isLocked}
        emptyMessage="No task gaps identified."
        sourceCategory="tasks"
        onAcceptGap={(gapId) => updateGapReviewAction(gapId, "accept")}
        onRejectGap={(gapId) => updateGapReviewAction(gapId, "reject")}
        onGapCommentChange={updateGapReviewComment}
        onAcceptCoverage={(gapTitle, entityId) =>
          updateCoverageReviewAction(gapTitle, entityId, "accept")
        }
        onRejectCoverage={(gapTitle, entityId) =>
          updateCoverageReviewAction(gapTitle, entityId, "reject")
        }
        onCoverageCommentChange={updateCoverageReviewComment}
        organizationId={context.organizationId}
        projectId={context.projectId}
      />

      <Divider />

      <Box>
        <Typography variant="overline" sx={sectionHeaderSx}>
          Any tasks we missed?
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Did we miss any tasks? Show us what to include.
        </Typography>
        {fieldValue.manuallyAdded.length > 0 && (
          <List sx={{ py: 0 }}>
            {fieldValue.manuallyAdded.map((item, index) => {
              const title = item.kind === "manual" ? item.title : item.name;
              return (
                <ListItem
                  key={`${title}-${index}`}
                  sx={{
                    px: 1,
                    py: 1,
                    borderRadius: 1,
                    mb: 1,
                    alignItems: "flex-start",
                    backgroundColor: "action.hover",
                    border: 1,
                    borderColor: "divider",
                  }}
                >
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center">
                        {item.kind === "existing" ? (
                          <EntityLinkWithPreview
                            label={title}
                            entityId={item.entityId}
                            entityType={item.entityType}
                            organizationId={context.organizationId}
                            projectId={context.projectId}
                          />
                        ) : (
                          <Typography variant="body2" fontWeight={600}>
                            {title}
                          </Typography>
                        )}
                        <Chip label="Added" size="small" color="primary" />
                      </Stack>
                    }
                    secondary={
                      item.description ? (
                        <Typography variant="caption" color="text.secondary">
                          {item.description}
                        </Typography>
                      ) : null
                    }
                  />
                  <IconButton
                    size="small"
                    onClick={() => handleRemoveTask(index)}
                    disabled={isLocked}
                  >
                    <CloseIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </ListItem>
              );
            })}
          </List>
        )}

        <Stack spacing={1} sx={{ mt: 2 }}>
          <TextField
            label="Task title"
            value={taskTitle}
            onChange={(event) => setTaskTitle(event.target.value)}
            disabled={isLocked}
            size="small"
            fullWidth
          />
          <TextField
            label="Task description"
            value={taskDescription}
            onChange={(event) => setTaskDescription(event.target.value)}
            disabled={isLocked}
            size="small"
            fullWidth
            multiline
            minRows={2}
          />
          <Box>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={handleAddTask}
              disabled={isLocked || taskTitle.trim().length === 0}
            >
              Add task
            </Button>
          </Box>
        </Stack>

        <PlanGapsSearchSection
          showSearch={showSearch}
          onShowSearch={() => setShowSearch(true)}
          isLocked={isLocked}
          entityType={EntityType.Task}
          organizationId={context.organizationId}
          projectId={context.projectId}
          onSelect={handleSearchSelect}
          searchButtonLabel="Search for tasks"
        />
      </Box>

      <Divider />

      <PlanGapsClarifyingSection
        questions={payload.clarificationQuestions.tasks}
        answers={clarifyingAnswers}
        onChange={updateClarifyingAnswers}
        isLocked={isLocked}
      />
    </Stack>
  );
};
