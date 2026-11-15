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
import type { EntityMention } from "../../SmarterTextAreaCard/types";
import type { FormValue } from "../types";
import type { SecondaryActionConfigWithHandler } from "./types";

export type ReadinessFinding = NonNullable<
  ImplementationReadinessDisposition["finding"]
>;

export const isExplainedFinding = (
  finding: ReadinessFinding,
): finding is ImplementationReadinessFinding => "requestedOutcome" in finding;

const FIX_STEP_STATE_MARKERS: Record<
  ImplementationReadinessFixStepState,
  { label: string; emphasis: "needsAnswer" | "default" }
> = {
  DONE: { label: "already done", emphasis: "default" },
  REMAINING: { label: "work remaining", emphasis: "default" },
  USER_DECISION: { label: "your decision", emphasis: "needsAnswer" },
};

export const fixStepStateMarker = (
  state: ImplementationReadinessFixStepState,
) => FIX_STEP_STATE_MARKERS[state];

export const itemReferenceToMention = (
  item: ImplementationReadinessItemReference,
): EntityMention => ({
  entityType: item.entityType.toLowerCase(),
  entityId: item.entityId,
  entityName: item.title,
});

export const buildLegacyFindingMarkdown = (
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
