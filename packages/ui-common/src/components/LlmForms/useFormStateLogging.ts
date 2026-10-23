import React from "react";
import type { UIElement } from "../../api";
import type { SaveStatus } from "../SmartTextAreaCard";
import type { FormValue } from "./types";

interface UseFormStateLoggingParams {
  watchedValues: Record<string, FormValue>;
  hasContent: boolean;
  isSubmitting: boolean;
  disabled: boolean;
  status: SaveStatus;
  uiElements: UIElement[];
  conversationId: string;
}

/**
 * Centralizes form state change logging for observability.
 *
 * This hook logs:
 * - Form state changes (value updates)
 * - Filled field counts and completion percentages
 * - Submission and save status
 * - Form state at different lifecycle points
 *
 * This is a fire-and-forget logging utility with no return value.
 * It helps with debugging form behavior and monitoring user interactions.
 *
 * @param params - All form state needed for comprehensive logging
 */
export const useFormStateLogging = ({
  watchedValues,
  hasContent,
  isSubmitting,
  disabled,
  status,
  uiElements,
  conversationId,
}: UseFormStateLoggingParams): void => {
  // Log form state changes whenever watched values change
  React.useEffect(() => {
    // const filledFieldCount = Object.entries(watchedValues).filter(
    //   ([fieldId, value]) => {
    //     const uiElement = uiElements.find((el) => el.id === fieldId);
    //     if (!uiElement) return false;
    //     if (typeof value === "string") return value.trim() !== "";
    //     if (typeof value === "number") return value !== 0;
    //     if (typeof value === "object" && value !== null)
    //       return Object.keys(value).length > 0;
    //     return false;
    //   }
    // ).length;
    // const completionPercentage =
    //   uiElements.length > 0
    //     ? Math.round((filledFieldCount / uiElements.length) * 100)
    //     : 0;
    // // log.info("dynamic_form", "Form state changed", {
    // //   conversationId,
    // //   hasContent,
    // //   filledFieldCount,
    // //   totalFieldCount: uiElements.length,
    // //   completionPercentage,
    // //   isSubmitting,
    // //   disabled,
    // //   status,
    // // });
  }, [
    watchedValues,
    hasContent,
    uiElements.length,
    isSubmitting,
    disabled,
    status,
    conversationId,
    uiElements,
  ]);
};
