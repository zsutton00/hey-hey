import { isAxiosError } from "axios";
import { useState } from "react";
import type {
  ProjectApprovalPolicyRule,
  ProjectApprovalPolicyValidationErrorResponse,
} from "../../api";
import { useProjectApprovalPolicy } from "../../data/hooks/useProjectApprovalPolicy";
import { savedProjectRules } from "./approvalRuleDocument";

type Issues = ProjectApprovalPolicyValidationErrorResponse["issues"];

export type SaveOutcome =
  | { status: "saved" }
  | { status: "conflict" }
  | { status: "invalid"; issues: Issues }
  | { status: "missing" }
  | { status: "failed" };

/**
 * Owns every write to the saved settings. Each save sends the whole project
 * rule document with the expected revision of the latest read, so a newer
 * save by someone else is refused rather than overwritten.
 */
export function useApprovalPolicySave(
  organizationId: string,
  projectId: string,
) {
  const policy = useProjectApprovalPolicy(organizationId, projectId);
  const [pending, setPending] = useState(false);
  // After a refused save the latest settings must be read before retrying.
  const [needsReview, setNeedsReview] = useState(false);

  const run = async (
    request: (
      snapshot: NonNullable<typeof policy.data>,
    ) => Parameters<typeof policy.change.mutate>[0] | null,
  ): Promise<SaveOutcome> => {
    const snapshot = policy.data;
    if (!snapshot) {
      return { status: "failed" };
    }
    if (needsReview) {
      return { status: "conflict" };
    }
    const body = request(snapshot);
    if (body === null) {
      return { status: "missing" };
    }
    setPending(true);
    try {
      await policy.change.mutate(body);
      setNeedsReview(false);
      return { status: "saved" };
    } catch (error) {
      if (isAxiosError<ProjectApprovalPolicyValidationErrorResponse>(error)) {
        if (error.response?.status === 409) {
          setNeedsReview(true);
          return { status: "conflict" };
        }
        if (
          error.response?.data.code ===
          "PROJECT_APPROVAL_POLICY_VALIDATION_FAILED"
        ) {
          return { status: "invalid", issues: error.response.data.issues };
        }
      }
      return { status: "failed" };
    } finally {
      setPending(false);
    }
  };

  /** Applies a change to the latest saved rules and saves the result. */
  const saveRules = (
    change: (
      rules: ProjectApprovalPolicyRule[],
    ) => ProjectApprovalPolicyRule[] | null,
  ) =>
    run((snapshot) => {
      const rules = change(savedProjectRules(snapshot));
      return rules === null
        ? null
        : { expectedRevision: snapshot.revision, rules };
    });

  const restoreDefaults = () =>
    run((snapshot) => ({ expectedRevision: snapshot.revision }));

  const reviewLatest = async () => {
    await policy.refetch();
    setNeedsReview(false);
  };

  return {
    policy,
    pending,
    needsReview,
    saveRules,
    restoreDefaults,
    reviewLatest,
  };
}
