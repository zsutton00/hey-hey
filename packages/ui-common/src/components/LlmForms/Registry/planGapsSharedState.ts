import { useCallback, useMemo } from "react";
import type { PlanGapDiscoveryPayload, PlanGapItemPayload } from "../../../api";
import type {
  PlanGapClarifyingAnswer,
  PlanGapDiscoveryUserMessage,
  PlanGapReview,
  PlanGapReviewAction,
} from "./types";
import { mergeClarifyingAnswers, mergeGapReviews } from "./planGapsUtils";

export const sectionHeaderSx = {
  color: "actionable.main",
  fontWeight: 700,
  letterSpacing: 0.6,
  fontSize: 18,
  textTransform: "uppercase",
};

export const usePlanGapsReviewState = <
  TValue extends PlanGapDiscoveryUserMessage
>({
  payload,
  value,
  fallbackValue,
  gaps,
  clarificationQuestions,
}: {
  payload?: PlanGapDiscoveryPayload;
  value?: TValue;
  fallbackValue: TValue | null;
  gaps: PlanGapItemPayload[];
  clarificationQuestions: string[];
}): {
  fieldValue: TValue | null;
  gapReviews: PlanGapReview[];
  clarifyingAnswers: PlanGapClarifyingAnswer[];
} => {
  const fieldValue = value ?? fallbackValue ?? null;
  const gapReviews = useMemo(() => {
    if (!payload || !fieldValue) {
      return [];
    }
    return mergeGapReviews(gaps, fieldValue.gapReviews);
  }, [payload, fieldValue, gaps]);
  const clarifyingAnswers = useMemo(() => {
    if (!payload || !fieldValue) {
      return [];
    }
    return mergeClarifyingAnswers(
      clarificationQuestions,
      fieldValue.clarifyingAnswers ?? []
    );
  }, [payload, fieldValue, clarificationQuestions]);

  return { fieldValue, gapReviews, clarifyingAnswers };
};

export const usePlanGapsReviewHandlers = <
  TValue extends PlanGapDiscoveryUserMessage
>({
  fieldValue,
  gapReviews,
  onChange,
}: {
  fieldValue: TValue | null;
  gapReviews: PlanGapReview[];
  onChange?: (value: TValue) => void;
}): {
  updateGapReviewAction: (title: string, action: PlanGapReviewAction) => void;
  updateGapReviewComment: (title: string, comment: string) => void;
  updateCoverageReviewAction: (
    gapTitle: string,
    entityId: string,
    action: PlanGapReviewAction
  ) => void;
  updateCoverageReviewComment: (
    gapTitle: string,
    entityId: string,
    comment: string
  ) => void;
  updateClarifyingAnswers: (answers: PlanGapClarifyingAnswer[]) => void;
} => {
  const updateGapReviewAction = useCallback(
    (title: string, action: PlanGapReviewAction) => {
      if (!onChange || !fieldValue) {
        return;
      }
      const updatedReviews = gapReviews.map((review) => {
        if (review.title !== title) {
          return review;
        }
        return {
          ...review,
          action,
          coverageReviews:
            action === "accept"
              ? review.coverageReviews
              : review.coverageReviews.map((coverage) => ({
                  ...coverage,
                  action: "pending",
                })),
        };
      });
      onChange({
        ...fieldValue,
        gapReviews: updatedReviews,
        clarifyingAnswers: fieldValue.clarifyingAnswers,
      });
    },
    [onChange, fieldValue, gapReviews]
  );

  const updateGapReviewComment = useCallback(
    (title: string, comment: string) => {
      if (!onChange || !fieldValue) {
        return;
      }
      const updatedReviews = gapReviews.map((review) =>
        review.title === title ? { ...review, comment } : review
      );
      onChange({
        ...fieldValue,
        gapReviews: updatedReviews,
        clarifyingAnswers: fieldValue.clarifyingAnswers,
      });
    },
    [onChange, fieldValue, gapReviews]
  );

  const updateCoverageReviewAction = useCallback(
    (gapTitle: string, entityId: string, action: PlanGapReviewAction) => {
      if (!onChange || !fieldValue) {
        return;
      }
      const updatedReviews = gapReviews.map((review) => {
        if (review.title !== gapTitle) {
          return review;
        }
        return {
          ...review,
          coverageReviews: review.coverageReviews.map((coverage) =>
            coverage.entityId === entityId ? { ...coverage, action } : coverage
          ),
        };
      });
      onChange({
        ...fieldValue,
        gapReviews: updatedReviews,
        clarifyingAnswers: fieldValue.clarifyingAnswers,
      });
    },
    [onChange, fieldValue, gapReviews]
  );

  const updateCoverageReviewComment = useCallback(
    (gapTitle: string, entityId: string, comment: string) => {
      if (!onChange || !fieldValue) {
        return;
      }
      const updatedReviews = gapReviews.map((review) => {
        if (review.title !== gapTitle) {
          return review;
        }
        return {
          ...review,
          coverageReviews: review.coverageReviews.map((coverage) =>
            coverage.entityId === entityId ? { ...coverage, comment } : coverage
          ),
        };
      });
      onChange({
        ...fieldValue,
        gapReviews: updatedReviews,
        clarifyingAnswers: fieldValue.clarifyingAnswers,
      });
    },
    [onChange, fieldValue, gapReviews]
  );

  const updateClarifyingAnswers = useCallback(
    (answers: PlanGapClarifyingAnswer[]) => {
      if (!onChange || !fieldValue) {
        return;
      }
      onChange({
        ...fieldValue,
        gapReviews: fieldValue.gapReviews,
        clarifyingAnswers: answers,
      });
    },
    [onChange, fieldValue]
  );

  return {
    updateGapReviewAction,
    updateGapReviewComment,
    updateCoverageReviewAction,
    updateCoverageReviewComment,
    updateClarifyingAnswers,
  };
};
