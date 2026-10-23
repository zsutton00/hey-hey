import CheckCircle from "@mui/icons-material/CheckCircle";
import Circle from "@mui/icons-material/Circle";
import RadioButtonUnchecked from "@mui/icons-material/RadioButtonUnchecked";
import { Box, Step as MuiStep, StepLabel, Typography } from "@mui/material";
import { SlideRight, ScaleIn } from "../../animations";
import { type MessageResponseDto } from "../../api";

export interface ConversationStepData {
  id: string;
  title: string;
  message: MessageResponseDto;
  index: number;
  isCompleted: boolean;
  isActive: boolean;
}

export interface ConversationStepProps {
  step: ConversationStepData;
  orientation: "horizontal" | "vertical";
  onClick?: (step: ConversationStepData) => void;
}

export const ConversationStep = ({
  step,
  orientation,
  onClick,
}: ConversationStepProps) => {
  const handleClick = () => {
    if (onClick && step.isCompleted) {
      onClick(step);
    }
  };

  if (orientation === "vertical") {
    return (
      <SlideRight delay={step.index * 0.1} duration="medium">
        <Box
          component={step.isCompleted ? "button" : "div"}
          onClick={step.isCompleted ? handleClick : undefined}
          sx={{
            display: "flex",
            alignItems: "center",
            p: 2,
            mb: 1,
            borderRadius: 2,
            cursor: step.isCompleted ? "pointer" : "default",
            backgroundColor: step.isActive
              ? "primary.50"
              : step.isCompleted
              ? "grey.50"
              : "transparent",
            border: step.isActive ? "2px solid" : "1px solid",
            borderColor: step.isActive
              ? "primary.main"
              : step.isCompleted
              ? "success.main"
              : "grey.300",
            "&:hover": step.isCompleted
              ? {
                  backgroundColor: "primary.100",
                  borderColor: "primary.main",
                }
              : {},
            transition: "all 0.2s ease-in-out",
            width: "100%",
            textAlign: "left",
            ...(step.isCompleted && {
              background: "none",
              font: "inherit",
              outline: "none",
            }),
          }}
        >
          {/* Icon */}
          <Box sx={{ mr: 2, display: "flex", alignItems: "center" }}>
            {step.isCompleted ? (
              <ScaleIn springy>
                <CheckCircle sx={{ color: "success.main", fontSize: 24 }} />
              </ScaleIn>
            ) : step.isActive ? (
              <ScaleIn springy>
                <Circle sx={{ color: "primary.main", fontSize: 24 }} />
              </ScaleIn>
            ) : (
              <ScaleIn>
                <RadioButtonUnchecked
                  sx={{ color: "grey.400", fontSize: 24 }}
                />
              </ScaleIn>
            )}
          </Box>

          {/* Content */}
          <Box sx={{ flex: 1 }}>
            <Typography
              variant="body1"
              sx={{
                fontWeight: step.isActive ? 600 : step.isCompleted ? 500 : 400,
                color: step.isActive
                  ? "primary.main"
                  : step.isCompleted
                  ? "text.primary"
                  : "text.secondary",
              }}
            >
              {step.title}
            </Typography>

            {/* Show response preview if completed */}
            {step.isCompleted && step.message.data.response && (
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  mt: 0.5,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {step.message.data.response}
              </Typography>
            )}
          </Box>
        </Box>
      </SlideRight>
    );
  }

  // Horizontal orientation (MUI Stepper)
  return (
    <MuiStep completed={step.isCompleted}>
      <ScaleIn>
        <StepLabel
          slots={{
            stepIcon: ({ completed, active }) => (
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: completed
                    ? "#4caf50"
                    : active
                    ? "#2196f3"
                    : "#e0e0e0",
                  color: completed || active ? "white" : "#666",
                  fontSize: "14px",
                  fontWeight: "bold",
                  border: active ? "2px solid #1976d2" : "none",
                  transform: active ? "scale(1.1)" : "scale(1)",
                  transition: "all 0.3s ease",
                }}
              >
                {completed ? (
                  <ScaleIn springy>
                    <CheckCircle sx={{ fontSize: 20 }} />
                  </ScaleIn>
                ) : (
                  <span>{step.index + 1}</span>
                )}
              </Box>
            ),
          }}
        >
          {step.title}
        </StepLabel>
      </ScaleIn>
    </MuiStep>
  );
};
