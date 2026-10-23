import { useState, useEffect, useCallback } from "react";

export interface WalkthroughStep {
  id: string;
  title: string;
  content: string;
  targetSelector?: string;
  position?: "top" | "bottom" | "left" | "right";
  showSkipButton?: boolean;
  isLastStep?: boolean;
}

export interface UseWalkthroughProps {
  /** Unique key for localStorage persistence */
  walkthroughKey: string;
  /** Array of walkthrough steps */
  steps: WalkthroughStep[];
  /** Whether to auto-start the walkthrough */
  autoStart?: boolean;
}

export interface UseWalkthroughReturn {
  /** Whether the walkthrough is currently active */
  isActive: boolean;
  /** Current step index (0-based) */
  currentStepIndex: number;
  /** Current step object */
  currentStep: WalkthroughStep | null;
  /** Whether we're on the first step */
  isFirstStep: boolean;
  /** Whether we're on the last step */
  isLastStep: boolean;
  /** Start the walkthrough */
  startWalkthrough: () => void;
  /** Go to next step */
  nextStep: () => void;
  /** Go to previous step */
  previousStep: () => void;
  /** Skip/finish the walkthrough */
  finishWalkthrough: () => void;
  /** Reset walkthrough completion status */
  resetWalkthrough: () => void;
  /** Check if walkthrough has been completed before */
  hasCompletedBefore: boolean;
}

export const useWalkthrough = ({
  walkthroughKey,
  steps,
  autoStart = false,
}: UseWalkthroughProps): UseWalkthroughReturn => {
  const [isActive, setIsActive] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [hasCompletedBefore, setHasCompletedBefore] = useState(false);

  // Check localStorage on mount
  useEffect(() => {
    const completed = localStorage.getItem(
      `walkthrough-${walkthroughKey}-completed`
    );
    const hasCompleted = completed === "true";
    setHasCompletedBefore(hasCompleted);

    // Auto-start if not completed and autoStart is true
    if (!hasCompleted && autoStart && steps.length > 0) {
      setIsActive(true);
    }
  }, [walkthroughKey, autoStart, steps.length]);

  const currentStep = steps[currentStepIndex] || null;
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === steps.length - 1;

  const startWalkthrough = useCallback(() => {
    if (steps.length > 0) {
      setCurrentStepIndex(0);
      setIsActive(true);
    }
  }, [steps.length]);

  const nextStep = useCallback(() => {
    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    } else {
      finishWalkthrough();
    }
  }, [currentStepIndex, steps.length]);

  const previousStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  }, [currentStepIndex]);

  const finishWalkthrough = useCallback(() => {
    setIsActive(false);
    setCurrentStepIndex(0);
    localStorage.setItem(`walkthrough-${walkthroughKey}-completed`, "true");
    setHasCompletedBefore(true);
  }, [walkthroughKey]);

  const resetWalkthrough = useCallback(() => {
    localStorage.removeItem(`walkthrough-${walkthroughKey}-completed`);
    setHasCompletedBefore(false);
    setIsActive(false);
    setCurrentStepIndex(0);
  }, [walkthroughKey]);

  return {
    isActive,
    currentStepIndex,
    currentStep,
    isFirstStep,
    isLastStep,
    startWalkthrough,
    nextStep,
    previousStep,
    finishWalkthrough,
    resetWalkthrough,
    hasCompletedBefore,
  };
};
