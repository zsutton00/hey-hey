import { useState, useEffect, useMemo, useCallback } from "react";
import type { InitiativeResponseDto } from "../../../../api";

interface StepperState {
  reviewed: string[];
  kept: string[];
  lastUpdated: string;
}

interface CompletionStats {
  total: number;
  reviewed: number;
  kept: number;
  rejected: number;
  percentComplete: number;
}

interface UseStepperCompletionReturn {
  reviewedInitiatives: Set<string>;
  keptInitiatives: Set<string>;
  isComplete: boolean;
  keptCount: number;
  markReviewed: (id: string, action: "kept" | "rejected") => void;
  clearCompletion: () => void;
  getCompletionStats: () => CompletionStats;
}

const getStorageKey = (conversationId: string): string =>
  `initiative-stepper-${conversationId}`;

const loadFromStorage = (conversationId: string): StepperState => {
  try {
    const key = getStorageKey(conversationId);
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.warn("Failed to load stepper state from localStorage:", error);
  }

  return {
    reviewed: [],
    kept: [],
    lastUpdated: new Date().toISOString(),
  };
};

const saveToStorage = (conversationId: string, state: StepperState): void => {
  try {
    const key = getStorageKey(conversationId);
    localStorage.setItem(key, JSON.stringify(state));
  } catch (error) {
    console.warn("Failed to save stepper state to localStorage:", error);
  }
};

/**
 * Hook for managing initiative stepper completion tracking with localStorage persistence.
 * Tracks which initiatives have been reviewed and which were kept vs rejected.
 */
export const useStepperCompletion = ({
  initiatives,
  conversationId,
}: {
  initiatives: InitiativeResponseDto[];
  conversationId: string;
}): UseStepperCompletionReturn => {
  // Load initial state from localStorage
  const [state, setState] = useState<StepperState>(() =>
    loadFromStorage(conversationId)
  );

  // Clean up stale data - remove IDs that don't exist in current initiatives
  useEffect(() => {
    const validIds = new Set(initiatives.map((i) => i.id));
    const cleanedReviewed = state.reviewed.filter((id) => validIds.has(id));
    const cleanedKept = state.kept.filter((id) => validIds.has(id));

    if (
      cleanedReviewed.length !== state.reviewed.length ||
      cleanedKept.length !== state.kept.length
    ) {
      const newState = {
        reviewed: cleanedReviewed,
        kept: cleanedKept,
        lastUpdated: new Date().toISOString(),
      };
      setState(newState);
      saveToStorage(conversationId, newState);
    }
  }, [initiatives, state.reviewed, state.kept, conversationId]);

  // Persist state changes to localStorage
  useEffect(() => {
    saveToStorage(conversationId, state);
  }, [state, conversationId]);

  // Convert arrays to sets for efficient lookup
  const reviewedInitiatives = useMemo(
    () => new Set(state.reviewed),
    [state.reviewed]
  );

  const keptInitiatives = useMemo(() => new Set(state.kept), [state.kept]);

  // Check if all initiatives have been reviewed
  const isComplete = useMemo(() => {
    if (initiatives.length === 0) return false;
    return initiatives.every((initiative) =>
      reviewedInitiatives.has(initiative.id)
    );
  }, [initiatives, reviewedInitiatives]);

  // Mark an initiative as reviewed (either kept or rejected)
  const markReviewed = useCallback(
    (id: string, action: "kept" | "rejected") => {
      setState((prev) => {
        const newReviewed = [...new Set([...prev.reviewed, id])];
        const newKept =
          action === "kept"
            ? [...new Set([...prev.kept, id])]
            : prev.kept.filter((keptId) => keptId !== id);

        return {
          reviewed: newReviewed,
          kept: newKept,
          lastUpdated: new Date().toISOString(),
        };
      });
    },
    []
  );

  // Clear all completion data
  const clearCompletion = useCallback(() => {
    const newState: StepperState = {
      reviewed: [],
      kept: [],
      lastUpdated: new Date().toISOString(),
    };
    setState(newState);
    saveToStorage(conversationId, newState);
  }, [conversationId]);

  // Get completion statistics
  const getCompletionStats = useCallback((): CompletionStats => {
    return {
      total: initiatives.length,
      reviewed: reviewedInitiatives.size,
      kept: keptInitiatives.size,
      rejected: reviewedInitiatives.size - keptInitiatives.size,
      percentComplete:
        initiatives.length > 0
          ? Math.round((reviewedInitiatives.size / initiatives.length) * 100)
          : 0,
    };
  }, [initiatives.length, reviewedInitiatives.size, keptInitiatives.size]);

  return {
    reviewedInitiatives,
    keptInitiatives,
    isComplete,
    keptCount: keptInitiatives.size,
    markReviewed,
    clearCompletion,
    getCompletionStats,
  };
};
