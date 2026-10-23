import React from "react";
import { Box, Card, CardContent, Stack, Typography } from "@mui/material";
import { TargetEntityType, WorkStatus } from "../../api";
import type {
  PlanStageStandardTask,
  PlanStageWorkItem,
} from "../../data/plans/canonicalPlan";
import { InteractionComponent } from "../InteractionComponent";

export interface PlanStageStepperCardProps {
  stage: PlanStageWorkItem;
  isActive: boolean;
  isSelected: boolean;
  previewTask: PlanStageStandardTask | null;
  previewLabel: string;
  totalTasks: number;
  completedTasks: number;
  onClick?: (stageId: string) => void;
}

const getStageDescription = (stage: PlanStageWorkItem): string | null => {
  const description = stage.sections
    ?.find((section) => section.key === "description")
    ?.materializedMarkdown.trim();
  return description || null;
};

export const PlanStageStepperCard: React.FC<PlanStageStepperCardProps> = ({
  stage,
  isActive,
  isSelected,
  previewTask,
  previewLabel,
  totalTasks,
  completedTasks,
  onClick,
}) => {
  const description = getStageDescription(stage);
  const isComplete = stage.status === WorkStatus.Completed;
  const progressPercentage =
    totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

  const card = (
    <Card
      onClick={() => onClick?.(stage.id)}
      data-testid="plan-stage-stepper-card"
      data-work-item-id={stage.id}
      sx={{
        minWidth: 280,
        maxWidth: 320,
        borderRadius: "8px",
        position: "relative",
        boxShadow: isActive ? 0 : 2,
        border: isActive ? 0 : isSelected ? 3 : 1,
        borderColor: isSelected ? "primary.main" : "divider",
        backgroundColor: isActive ? "rgb(0, 106, 119)" : "background.paper",
        transition: "all 0.3s ease-in-out",
        cursor: onClick ? "pointer" : "default",
        "&:hover": onClick ? { boxShadow: 4 } : {},
      }}
    >
      <CardContent sx={{ pb: 0, pt: 1, "&:last-child": { pb: 0 } }}>
        <Stack spacing={0.75}>
          <Typography
            variant="subtitle1"
            fontWeight={600}
            sx={{ color: isActive ? "white" : "text.primary" }}
          >
            {stage.name}
          </Typography>

          {description && (
            <Typography
              variant="body2"
              sx={{
                color: isActive ? "rgba(255, 255, 255, 0.8)" : "text.secondary",
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                minHeight: "2.5em",
              }}
            >
              {description}
            </Typography>
          )}

          {previewTask ? (
            <Box>
              <Typography
                variant="caption"
                sx={{
                  color: isActive
                    ? "rgba(255, 255, 255, 0.7)"
                    : "text.secondary",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  fontSize: "0.65rem",
                }}
              >
                {previewLabel}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: isActive ? "white" : "text.primary",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontWeight: 500,
                  fontStyle: "italic",
                  mt: 0.25,
                }}
              >
                {previewTask.name}
              </Typography>
            </Box>
          ) : isComplete ? (
            <Typography
              variant="body2"
              sx={{
                color: "success.main",
                fontWeight: 600,
                fontStyle: "italic",
              }}
            >
              Completed ✓
            </Typography>
          ) : null}
        </Stack>
      </CardContent>

      {!isComplete && (
        <Box
          sx={{
            position: "relative",
            height: 20,
            mt: 2,
            backgroundColor: isActive ? "rgba(255, 255, 255, 0.2)" : "divider",
            borderBottomLeftRadius: 6,
            borderBottomRightRadius: 6,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            px: 1.5,
          }}
        >
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              width: `${progressPercentage}%`,
              backgroundColor:
                progressPercentage === 100
                  ? "success.main"
                  : progressPercentage === 0
                  ? "transparent"
                  : "primary.main",
              transition: "width 0.3s ease-in-out",
            }}
          />
          <Typography
            variant="caption"
            sx={{
              position: "relative",
              zIndex: 1,
              color: isActive ? "white" : "text.secondary",
              fontSize: "0.65rem",
              fontWeight: 500,
            }}
          >
            {completedTasks}/{totalTasks} tasks completed
          </Typography>
        </Box>
      )}
    </Card>
  );

  return (
    <InteractionComponent
      entityId={stage.id}
      entityType={TargetEntityType.Task}
      entitySubtype={stage.type}
      hasProposalSupport={stage.hasProposalSupport ?? true}
      entityTitle={stage.name}
      organizationId={stage.organizationId}
      projectId={stage.projectId}
    >
      {card}
    </InteractionComponent>
  );
};
