import type { OnboardingFeatureListReviewUserSubmission } from "../../../api";
import type { FeatureListValue } from "./types";

export const projectFeatureListSubmission = (
  value: FeatureListValue,
  action: OnboardingFeatureListReviewUserSubmission["action"],
): OnboardingFeatureListReviewUserSubmission =>
  action === "REFINE"
    ? { action, payload: value.refinement }
    : { action, payload: {} };
