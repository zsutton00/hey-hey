import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { InitiativeResponseDto } from "../../../../api";
import { useStepperCompletion } from "./useStepperCompletion";

interface UseInitiativeStepperReturn {
  currentIndex: number;
  currentInitiative: InitiativeResponseDto | null;
  totalInitiatives: number;
  progress: number;
  isComplete: boolean;
  reviewedInitiatives: Set<string>;
  keptInitiatives: Set<string>;
  keptCount: number;
  goToNext: () => void;
  goToPrevious: () => void;
  goToIndex: (index: number) => void;
  markAsKept: (id: string) => void;
  markAsRejected: (id: string) => void;
  getCompletionStats: () => {
    total: number;
    reviewed: number;
    kept: number;
    rejected: number;
    percentComplete: number;
  };
}

const POSITION_STORAGE_KEY = (conversationId: string): string =>
  `stepper-position-${conversationId}`;

const loadPosition = (conversationId: string): number => {
  try {
    const stored = localStorage.getItem(POSITION_STORAGE_KEY(conversationId));
    if (stored) {
      const { index } = JSON.parse(stored);
      return typeof index === "number" ? index : 0;
    }
  } catch (error) {
    console.warn("Failed to load stepper position from localStorage:", error);
  }
  return 0;
};

const savePosition = (conversationId: string, index: number): void => {
  try {
    localStorage.setItem(
      POSITION_STORAGE_KEY(conversationId),
      JSON.stringify({ index })
    );
  } catch (error) {
    console.warn("Failed to save stepper position to localStorage:", error);
  }
};

/**
 * Hook for managing initiative stepper navigation and state.
 * Integrates with useStepperCompletion for tracking reviewed/kept initiatives.
 * Persists position to localStorage and supports URL-based restoration.
 */
export const useInitiativeStepper = ({
  initiatives,
  conversationId,
}: {
  initiatives: InitiativeResponseDto[];
  conversationId: string;
}): UseInitiativeStepperReturn => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Get completion tracking
  const {
    reviewedInitiatives,
    keptInitiatives,
    isComplete,
    keptCount,
    markReviewed,
    getCompletionStats,
  } = useStepperCompletion({
    initiatives,
    conversationId,
  });

  // Initialize index from URL param or localStorage
  const initialIndex = useMemo(() => {
    const stepParam = searchParams.get("returnToStep");
    if (stepParam) {
      const parsed = parseInt(stepParam, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed < initiatives.length) {
        return parsed;
      }
    }

    // Fall back to localStorage
    const storedIndex = loadPosition(conversationId);
    return Math.min(storedIndex, Math.max(0, initiatives.length - 1));
  }, [searchParams, conversationId, initiatives.length]);

  const [currentIndex, setCurrentIndex] = useState<number>(initialIndex);

  // Clear returnToStep param after restoration
  useEffect(() => {
    if (searchParams.has("returnToStep")) {
      setSearchParams((prev) => {
        const newParams = new URLSearchParams(prev);
        newParams.delete("returnToStep");
        return newParams;
      });
    }
  }, [searchParams, setSearchParams]);

  // Persist position to localStorage whenever it changes
  useEffect(() => {
    savePosition(conversationId, currentIndex);
  }, [currentIndex, conversationId]);

  // Ensure current index is within bounds
  useEffect(() => {
    if (initiatives.length > 0 && currentIndex >= initiatives.length) {
      setCurrentIndex(Math.max(0, initiatives.length - 1));
    }
  }, [initiatives.length, currentIndex]);

  // Calculate progress percentage
  const progress = useMemo(() => {
    if (initiatives.length === 0) return 0;
    return Math.round((reviewedInitiatives.size / initiatives.length) * 100);
  }, [reviewedInitiatives.size, initiatives.length]);

  // Get current initiative
  const currentInitiative = useMemo(() => {
    return initiatives[currentIndex] || null;
  }, [initiatives, currentIndex]);

  // Navigation methods
  const goToNext = useCallback(() => {
    if (currentIndex < initiatives.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  }, [currentIndex, initiatives.length]);

  const goToPrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex]);

  const goToIndex = useCallback(
    (index: number) => {
      if (index >= 0 && index < initiatives.length) {
        setCurrentIndex(index);
      }
    },
    [initiatives.length]
  );

  // Mark initiative as kept and advance
  const markAsKept = useCallback(
    (id: string) => {
      markReviewed(id, "kept");
      // Auto-advance if not on last card
      if (currentIndex < initiatives.length - 1) {
        goToNext();
      }
    },
    [markReviewed, currentIndex, initiatives.length, goToNext]
  );

  // Mark initiative as rejected and advance
  const markAsRejected = useCallback(
    (id: string) => {
      markReviewed(id, "rejected");
      // Auto-advance if not on last card
      if (currentIndex < initiatives.length - 1) {
        goToNext();
      }
    },
    [markReviewed, currentIndex, initiatives.length, goToNext]
  );

  return {
    currentIndex,
    currentInitiative,
    totalInitiatives: initiatives.length,
    progress,
    isComplete,
    reviewedInitiatives,
    keptInitiatives,
    keptCount,
    goToNext,
    goToPrevious,
    goToIndex,
    markAsKept,
    markAsRejected,
    getCompletionStats,
  };
};
