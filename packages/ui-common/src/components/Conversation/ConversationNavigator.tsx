import { Box, Paper, Stepper, Typography } from "@mui/material";
import { motion } from "motion/react";
import { useMemo } from "react";
import { type MessageResponseDto, type SystemMessageData } from "../../api";
import { ConversationSidebar } from "./ConversationSidebar";
import { ConversationStep } from "./ConversationStep";
import { getConversationSystemThread, isAgentHiddenSystemMessage } from "./utils";

export type ConversationNavigatorOrientation = "horizontal" | "vertical";

export interface ConversationNavigatorProps {
  /**
   * Active conversation containing messages
   */
  messages: MessageResponseDto[];

  /**
   * Display orientation - horizontal stepper or vertical sidebar
   */
  orientation: ConversationNavigatorOrientation;

  /**
   * Current active step/message index
   */
  activeStep?: number;

  /**
   * Optionally set the step count or use -1 to indicate indeterminate
   */
  stepCount?: number;

  /**
   * Optional title for the navigator
   */
  title?: string;

  /**
   * Optional subtitle
   */
  subtitle?: string;

  /**
   * Callback when a step is clicked (for vertical navigation)
   */
  onStepClick?: (stepIndex: number, message: MessageResponseDto) => void;

  /**
   * Whether to show progress bar (horizontal only)
   */
  showProgress?: boolean;

  /**
   * Custom className for styling
   */
  className?: string;

  /**
   * Timeline rendering mode for the sidebar.
   */
  sidebarMode?: "full" | "minimal";

  /**
   * When true, combine repeated sections and link to the latest entry.
   */
  combineSameSections?: boolean;
}

export const ConversationNavigator = ({
  messages,
  orientation = "horizontal",
  activeStep = 0,
  stepCount,
  title,
  subtitle,
  onStepClick,
  showProgress = true,
  className,
  sidebarMode = "full",
  combineSameSections = false,
}: ConversationNavigatorProps) => {
  /**
   * Extract system messages with titles for navigation
   */
  const navigationSteps = useMemo(() => {
    const systemMessages = getConversationSystemThread(messages).systemMessages;

    return systemMessages
      .map((msg, index) => ({ msg, index }))
      .filter(({ msg }) => msg.type !== "SYSTEM" || !isAgentHiddenSystemMessage(msg))
      .map(({ msg, index }) => {
        let title = (msg.data as SystemMessageData).title;

        // Custom titles based on message type
        if (msg.data.type === "INTEGRATIONS") {
          title = "Add Integrations";
        } else if (msg.data.type === "INITIATIVES") {
          title = "Refine Initiatives";
        } else if (!title) {
          if (!msg.data.response) {
            title = "System Message";
          } else if (/Processing \w+ node/i.test(msg.data.response)) {
            title = "Processing";
          } else {
            title = `${msg.data.response.substr(0, 24)}${
              msg.data.response.length > 24 ? "..." : ""
            }`;
          }
        }
        return {
          id: msg.id,
          title,
          message: msg,
          index,
          isCompleted: index < activeStep,
          isActive: index === activeStep,
        };
      })
      .filter(({ title }) => title !== "Processing");
  }, [messages, activeStep]);

  const totalSteps = navigationSteps.length;
  const progressPercentage =
    totalSteps > 0 ? ((activeStep + 1) / totalSteps) * 100 : 0;

  if (orientation === "vertical") {
    return (
      <ConversationSidebar
        steps={navigationSteps}
        stepCount={stepCount}
        onStepClick={onStepClick}
        className={className}
        sidebarMode={sidebarMode}
        combineSameSections={combineSameSections}
      />
    );
  }

  // Horizontal orientation
  return (
    <Box sx={{ width: "100%" }} className={className}>
      {/* Header */}
      {(title || subtitle) && (
        <Paper elevation={3} variant="banner" sx={{ mb: 3 }}>
          {title && (
            <Typography variant="h3" gutterBottom>
              {title}
            </Typography>
          )}
          {subtitle && <Typography variant="h6">{subtitle}</Typography>}
        </Paper>
      )}

      {/* Horizontal Stepper */}
      {navigationSteps.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Stepper activeStep={activeStep}>
            {navigationSteps.map((step) => (
              <ConversationStep
                key={step.id}
                step={step}
                orientation="horizontal"
              />
            ))}
          </Stepper>
        </Box>
      )}

      {/* Progress Bar */}
      {showProgress && totalSteps > 0 && (
        <Box sx={{ width: "100%", mb: 2 }}>
          <Box
            sx={{
              height: 4,
              backgroundColor: "grey.200",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progressPercentage}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              style={{
                height: "100%",
                backgroundColor: "#2196f3",
                borderRadius: 2,
              }}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
};
