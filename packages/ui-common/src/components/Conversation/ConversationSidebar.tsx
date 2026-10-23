import { Box, Paper, Typography, Divider, ButtonBase } from "@mui/material";
import { useMemo } from "react";
import CheckCircle from "@mui/icons-material/CheckCircle";
import Circle from "@mui/icons-material/Circle";
import RadioButtonUnchecked from "@mui/icons-material/RadioButtonUnchecked";
import { SlideRight, ProgressBar, StaggerChildren } from "../../animations";
import { type ConversationStepData } from "./ConversationStep";
import { ConversationStep } from "./ConversationStep";
import { type MessageResponseDto } from "../../api";

export interface ConversationSidebarProps {
  steps: ConversationStepData[];
  onStepClick?: (stepIndex: number, message: MessageResponseDto) => void;
  stepCount?: number;
  className?: string;
  sidebarMode?: "full" | "minimal";
  combineSameSections?: boolean;
}

export const ConversationSidebar = ({
  steps,
  onStepClick,
  stepCount,
  className,
  sidebarMode = "full",
  combineSameSections = false,
}: ConversationSidebarProps) => {
  const stepsToRender = useMemo(
    () => combineSteps(steps, combineSameSections),
    [steps, combineSameSections]
  );

  const handleStepClick = (step: ConversationStepData) => {
    if (onStepClick) {
      onStepClick(step.index, step.message);
    }

    // If it's the first step (index 0), scroll to top of page
    if (step.index === 0) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const isIndeterminate = stepCount === -1;
  const completedSteps = stepsToRender.filter(
    (step) => step.isCompleted
  ).length;
  const totalSteps = stepsToRender.length;

  if (sidebarMode === "minimal") {
    return (
      <SlideRight duration="medium">
        <Box
          sx={{
            width: {
              xs: "100%",
              sm: "280px",
            },
            maxWidth: {
              xs: "100%",
              sm: "280px",
            },
            minWidth: {
              xs: "100%",
              sm: "280px",
            },
            maxHeight: "calc(100vh - 64px)",
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
            zIndex: 1100,
          }}
          className={className}
        >
          <Box
            sx={{
              flex: 1,
              overflow: "auto",
              p: 1,
              display: "flex",
              flexDirection: "column",
              gap: 0.5,
            }}
          >
            {stepsToRender.length === 0 ? (
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  textAlign: "center",
                  py: 2,
                }}
              >
                No conversation steps available
              </Typography>
            ) : (
              stepsToRender.map((step) => (
                <ButtonBase
                  key={step.id}
                  onClick={
                    step.isCompleted ? () => handleStepClick(step) : undefined
                  }
                  disabled={!step.isCompleted}
                  sx={{
                    justifyContent: "flex-start",
                    textAlign: "left",
                    width: "100%",
                    borderRadius: 1,
                    px: 1,
                    py: 0.75,
                    gap: 1,
                    backgroundColor: step.isActive
                      ? "primary.50"
                      : "transparent",
                    "&:hover": step.isCompleted
                      ? {
                          backgroundColor: "action.hover",
                        }
                      : undefined,
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center" }}>
                    {step.isCompleted ? (
                      <CheckCircle
                        sx={{ color: "success.main", fontSize: 18 }}
                      />
                    ) : step.isActive ? (
                      <Circle sx={{ color: "primary.main", fontSize: 18 }} />
                    ) : (
                      <RadioButtonUnchecked
                        sx={{ color: "grey.400", fontSize: 18 }}
                      />
                    )}
                  </Box>
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: step.isActive ? 600 : 500,
                      color: step.isActive ? "primary.main" : "text.primary",
                      opacity: step.isCompleted ? 1 : 0.6,
                    }}
                  >
                    {step.title}
                  </Typography>
                </ButtonBase>
              ))
            )}
          </Box>
        </Box>
      </SlideRight>
    );
  }

  return (
    <SlideRight duration="medium">
      <Paper
        elevation={2}
        sx={{
          width: {
            xs: "calc(100vw - 48px)",
            sm: "240px",
            md: "280px",
            lg: "320px",
            xl: "480px",
          },
          // height: "fit-content",
          maxHeight: "calc(100vh - 64px)",
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          borderRadius: 2,
          zIndex: 1100,
        }}
        className={className}
      >
        {/* Header */}
        <Box sx={{ p: 3, pb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
            Conversation Progress
          </Typography>
          {!isIndeterminate && (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {completedSteps} of {totalSteps} steps completed
            </Typography>
          )}

          {/* Progress indicator */}
          {!isIndeterminate && (
            <Box sx={{ mt: 2 }}>
              <ProgressBar
                progress={
                  totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0
                }
                height={6}
                backgroundColor="grey.200"
                progressColor="#2196f3"
                duration="slow"
              />
            </Box>
          )}
        </Box>

        <Divider />

        {/* Steps List */}
        <Box
          sx={{
            flex: 1,
            overflow: "auto",
            p: 2,
            "&::-webkit-scrollbar": {
              width: 6,
            },
            "&::-webkit-scrollbar-track": {
              backgroundColor: "grey.100",
              borderRadius: 3,
            },
            "&::-webkit-scrollbar-thumb": {
              backgroundColor: "grey.400",
              borderRadius: 3,
              "&:hover": {
                backgroundColor: "grey.500",
              },
            },
          }}
        >
          {stepsToRender.length === 0 ? (
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                textAlign: "center",
                py: 4,
              }}
            >
              No conversation steps available
            </Typography>
          ) : (
            <StaggerChildren stagger={0.1}>
              {stepsToRender.map((step) => (
                <ConversationStep
                  key={step.id}
                  step={step}
                  orientation="vertical"
                  onClick={handleStepClick}
                />
              ))}
            </StaggerChildren>
          )}
        </Box>
      </Paper>
    </SlideRight>
  );
};

const combineSteps = (
  steps: ConversationStepData[],
  combineSameSections: boolean
): ConversationStepData[] => {
  if (!combineSameSections) {
    return steps;
  }

  const seenTitles = new Set<string>();
  const reversed: ConversationStepData[] = [];

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (seenTitles.has(step.title)) {
      continue;
    }

    seenTitles.add(step.title);
    reversed.push(step);
  }

  return reversed.reverse();
};
