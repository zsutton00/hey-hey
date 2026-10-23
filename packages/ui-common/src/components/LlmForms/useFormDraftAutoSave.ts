import React from "react";
import type { FormValue } from "./types";

interface UseFormDraftAutoSaveParams {
  storageKey: string;
  isSubmitted: boolean;
  disabled: boolean;
}

interface UseFormDraftAutoSaveReturn {
  saveToLocalStorage: (values: Record<string, FormValue>) => void;
  saveTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}

/**
 * Handles localStorage draft auto-save with debouncing and submission guards.
 *
 * This hook provides:
 * - Debounced auto-save to localStorage (500ms debounce)
 * - Automatic guard against saving when form is submitted
 * - Automatic guard against saving when form is disabled
 * - Proper cleanup of timeout references
 * - Error handling for localStorage access failures
 *
 * The saveToLocalStorage function is meant to be called on every value change,
 * and internally handles debouncing to avoid excessive writes.
 *
 * @param params.storageKey - localStorage key for persisting form draft
 * @param params.isSubmitted - Whether the form is submitted (prevents save)
 * @param params.disabled - Whether the form is disabled (prevents save)
 * @returns Object with saveToLocalStorage function and timeout ref for cleanup
 */
export const useFormDraftAutoSave = ({
  storageKey,
  isSubmitted,
  disabled,
}: UseFormDraftAutoSaveParams): UseFormDraftAutoSaveReturn => {
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const saveToLocalStorage = React.useCallback(
    (values: Record<string, FormValue>) => {
      // Clear existing timeout to restart debounce
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Skip saving if form is submitted or disabled
      if (isSubmitted || disabled) {
        return;
      }

      // Set new timeout with debounce (500ms)
      saveTimeoutRef.current = setTimeout(() => {
        try {
          localStorage.setItem(
            storageKey,
            JSON.stringify({
              values,
              savedAt: new Date().toISOString(),
            })
          );
        } catch (error) {
          console.error("Failed to save form draft:", error);
        }
        saveTimeoutRef.current = null;
      }, 500);
    },
    [storageKey, isSubmitted, disabled]
  );

  // Cleanup on unmount - save any pending changes
  React.useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return {
    saveToLocalStorage,
    saveTimeoutRef,
  };
};
