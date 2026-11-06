import type {
  ImplementationReadinessDisposition,
  ImplementationReadinessFinding,
  ImplementationReadinessFixStepState,
  ImplementationReadinessItemReference,
  ImplementationReadinessLegacyFinding,
  ImplementationReadinessPayload,
  SecondaryActionHandler,
  UIElementPayload,
} from "../../../api";
import type { FormValue } from "../types";
import type { SecondaryActionConfigWithHandler } from "./types";

type ReadinessFinding = NonNullable<
  ImplementationReadinessDisposition["finding"]
>;

const isExplainedFinding = (
  finding: ReadinessFinding,
): finding is ImplementationReadinessFinding => "requestedOutcome" in finding;

const FIX_STEP_STATE_LABELS: Record<
  ImplementationReadinessFixStepState,
  string
> = {
  DONE: "already done",
  REMAINING: "work remaining",
  USER_DECISION: "your decision",
};

const mention = (item: ImplementationReadinessItemReference): string => {
  const title = item.title.replace(/[|\]]/g, " ");
  return `@[${item.entityType.toLowerCase()}:${item.entityId}|${title}]`;
};

const numbered = (lines: string[]): string =>
  lines.map((line, index) => `${index + 1}. ${line}`).join("\n");

const buildLegacyFindingMarkdown = (
  finding: ImplementationReadinessLegacyFinding,
): string => {
  const evidence = finding.boundedEvidence
    .map((item) =>
      item.sourceRef
        ? `- ${item.statement} (${item.sourceRef})`
        : `- ${item.statement}`,
    )
    .join("\n");

  return [
    "## Issue",
    finding.affectedSourceContext,
    evidence,
    "## What could go wrong",
    finding.consequentialInventionRisk,
    "## How to resolve",
    finding.unresolvedDecision,
    finding.answerKind,
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
};

export const buildImplementationReadinessFindingMarkdown = (
  finding: ReadinessFinding,
): string => {
  if (!isExplainedFinding(finding)) {
    return buildLegacyFindingMarkdown(finding);
  }

  const trail = numbered(
    finding.reasoningTrail.map(
      (entry) => `${mention(entry.source)} — ${entry.explanation}`,
    ),
  );
  const fixSteps = numbered(
    finding.fixSteps.map(
      (step) =>
        `${step.action} — ${mention(step.owner)} (${FIX_STEP_STATE_LABELS[step.state]})`,
    ),
  );

  return [
    "## What you asked for",
    finding.requestedOutcome,
    "## How the agent got here",
    trail,
    "## The problem",
    finding.problem,
    "## What could go wrong",
    numbered(finding.failureScenario),
    "## Steps to fix",
    fixSteps,
    "## What I need from you",
    finding.userRequest,
  ].join("\n\n");
};

/**
 * Narrows the generated UI payload union at the registry boundary. The API
 * discriminator is the only authority for selecting this field renderer.
 */
export const isImplementationReadinessPayload = (
  payload: UIElementPayload | undefined,
): payload is ImplementationReadinessPayload => {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  if (!("responseType" in payload)) {
    return false;
  }

  return payload.responseType === "implementation_readiness_v1";
};

type ImplementationReadinessDispositionAction =
  typeof SecondaryActionHandler.ImplementationReadinessDismiss;

/**
 * Converts an API secondary-action payload into the workflow submission shape
 * expected by the conversation form dispatcher. The API payload's
 * `handlerType` is presentation metadata; the workflow action must be the
 * nested field value, with only the run/source binding and confirmation sent
 * back to the server.
 */
export const buildImplementationReadinessDispositionValue = (
  action: ImplementationReadinessDispositionAction,
  config: Pick<SecondaryActionConfigWithHandler, "fieldId" | "payload">,
  formValues: Record<string, FormValue>,
): Record<string, FormValue> | null => {
  const payload = config.payload;
  if (!payload || payload.handlerType !== action) {
    return null;
  }

  const { runId, sourceRevision } = payload;
  if (runId.length === 0 || sourceRevision.length === 0) {
    return null;
  }

  return {
    ...formValues,
    [config.fieldId]: {
      action,
      payload: {
        runId,
        sourceRevision,
        confirmed: true,
      },
    },
  };
};
