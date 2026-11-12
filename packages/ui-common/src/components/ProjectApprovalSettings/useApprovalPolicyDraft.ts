import { create } from "zustand";
import { isAxiosError } from "axios";
import { useState } from "react";
import type {
  ProjectApprovalPolicyRule,
  ProjectApprovalPolicySnapshot,
  ProjectApprovalPolicyValidationErrorResponse,
} from "../../api";
import { useProjectApprovalPolicy } from "../../data/hooks/useProjectApprovalPolicy";

type Draft = { revision: number; rules: ProjectApprovalPolicyRule[] };
type SaveFeedback = {
  submitted: Draft | undefined;
  issues: ProjectApprovalPolicyValidationErrorResponse["issues"];
};
const NO_ISSUES: ProjectApprovalPolicyValidationErrorResponse["issues"] = [];
const useDrafts = create<{
  drafts: Record<string, Draft | undefined>;
  conflicts: Record<string, boolean>;
  feedback: Record<string, SaveFeedback | undefined>;
  clearFeedback: (key: string) => void;
  failSubmitted: (key: string, feedback: SaveFeedback) => void;
  pending: Record<string, boolean>;
  setPending: (key: string, pending: boolean) => void;
  clearSubmitted: (key: string, submitted: Draft | undefined) => void;
  setConflict: (key: string, conflict: boolean) => void;
  set: (key: string, draft: Draft | undefined) => void;
}>((set) => ({
  drafts: {},
  conflicts: {},
  feedback: {},
  clearFeedback: (key) =>
    set((state) => ({ feedback: { ...state.feedback, [key]: undefined } })),
  failSubmitted: (key, feedback) =>
    set((state) =>
      state.drafts[key] === feedback.submitted
        ? { feedback: { ...state.feedback, [key]: feedback } }
        : state,
    ),
  pending: {},
  setPending: (key, pending) =>
    set((state) => ({ pending: { ...state.pending, [key]: pending } })),
  clearSubmitted: (key, submitted) =>
    set((state) =>
      state.drafts[key] === submitted
        ? { drafts: { ...state.drafts, [key]: undefined } }
        : state,
    ),
  setConflict: (key, conflict) =>
    set((state) => ({ conflicts: { ...state.conflicts, [key]: conflict } })),
  set: (key, draft) =>
    set((state) => ({
      drafts: { ...state.drafts, [key]: draft },
      feedback: { ...state.feedback, [key]: undefined },
    })),
}));
const editableRules = (
  snapshot: ProjectApprovalPolicySnapshot,
): ProjectApprovalPolicyRule[] =>
  snapshot.rules
    .filter((rule) => rule.editable)
    .map((rule) => ({
      conditions: rule.conditions,
      requirement:
        rule.requirement === "IMMEDIATE" ? "IMMEDIATE" : "PROJECT_REQUIRED",
      requiredApprovals: rule.requiredApprovals,
      allowsProposerApproval: rule.allowsProposerApproval,
    }));

export function useApprovalPolicyDraft(
  organizationId: string,
  projectId: string,
) {
  const policy = useProjectApprovalPolicy(organizationId, projectId);
  const key = JSON.stringify([organizationId, projectId]);
  const draft = useDrafts((state) => state.drafts[key]);
  const setDraft = useDrafts((state) => state.set);
  const isPending = useDrafts((state) => state.pending[key] ?? false);
  const conflict = useDrafts((state) => state.conflicts[key] ?? false);
  const setConflict = useDrafts((state) => state.setConflict);
  const feedback = useDrafts((state) => state.feedback[key]);
  const failure = conflict ? "conflict" : feedback ? "save" : null;
  const issues = feedback?.issues ?? NO_ISSUES;
  const [latest, setLatest] = useState<ProjectApprovalPolicySnapshot | null>(
    null,
  );
  const rules = draft?.rules ?? (policy.data ? editableRules(policy.data) : []);
  const update = (rules: ProjectApprovalPolicyRule[]) => {
    if (!policy.data) {
      return;
    }
    setDraft(key, { revision: draft?.revision ?? policy.data.revision, rules });
  };
  const save = async (restore = false) => {
    if (
      !policy.data ||
      failure === "conflict" ||
      useDrafts.getState().pending[key]
    ) {
      return;
    }
    const submitted = useDrafts.getState().drafts[key];
    useDrafts.getState().setPending(key, true);
    useDrafts.getState().clearFeedback(key);
    try {
      const expectedRevision = submitted?.revision ?? policy.data.revision;
      await policy.change.mutate(
        restore
          ? { expectedRevision }
          : { expectedRevision, rules: submitted?.rules ?? rules },
      );
      useDrafts.getState().clearSubmitted(key, submitted);
      setLatest(null);
    } catch (error) {
      let issues = NO_ISSUES;
      if (isAxiosError<ProjectApprovalPolicyValidationErrorResponse>(error)) {
        if (error.response?.status === 409) {
          setConflict(key, true);
          return;
        }
        if (
          error.response?.data.code ===
          "PROJECT_APPROVAL_POLICY_VALIDATION_FAILED"
        ) {
          issues = error.response.data.issues;
        }
      }
      useDrafts.getState().failSubmitted(key, { submitted, issues });
    } finally {
      useDrafts.getState().setPending(key, false);
    }
  };
  const reviewLatest = async () => {
    setLatest(null);
    try {
      setLatest(await policy.refetch());
    } catch {
      /* Query error is rendered by the panel. */
    }
  };
  const acceptRevision = () => {
    if (!latest) {
      return;
    }
    setDraft(key, { rules, revision: latest.revision });
    setConflict(key, false);
    useDrafts.getState().clearFeedback(key);
    setLatest(null);
  };
  const discard = () => {
    setDraft(key, undefined);
    setConflict(key, false);
    useDrafts.getState().clearFeedback(key);
    setLatest(null);
  };
  // Saved priorities are authoritative. A draft previews the API's override layout,
  // including an empty override after deleting the last project rule.
  const displayedRules = draft
    ? [
        ...(policy.data?.rules ?? []).filter((rule) => rule.source === "FIXED"),
        ...rules.map((rule) => ({
          ...rule,
          source: "PROJECT" as const,
          editable: true,
        })),
        ...(policy.data?.rules ?? []).filter(
          (rule) => rule.source === "DEFAULT",
        ),
      ].map((rule, order) => ({ ...rule, order }))
    : (policy.data?.rules ?? []);
  return {
    displayedRules,
    isPending,
    policy,
    rules,
    update,
    save,
    failure,
    issues,
    latest,
    reviewLatest,
    acceptRevision,
    discard,
    dirty: !!draft,
  };
}
