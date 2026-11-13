import { useState } from "react";
import {
  ProjectApprovalPolicyAction,
  ProjectApprovalPolicyAuthor,
  ProjectApprovalPolicyChangeSelector,
  type ProjectApprovalPolicyRule,
  type ProjectApprovalPolicyValidationIssue,
} from "../../api";
import { locateRule, withRuleSaved, withoutRule } from "./approvalRuleDocument";
import {
  FEATURE_TYPE_KEY,
  MAX_APPROVALS,
  topLevelValue,
  type RuleEntries,
  type RuleFieldKey,
} from "./approvalRuleFields";
import type { SaveOutcome } from "./useApprovalPolicySave";

export type RuleTarget = {
  /** Registry key of the group the modal was opened from; absent for Default. */
  typeKey: string | undefined;
  /** The saved rule being edited, as it was when the modal opened; null when adding. */
  opened: { index: number; rule: ProjectApprovalPolicyRule } | null;
};

export type FieldErrors = Partial<Record<RuleFieldKey, string>>;
export type FormFailure = "conflict" | "missing" | "failed" | null;

type Save = (
  change: (
    rules: ProjectApprovalPolicyRule[],
  ) => ProjectApprovalPolicyRule[] | null,
) => Promise<SaveOutcome>;

const FIELD_BY_PATH: Record<string, RuleFieldKey> = {
  "conditions/author": "author",
  "conditions/action": "action",
  "conditions/change": "change",
  "conditions/topLevel": "topLevel",
  requirement: "outcome",
  requiredApprovals: "approvals",
  allowsProposerApproval: "credit",
};

function fieldFor(
  issue: ProjectApprovalPolicyValidationIssue,
): RuleFieldKey | null {
  const match = /^\/rules\/\d+\/(.+)$/.exec(issue.path);
  return (match && FIELD_BY_PATH[match[1]]) ?? null;
}

function issueErrors(
  issues: ProjectApprovalPolicyValidationIssue[],
): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = fieldFor(issue);
    if (field) {
      errors[field] = [errors[field], issue.message].filter(Boolean).join(" ");
    }
  }
  return errors;
}

function parseInteger(value: string): number | null {
  return /^-?\d+$/.test(value.trim()) ? Number(value) : null;
}

/**
 * Holds the modal's unsaved entries, validates them and saves one rule.
 * Nothing outside this hook holds unsaved values.
 */
export function useApprovalRuleForm({
  target,
  initial,
  ruleCount,
  fixedCount,
  save,
  onSaved,
  messages,
}: {
  target: RuleTarget;
  initial: RuleEntries;
  ruleCount: number;
  fixedCount: number;
  save: Save;
  onSaved: () => void;
  messages: {
    approvals: string;
    immediateApprovals: string;
    priority: (min: number, max: number) => string;
  };
}) {
  const [entries, setEntries] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<FormFailure>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const adding = target.opened === null;
  const minPriority = fixedCount + 1;
  const maxPriority = fixedCount + ruleCount + (adding ? 1 : 0);

  const change = <K extends keyof RuleEntries>(
    key: K,
    value: RuleEntries[K],
  ) => {
    setEntries((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    const approvals = parseInteger(entries.approvals);
    if (entries.outcome === "IMMEDIATE") {
      if (approvals !== 0) {
        next.approvals = messages.immediateApprovals;
      }
    } else if (
      approvals === null ||
      approvals < 1 ||
      approvals > MAX_APPROVALS
    ) {
      next.approvals = messages.approvals;
    }
    const priority = parseInteger(entries.priority);
    if (priority === null || priority < minPriority || priority > maxPriority) {
      next.priority = messages.priority(minPriority, maxPriority);
    }
    return next;
  };

  const buildRule = (): ProjectApprovalPolicyRule => {
    const author = Object.values(ProjectApprovalPolicyAuthor).find(
      (value) => value === entries.author,
    );
    const action = Object.values(ProjectApprovalPolicyAction).find(
      (value) => value === entries.action,
    );
    const changeSelector = Object.values(
      ProjectApprovalPolicyChangeSelector,
    ).find((value) => value === entries.change);
    const topLevel =
      target.typeKey === FEATURE_TYPE_KEY
        ? topLevelValue(entries.topLevel)
        : undefined;
    return {
      conditions: {
        ...(target.typeKey === undefined ? {} : { typeKey: target.typeKey }),
        ...(author ? { author } : {}),
        ...(action ? { action } : {}),
        ...(changeSelector ? { change: changeSelector } : {}),
        ...(topLevel === undefined ? {} : { topLevel }),
      },
      requirement: entries.outcome,
      requiredApprovals: Number(entries.approvals),
      allowsProposerApproval: entries.credit,
    };
  };

  const finish = (outcome: SaveOutcome) => {
    if (outcome.status === "saved") {
      onSaved();
      return;
    }
    if (outcome.status === "invalid") {
      const mapped = issueErrors(outcome.issues);
      setErrors(mapped);
      // Issues that name no field are still a failed save, never a silent one.
      setFailure(Object.keys(mapped).length > 0 ? null : "failed");
      return;
    }
    setFailure(outcome.status);
  };

  const submit = async () => {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    setFailure(null);
    const rule = buildRule();
    const entered = Number(entries.priority) - fixedCount - 1;
    const priorityEdited = entries.priority !== initial.priority;
    const { opened } = target;
    finish(
      await save((rules) => {
        if (opened === null) {
          return withRuleSaved(rules, rule, null, entered);
        }
        const index = locateRule(rules, opened.rule, opened.index);
        if (index === null) {
          return null;
        }
        // An untouched priority means "stay where it is", wherever that is now.
        return withRuleSaved(
          rules,
          rule,
          index,
          priorityEdited ? entered : index,
        );
      }),
    );
  };

  const remove = async () => {
    const { opened } = target;
    if (opened === null) {
      return;
    }
    setFailure(null);
    setConfirmingDelete(false);
    finish(
      await save((rules) => {
        const index = locateRule(rules, opened.rule, opened.index);
        return index === null ? null : withoutRule(rules, index);
      }),
    );
  };

  return {
    entries,
    errors,
    failure,
    adding,
    confirmingDelete,
    setConfirmingDelete,
    change,
    submit,
    remove,
    clearFailure: () => setFailure(null),
  };
}
