import { useModalState } from "../../../Modals/useModalState";
import { FunctionalDialog as Dialog } from "../../../Modals/FunctionalDialog";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  Typography,
} from "@mui/material";
import { AnimatePresence, motion } from "motion/react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type {
  GenerationSystemMessageData,
  SuggestionDecisionMetadata,
} from "../../../../api";
import { SuggestionType as SuggestionTypeEnum } from "../../../../api";
import { useUserAction } from "../../../../contexts/TrackingContext";
import { useConversationContext } from "../../../Conversation/Components/ConversationContext";
import { useInitiatives } from "../../../../data/hooks/useInitiatives";
import { useSuggestionDecision } from "../../../../data/hooks/useSuggestionDecision";
import type { FieldComponentProps } from "../types";
import { InitiativeStepperCard } from "./InitiativeStepperCard";
import { StepperCompletionScreen } from "./StepperCompletionScreen";
import { StepperIntroScreen } from "./StepperIntroScreen";
import { useInitiativeStepper } from "./useInitiativeStepper";
import {
  buildSuggestionId,
  type SuggestionDecisionStatus,
} from "../../../Conversation/hooks/useSuggestionDecisions";

export interface InitiativeStepperFieldProps extends Omit<
  FieldComponentProps,
  "onChange"
> {
  value: GenerationSystemMessageData;
  onChange?: (value: unknown) => void;
}

export const InitiativeStepperField: React.FC<InitiativeStepperFieldProps> = ({
  context,
  config,
  onChange,
}) => {
  const { trackInitiative } = useUserAction();
  const { suggestionDecisions } = useConversationContext();
  const decisionMutation = useSuggestionDecision();

  // Load conversation initiatives
  const {
    initiatives,
    isLoading: isLoadingInitiatives,
    error: initiativesError,
    remove,
  } = useInitiatives(
    context.organizationId,
    context.projectId,
    context.conversationId,
    { enabled: !!context.conversationId },
  );

  // Stepper state management
  const {
    currentIndex,
    currentInitiative,
    totalInitiatives,
    progress,
    isComplete,
    reviewedInitiatives,
    keptCount,
    markAsKept,
    markAsRejected,
  } = useInitiativeStepper({
    initiatives,
    conversationId: context.conversationId,
  });

  // UI state
  const [showIntro, setShowIntro] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm, showDeleteConfirmOwnerKey] =
    useModalState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [slideDirection, setSlideDirection] = useState<"left" | "right">(
    "right",
  );

  // Update form validation when complete
  useEffect(() => {
    if (onChange && isComplete) {
      onChange(
        `user reviewed ${totalInitiatives} initiatives and kept ${keptCount}`,
      );
    }
  }, [onChange, isComplete, totalInitiatives, keptCount]);

  const recordDecision = useCallback(
    (initiativeId: string, accepted: boolean) => {
      const suggestionId = buildSuggestionId(context.messageId, initiativeId);
      if (!suggestionId) {
        return;
      }

      if (!context.conversationId || !context.messageId) {
        console.warn("Missing context for initiative decision", {
          initiativeId,
          hasConversationId: !!context.conversationId,
          hasMessageId: !!context.messageId,
        });
        return;
      }

      const metadata: SuggestionDecisionMetadata = {
        kind: "PROPOSED_INITIATIVE",
        initiativeId,
      };

      const optimisticDecision: SuggestionDecisionStatus = {
        id: suggestionId,
        type: SuggestionTypeEnum.GeneratedInitiative,
        accepted,
        decidedBy: null,
        createdAt: new Date().toISOString(),
        sourceConversationId: context.conversationId,
        sourceMessageId: context.messageId,
        metadata,
      };

      suggestionDecisions.upsertDecision(optimisticDecision);

      decisionMutation
        .mutate({
          organizationId: context.organizationId,
          type: SuggestionTypeEnum.GeneratedInitiative,
          suggestionId,
          accepted,
          sourceConversationId: context.conversationId,
          sourceMessageId: context.messageId,
          metadata,
        })
        .then((decision) => {
          suggestionDecisions.upsertDecision(decision);
        })
        .catch((error) => {
          console.error("Failed to record initiative decision:", error);
        });
    },
    [context, decisionMutation, suggestionDecisions],
  );

  // Handle keep initiative
  const handleKeep = useCallback(() => {
    if (!currentInitiative) return;

    recordDecision(currentInitiative.id, true);
    trackInitiative("approve", {
      initiativeId: currentInitiative.id,
      initiativeName: currentInitiative.name,
    });

    setSlideDirection("left");
    markAsKept(currentInitiative.id);
  }, [currentInitiative, markAsKept, recordDecision, trackInitiative]);

  // Handle reject initiative (show confirmation)
  const handleRejectClick = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  // Handle reject confirmation
  const handleRejectConfirm = useCallback(async () => {
    if (!currentInitiative) return;

    setIsDeleting(true);
    try {
      // Delete from backend
      await remove(currentInitiative.id);

      recordDecision(currentInitiative.id, false);
      trackInitiative("reject", {
        initiativeId: currentInitiative.id,
        initiativeName: currentInitiative.name,
      });

      // Mark as rejected and advance
      setSlideDirection("left");
      markAsRejected(currentInitiative.id);
    } catch (error) {
      console.error("Failed to delete initiative:", error);
      // Show error - don't advance or mark as rejected
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [
    currentInitiative,
    markAsRejected,
    recordDecision,
    remove,
    trackInitiative,
  ]);

  // Handle start review (dismiss intro)
  const handleStartReview = useCallback(() => {
    setShowIntro(false);
  }, []);

  const currentDecisionStatus = useMemo(() => {
    if (!currentInitiative) {
      return undefined;
    }

    const suggestionId = buildSuggestionId(
      context.messageId,
      currentInitiative.id,
    );
    const decision = suggestionDecisions.getDecision(suggestionId);

    if (decision?.accepted === true) {
      return "accepted";
    }

    if (decision?.accepted === false) {
      return "rejected";
    }

    return undefined;
  }, [context.messageId, currentInitiative, suggestionDecisions]);

  useEffect(() => {
    if (!currentInitiative || !currentDecisionStatus) {
      return;
    }

    if (reviewedInitiatives.has(currentInitiative.id)) {
      return;
    }

    if (currentDecisionStatus === "accepted") {
      markAsKept(currentInitiative.id);
      return;
    }

    markAsRejected(currentInitiative.id);
  }, [
    currentDecisionStatus,
    currentInitiative,
    markAsKept,
    markAsRejected,
    reviewedInitiatives,
  ]);

  // Show loading state
  if (isLoadingInitiatives) {
    return (
      <Box data-testid={`initiative-stepper-field-${config.field}`}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            py: 4,
          }}
        >
          <CircularProgress size={24} sx={{ mr: 2 }} />
          <Typography variant="body2" color="text.secondary">
            Loading initiatives...
          </Typography>
        </Box>
      </Box>
    );
  }

  // Show error state
  if (initiativesError) {
    return (
      <Box data-testid={`initiative-stepper-field-${config.field}`}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {initiativesError instanceof Error
            ? initiativesError.message
            : "Failed to load initiatives"}
        </Alert>
      </Box>
    );
  }

  // Show "no initiatives" state
  if (totalInitiatives === 0) {
    return (
      <Box data-testid={`initiative-stepper-field-${config.field}`}>
        <Alert severity="info" sx={{ mb: 2 }}>
          No initiatives remaining.
        </Alert>
      </Box>
    );
  }

  // Main content wrapper
  return (
    <Card
      data-testid={`initiative-stepper-field-${config.field}`}
      data-what="huh"
      variant="outlined"
      sx={{ mb: 2 }}
    >
      <CardContent>
        {/* Show intro screen first */}
        {showIntro && (
          <StepperIntroScreen
            initiativeCount={totalInitiatives}
            onStart={handleStartReview}
          />
        )}

        {/* Show completion screen when all reviewed */}
        {!showIntro && isComplete && (
          <StepperCompletionScreen keptCount={keptCount} />
        )}

        {/* Show stepper when not intro and not complete */}
        {!showIntro && !isComplete && (
          <>
            {/* Progress bar */}
            <Box sx={{ mb: 3 }}>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  mb: 1,
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  Initiative Review
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Step {currentIndex + 1} of {totalInitiatives}
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={progress}
                sx={{
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: "action.hover",
                  "& .MuiLinearProgress-bar": {
                    borderRadius: 3,
                    transition: "transform 0.4s ease",
                  },
                }}
              />
            </Box>

            {/* Animated card stepper */}
            <Box sx={{ position: "relative", minHeight: "300px" }}>
              <AnimatePresence mode="wait">
                {currentInitiative && (
                  <motion.div
                    key={currentInitiative.id}
                    initial={{
                      x: slideDirection === "right" ? 100 : -100,
                      opacity: 0,
                    }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{
                      x: slideDirection === "right" ? -100 : 100,
                      opacity: 0,
                    }}
                    transition={{ duration: 0.3 }}
                  >
                    <InitiativeStepperCard
                      initiative={currentInitiative}
                      onKeep={handleKeep}
                      onReject={handleRejectClick}
                      decisionStatus={currentDecisionStatus}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </Box>
          </>
        )}

        {/* Delete confirmation dialog */}
        <Dialog
          ownerKey={showDeleteConfirmOwnerKey}
          open={showDeleteConfirm}
          onClose={() => !isDeleting && setShowDeleteConfirm(false)}
        >
          <DialogTitle>Are you sure?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              This will permanently remove this initiative. You won't be able to
              undo this action.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => setShowDeleteConfirm(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRejectConfirm}
              color="error"
              variant="contained"
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Yes, remove it"}
            </Button>
          </DialogActions>
        </Dialog>
      </CardContent>
    </Card>
  );
};
