import React from "react";
import type {
  PlanApprovalPayload,
  PlanGapDiscoveryPayload,
  OnboardingPlanCandidateReviewPayload,
  UIElement,
} from "../../api";
import type { FormValue } from "./types";
import { getRegistryType } from "./utils";
import {
  createPlanApprovalValue,
  normalizePlanApprovalValue,
} from "./Registry/planApprovalUtils";
import {
  createPlanGapsDesignDocsValue,
  createPlanGapsServicesValue,
  createPlanGapsTasksValue,
  normalizePlanGapsDesignDocsValue,
  normalizePlanGapsServicesValue,
  normalizePlanGapsTasksValue,
} from "./Registry/planGapsUtils";
import {
  createPlanServiceSelectionValue,
  normalizePlanServiceSelectionValue,
} from "./Registry/planServiceSelectionUtils";
import {
  createPlanStageProposalValue,
  normalizePlanStageProposalValue,
} from "./Registry/planStageProposalUtils";
import {
  createPlanGenerationVisualPreviewValue,
  normalizePlanGenerationVisualPreviewValue,
} from "./Registry/planGenerationVisualPreviewReviewUtils";
import { isPlanGenerationVisualPreviewValue } from "./Registry/types";
import { isExistingWorkIntentValue } from "./Registry/ExistingWorkIntentField";

// Type guards for payload types
const isPlanGapDiscoveryPayload = (
  payload: unknown,
): payload is PlanGapDiscoveryPayload =>
  !!payload &&
  typeof payload === "object" &&
  "gaps" in payload &&
  "clarificationQuestions" in payload;

const isPlanApprovalPayload = (
  payload: unknown,
): payload is PlanApprovalPayload =>
  !!payload &&
  typeof payload === "object" &&
  "description" in payload &&
  "workstreams" in payload;

const isOnboardingPlanCandidateReviewPayload = (
  payload: unknown,
): payload is OnboardingPlanCandidateReviewPayload =>
  !!payload &&
  typeof payload === "object" &&
  "response" in payload &&
  "stages" in payload;

/**
 * Hook to compute form default values with proper priority handling.
 *
 * Submitted forms use recorded answers and never load local drafts.
 *
 * Priority logic:
 * - System data fields (task_stub, task_list, initiative_list): initialData takes
 *   precedence over localStorage. These fields display server-generated content
 *   that cannot be "drafted" by the user - the system provides the stubs/tasks/initiatives
 *   and the user reviews them. Stale localStorage values would cause errors.
 *
 * - User input fields (text, textarea, etc.): localStorage takes precedence over
 *   initialData. This preserves user drafts across page refreshes.
 */

// Field types where system-provided initialData takes precedence over localStorage
const SYSTEM_DATA_FIELD_TYPES = new Set([
  "task_stub",
  "task_list",
  "initiative_list",
  "coding_prompt",
  "coding_prompt_final_assessment",
  "plan_document_view",
  "plan_gaps_services",
  "plan_gaps_design_docs",
  "plan_gaps_tasks",
  "plan_approval",
  "plan_stage_proposal",
  "goal_pm_action",
]);

interface UseFormDefaultValuesParams {
  uiElements: UIElement[];
  isSubmitted: boolean;
  initialData?: Record<string, FormValue>;
  getPersistedValues: () => Record<string, FormValue>;
}

export const useFormDefaultValues = ({
  uiElements,
  isSubmitted,
  initialData,
  getPersistedValues,
}: UseFormDefaultValuesParams): Record<string, FormValue> => {
  return React.useMemo(() => {
    // Drafts belong to unanswered forms; persisted answers own submitted history.
    const persistedValues = isSubmitted ? {} : getPersistedValues();

    return uiElements.reduce(
      (acc, uiElement) => {
        const registryType = getRegistryType(uiElement);
        const useSystemDataFirst = SYSTEM_DATA_FIELD_TYPES.has(registryType);

        if (uiElement.payload) {
          const payload = uiElement.payload;

          if (
            registryType === "plan_gaps_services" &&
            isPlanGapDiscoveryPayload(payload)
          ) {
            const fallbackValue = createPlanGapsServicesValue(
              payload.gaps.services,
              payload.clarificationQuestions.services,
            );
            const persistedValue = persistedValues[uiElement.id];
            const initialValue = initialData?.[uiElement.id];

            acc[uiElement.id] =
              persistedValue !== undefined
                ? normalizePlanGapsServicesValue(persistedValue, fallbackValue)
                : initialValue !== undefined
                  ? normalizePlanGapsServicesValue(initialValue, fallbackValue)
                  : fallbackValue;
            return acc;
          }

          if (
            registryType === "plan_gaps_design_docs" &&
            isPlanGapDiscoveryPayload(payload)
          ) {
            const fallbackValue = createPlanGapsDesignDocsValue(
              payload.gaps.design_docs,
              payload.clarificationQuestions.design_docs,
            );
            const persistedValue = persistedValues[uiElement.id];
            const initialValue = initialData?.[uiElement.id];

            acc[uiElement.id] =
              persistedValue !== undefined
                ? normalizePlanGapsDesignDocsValue(
                    persistedValue,
                    fallbackValue,
                  )
                : initialValue !== undefined
                  ? normalizePlanGapsDesignDocsValue(
                      initialValue,
                      fallbackValue,
                    )
                  : fallbackValue;
            return acc;
          }

          if (
            registryType === "plan_gaps_tasks" &&
            isPlanGapDiscoveryPayload(payload)
          ) {
            const fallbackValue = createPlanGapsTasksValue(
              payload.gaps.tasks,
              payload.clarificationQuestions.tasks,
            );
            const persistedValue = persistedValues[uiElement.id];
            const initialValue = initialData?.[uiElement.id];

            acc[uiElement.id] =
              persistedValue !== undefined
                ? normalizePlanGapsTasksValue(persistedValue, fallbackValue)
                : initialValue !== undefined
                  ? normalizePlanGapsTasksValue(initialValue, fallbackValue)
                  : fallbackValue;
            return acc;
          }

          if (
            registryType === "plan_approval" &&
            isPlanApprovalPayload(payload)
          ) {
            const fallbackValue = createPlanApprovalValue(payload);
            const persistedValue = persistedValues[uiElement.id];
            const initialValue = initialData?.[uiElement.id];

            acc[uiElement.id] =
              persistedValue !== undefined
                ? normalizePlanApprovalValue(persistedValue, fallbackValue)
                : initialValue !== undefined
                  ? normalizePlanApprovalValue(initialValue, fallbackValue)
                  : fallbackValue;
            return acc;
          }

          if (
            registryType === "plan_stage_proposal" &&
            isOnboardingPlanCandidateReviewPayload(payload)
          ) {
            const fallbackValue = createPlanStageProposalValue(payload);
            const persistedValue = persistedValues[uiElement.id];
            const initialValue = initialData?.[uiElement.id];

            acc[uiElement.id] =
              persistedValue !== undefined
                ? normalizePlanStageProposalValue(persistedValue, fallbackValue)
                : initialValue !== undefined
                  ? normalizePlanStageProposalValue(initialValue, fallbackValue)
                  : fallbackValue;
            return acc;
          }
        }

        if (registryType === "service_selector") {
          const fallbackValue = createPlanServiceSelectionValue();
          const persistedValue = persistedValues[uiElement.id];
          const initialValue = initialData?.[uiElement.id];

          acc[uiElement.id] =
            persistedValue !== undefined
              ? normalizePlanServiceSelectionValue(
                  persistedValue,
                  fallbackValue,
                )
              : initialValue !== undefined
                ? normalizePlanServiceSelectionValue(
                    initialValue,
                    fallbackValue,
                  )
                : fallbackValue;
          return acc;
        }

        if (registryType === "plan_generation_visual_preview") {
          const persistedValue = persistedValues[uiElement.id];
          const initialValue = initialData?.[uiElement.id];
          const initialSubmission = isPlanGenerationVisualPreviewValue(
            initialValue,
          ) && "action" in initialValue && initialValue.action !== undefined;
          const sourceValue = initialSubmission
            ? initialValue
            : (persistedValue ?? initialValue);

          acc[uiElement.id] = isPlanGenerationVisualPreviewValue(sourceValue)
            ? sourceValue
            : normalizePlanGenerationVisualPreviewValue(
                sourceValue ?? createPlanGenerationVisualPreviewValue(),
              );
          return acc;
        }

        if (registryType === "repository_grounding_intent") {
          const persistedValue = persistedValues[uiElement.id];
          const initialValue = initialData?.[uiElement.id];

          acc[uiElement.id] = isExistingWorkIntentValue(persistedValue)
            ? persistedValue
            : isExistingWorkIntentValue(initialValue)
              ? initialValue
              : undefined;
          return acc;
        }

        // For system data fields, initialData takes precedence
        // For user input fields, localStorage draft takes precedence
        const value = useSystemDataFirst
          ? (initialData?.[uiElement.id] ?? persistedValues[uiElement.id])
          : (persistedValues[uiElement.id] ?? initialData?.[uiElement.id]);

        acc[uiElement.id] =
          value ??
          (registryType === "priority"
            ? 1
            : registryType === "currency" || registryType === "number"
              ? 0
              : "");
        return acc;
      },
      {} as Record<string, FormValue>,
    );
  }, [uiElements, isSubmitted, initialData, getPersistedValues]);
};
