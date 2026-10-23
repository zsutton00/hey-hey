import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import {
  Box,
  Button,
  IconButton,
  Paper,
  Stack,
  Step,
  StepButton,
  Stepper,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import React, { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { shouldReduceMotion, transitions } from "../../../animations/variants";
import type { FieldComponentProps } from "./types";
import {
  type PlanStageProposalFieldConfig,
  type PlanStageProposalStageValue,
  type PlanStageProposalValue,
  PlanStageProposalNextAction,
} from "./types";
import {
  createPlanStageProposalValue,
  createStageFeedbackFromStages,
  normalizePlanStageProposalValue,
} from "./planStageProposalUtils";

const stepMotionOffset = shouldReduceMotion() ? 0 : 30;
const stepContentVariants = {
  enter: (direction: number) => ({
    x: direction * stepMotionOffset,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({
    x: direction * -stepMotionOffset,
    opacity: 0,
  }),
};

export interface PlanStageProposalFieldProps
  extends Omit<FieldComponentProps<PlanStageProposalValue>, "config"> {
  config: PlanStageProposalFieldConfig;
}

export const PlanStageProposalField: React.FC<PlanStageProposalFieldProps> = ({
  config,
  value,
  onChange,
  disabled = false,
  isSubmitted = false,
  context,
}) => {
  const payload = config.payload;
  const baseValue = useMemo(() => {
    if (!payload) {
      return null;
    }
    return createPlanStageProposalValue(payload);
  }, [payload]);
  const normalizedValue = useMemo(() => {
    if (!baseValue) {
      return null;
    }
    return normalizePlanStageProposalValue(value ?? baseValue, baseValue);
  }, [baseValue, value]);

  const [activeStageIndex, setActiveStageIndex] = React.useState(0);
  const stepperRef = React.useRef<HTMLDivElement>(null);
  const directionRef = React.useRef(1);
  const didHydrateRef = React.useRef(false);
  const storageKey = React.useMemo(() => {
    const conversationId = context.conversationId;
    return `plan-stage-proposal:${conversationId}:${config.field}`;
  }, [config.field, context.conversationId]);

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (!stored) {
        didHydrateRef.current = true;
        return;
      }
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) {
        setActiveStageIndex(parsed);
      }
    } catch (error) {
      console.error("Failed to read plan stage proposal progress:", error);
    } finally {
      didHydrateRef.current = true;
    }
  }, [storageKey]);

  React.useEffect(() => {
    if (!didHydrateRef.current) {
      return;
    }
    try {
      localStorage.setItem(storageKey, String(activeStageIndex));
    } catch (error) {
      console.error("Failed to persist plan stage proposal progress:", error);
    }
  }, [activeStageIndex, storageKey]);

  React.useEffect(() => {
    if (!normalizedValue) {
      return;
    }
    if (activeStageIndex > normalizedValue.stages.length) {
      setActiveStageIndex(0);
    }
  }, [activeStageIndex, normalizedValue]);

  React.useEffect(() => {
    if (!isSubmitted) {
      return;
    }
    try {
      localStorage.removeItem(storageKey);
    } catch (error) {
      console.error("Failed to clear plan stage proposal progress:", error);
    }
  }, [isSubmitted, storageKey]);

  const stages = useMemo(
    () => normalizedValue?.stages ?? [],
    [normalizedValue]
  );
  const stageCount = stages.length;

  const isLocked = disabled || isSubmitted;

  const resolveNextAction = React.useCallback(
    (stageIndex: number) =>
      stageIndex >= stageCount // final comments step or beyond
        ? PlanStageProposalNextAction.ReadyForNextStep
        : PlanStageProposalNextAction.ContinueRevising,
    [stageCount]
  );

  const updateStages = React.useCallback(
    (stages: PlanStageProposalStageValue[]) => {
      if (!normalizedValue) {
        return;
      }
      onChange?.({
        ...normalizedValue,
        stages,
        stageFeedback: createStageFeedbackFromStages(stages),
        nextAction: resolveNextAction(activeStageIndex),
      });
    },
    [normalizedValue, onChange, resolveNextAction, activeStageIndex]
  );

  const handleStageChange = React.useCallback(
    (index: number, updates: Partial<PlanStageProposalStageValue>) => {
      if (!normalizedValue) {
        return;
      }
      const updatedStages = stages.map((stage, stageIndex) =>
        stageIndex === index ? { ...stage, ...updates } : stage
      );
      updateStages(updatedStages);
    },
    [normalizedValue, stages, updateStages]
  );

  const handleUserMessageChange = (message: string) => {
    if (!normalizedValue) {
      return;
    }
    onChange?.({
      ...normalizedValue,
      userMessage: message,
      stageFeedback: createStageFeedbackFromStages(normalizedValue.stages),
      nextAction: resolveNextAction(activeStageIndex),
    });
  };

  const handleStageNavigation = (nextIndex: number) => {
    if (nextIndex < 0 || nextIndex > stageCount) {
      return;
    }
    directionRef.current = nextIndex > activeStageIndex ? 1 : -1;
    setActiveStageIndex(nextIndex);

    // Scroll to top of stepper
    if (stepperRef.current) {
      stepperRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    if (isLocked) {
      return;
    }
    if (!normalizedValue) {
      return;
    }
    const nextAction = resolveNextAction(nextIndex);
    if (normalizedValue.nextAction !== nextAction) {
      onChange?.({
        ...normalizedValue,
        nextAction,
      });
    }
  };

  React.useEffect(() => {
    if (isLocked) {
      return;
    }
    if (!normalizedValue) {
      return;
    }
    const nextAction = resolveNextAction(activeStageIndex);
    if (normalizedValue.nextAction !== nextAction) {
      onChange?.({
        ...normalizedValue,
        nextAction,
      });
    }
  }, [
    activeStageIndex,
    isLocked,
    normalizedValue,
    onChange,
    resolveNextAction,
  ]);

  if (!normalizedValue) {
    return (
      <Box sx={{ p: 2, color: "error.main" }}>
        <Typography>Missing plan stage proposal payload</Typography>
      </Box>
    );
  }

  const totalSteps = stageCount + 1; // stages + final comments
  const isFinalCommentsStep = activeStageIndex === stageCount;
  const activeStage = isFinalCommentsStep ? null : stages[activeStageIndex];
  const stepperMinWidth = Math.max(320, totalSteps * 160);
  const isFirstStage = activeStageIndex === 0;
  const isLastStage = activeStageIndex === totalSteps - 1;

  return (
    <Stack spacing={3} data-testid={`plan-stage-proposal-${config.field}`}>
      <Paper
        elevation={0}
        sx={{
          p: 2,
          backgroundColor: "primary.50",
          borderLeft: 4,
          borderColor: "primary.main",
        }}
      >
        <Stack spacing={1}>
          <Typography variant="h6" fontWeight={600}>
            Review Execution Stages
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Review and edit each stage's details • Accept or reject stages • Add
            feedback before approving the overall stage plan
          </Typography>
        </Stack>
      </Paper>

      <Box ref={stepperRef} sx={{ pb: 1 }}>
        <Stepper
          activeStep={activeStageIndex}
          alternativeLabel
          sx={{
            minWidth: stepperMinWidth,
            "& .MuiStepLabel-label": {
              whiteSpace: "normal",
              textAlign: "center",
            },
            "& .MuiStepLabel-labelContainer": {
              maxWidth: 160,
            },
          }}
        >
          {normalizedValue.stages.map((stage, index) => (
            <Step key={stage.sequenceOrder}>
              <StepButton onClick={() => handleStageNavigation(index)}>
                {stage.title}
              </StepButton>
            </Step>
          ))}
          <Step key="final-comments">
            <StepButton
              onClick={() =>
                handleStageNavigation(normalizedValue.stages.length)
              }
            >
              Review & Comments
            </StepButton>
          </Step>
        </Stepper>
      </Box>

      <AnimatePresence mode="wait" custom={directionRef.current}>
        <motion.div
          key={activeStageIndex}
          custom={directionRef.current}
          variants={stepContentVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={transitions.medium}
        >
          {isFinalCommentsStep ? (
            <Paper
              variant="outlined"
              sx={{
                p: 3,
              }}
            >
              <Stack spacing={2}>
                <Typography variant="h6" fontWeight={600}>
                  Final Review
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Add any overall guidance or concerns about the stage plan
                  before submitting.
                </Typography>
                <TextField
                  label="Any final comments"
                  value={normalizedValue.userMessage}
                  onChange={(event) =>
                    handleUserMessageChange(event.target.value)
                  }
                  disabled={isLocked}
                  fullWidth
                  multiline
                  minRows={4}
                  placeholder="Add any overall guidance or concerns for the stage plan"
                />
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Button
                    variant="text"
                    size="small"
                    type="button"
                    disabled={isLocked || isFirstStage}
                    onClick={() => handleStageNavigation(activeStageIndex - 1)}
                  >
                    Previous stage
                  </Button>
                  <Button
                    variant="text"
                    size="small"
                    type="button"
                    disabled={isLocked || isLastStage}
                    onClick={() => handleStageNavigation(activeStageIndex + 1)}
                  >
                    Next stage
                  </Button>
                </Box>
              </Stack>
            </Paper>
          ) : activeStage ? (
            <Paper
              variant="outlined"
              sx={{
                p: 3,
              }}
            >
              <Stack spacing={3}>
                <Typography variant="h6" fontWeight={600}>
                  Stage {activeStageIndex + 1}
                </Typography>

                <TextField
                  label="Stage name"
                  value={activeStage.title}
                  onChange={(event) =>
                    handleStageChange(activeStageIndex, {
                      title: event.target.value,
                    })
                  }
                  disabled={isLocked}
                  fullWidth
                />
                <TextField
                  label="Description"
                  value={activeStage.description}
                  onChange={(event) =>
                    handleStageChange(activeStageIndex, {
                      description: event.target.value,
                    })
                  }
                  disabled={isLocked}
                  fullWidth
                  multiline
                  minRows={3}
                />
                <Box
                  sx={{
                    display: "grid",
                    gap: 2,
                    gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                  }}
                >
                  <TextField
                    label="Purpose"
                    value={activeStage.purpose}
                    onChange={(event) =>
                      handleStageChange(activeStageIndex, {
                        purpose: event.target.value,
                      })
                    }
                    disabled={isLocked}
                    fullWidth
                    multiline
                    minRows={3}
                  />
                  <TextField
                    label="Timing"
                    value={activeStage.timing}
                    onChange={(event) =>
                      handleStageChange(activeStageIndex, {
                        timing: event.target.value,
                      })
                    }
                    disabled={isLocked}
                    fullWidth
                    multiline
                    minRows={3}
                  />
                </Box>
                <TextField
                  label="Stage comment"
                  value={activeStage.comment ?? ""}
                  onChange={(event) =>
                    handleStageChange(activeStageIndex, {
                      comment: event.target.value,
                    })
                  }
                  disabled={isLocked}
                  fullWidth
                  multiline
                  minRows={2}
                  placeholder="Add any feedback or concerns for this stage"
                />
                <Stack spacing={2}>
                  <Stack direction="row" spacing={1} justifyContent="center">
                    <IconButton
                      size="small"
                      onClick={() =>
                        handleStageChange(activeStageIndex, {
                          action: "accept",
                        })
                      }
                      disabled={isLocked}
                      sx={{
                        width: 28,
                        height: 28,
                        bgcolor:
                          activeStage.action === "accept"
                            ? "success.main"
                            : "success.50",
                        color:
                          activeStage.action === "accept"
                            ? "white"
                            : "success.main",
                        border: 1,
                        borderColor: "success.main",
                        "&:hover": {
                          bgcolor:
                            activeStage.action === "accept"
                              ? "success.dark"
                              : "success.100",
                        },
                        "&.Mui-disabled": {
                          opacity: 1,
                          bgcolor:
                            activeStage.action === "accept"
                              ? "success.main"
                              : "success.50",
                          color:
                            activeStage.action === "accept"
                              ? "white"
                              : "success.main",
                          borderColor: "success.main",
                        },
                      }}
                    >
                      <CheckIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() =>
                        handleStageChange(activeStageIndex, {
                          action: "reject",
                        })
                      }
                      disabled={isLocked}
                      sx={{
                        width: 28,
                        height: 28,
                        bgcolor:
                          activeStage.action === "reject"
                            ? "error.main"
                            : "error.50",
                        color:
                          activeStage.action === "reject"
                            ? "white"
                            : "error.main",
                        border: 1,
                        borderColor: "error.main",
                        "&:hover": {
                          bgcolor:
                            activeStage.action === "reject"
                              ? "error.dark"
                              : "error.100",
                        },
                        "&.Mui-disabled": {
                          opacity: 1,
                          bgcolor:
                            activeStage.action === "reject"
                              ? "error.main"
                              : "error.50",
                          color:
                            activeStage.action === "reject"
                              ? "white"
                              : "error.main",
                          borderColor: "error.main",
                        },
                      }}
                    >
                      <CloseIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Stack>
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Button
                      variant="text"
                      size="small"
                      type="button"
                      disabled={isLocked || isFirstStage}
                      onClick={() =>
                        handleStageNavigation(activeStageIndex - 1)
                      }
                    >
                      Previous stage
                    </Button>
                    <Tooltip
                      title={
                        !isLocked && activeStage.action === "pending"
                          ? "Accept or reject this stage to continue"
                          : ""
                      }
                    >
                      <span>
                        <Button
                          variant="text"
                          size="small"
                          type="button"
                          disabled={
                            isLocked || activeStage.action === "pending"
                          }
                          onClick={() =>
                            handleStageNavigation(activeStageIndex + 1)
                          }
                        >
                          Next stage
                        </Button>
                      </span>
                    </Tooltip>
                  </Box>
                </Stack>
              </Stack>
            </Paper>
          ) : (
            <Typography color="text.secondary">
              No stages available to review.
            </Typography>
          )}
        </motion.div>
      </AnimatePresence>
    </Stack>
  );
};
