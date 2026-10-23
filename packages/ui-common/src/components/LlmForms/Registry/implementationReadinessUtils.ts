import type {
  ImplementationReadinessFinding,
  ImplementationReadinessPayload,
  SecondaryActionHandler,
  UIElementPayload,
} from "../../../api";
import type { FormValue } from "../types";
import type { SecondaryActionConfigWithHandler } from "./types";

export const buildImplementationReadinessFindingMarkdown = (
  finding: ImplementationReadinessFinding,
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
  if (
    !isRecord(payload) ||
    payload.handlerType !== action ||
    typeof payload.runId !== "string" ||
    payload.runId.length === 0 ||
    typeof payload.sourceRevision !== "string" ||
    payload.sourceRevision.length === 0
  ) {
    return null;
  }

  return {
    ...formValues,
    [config.fieldId]: {
      action,
      payload: {
        runId: payload.runId,
        sourceRevision: payload.sourceRevision,
        confirmed: true,
      },
    },
  };
};
