import { Alert, Stack, Typography } from "@mui/material";
import React from "react";
import type {
  ProposalApprovalFailureDiagnostic,
  ProjectedWorkItemChangeSetIssue,
} from "../../api";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIssueLayer(
  value: unknown,
): value is ProjectedWorkItemChangeSetIssue["layer"] {
  return (
    value === "structural" || value === "referential" || value === "permission"
  );
}

function isDiagnosticIssue(
  value: unknown,
): value is ProjectedWorkItemChangeSetIssue {
  if (!isRecord(value)) return false;
  return (
    typeof value.field === "string" &&
    typeof value.code === "string" &&
    typeof value.reason === "string" &&
    isIssueLayer(value.layer)
  );
}

export function extractProposalApprovalFailureDiagnostic(
  error: unknown,
): ProposalApprovalFailureDiagnostic | undefined {
  const response = isRecord(error) ? error.response : undefined;
  const responseData = isRecord(response) ? response.data : undefined;
  const payload = isRecord(responseData)
    ? responseData
    : isRecord(error)
      ? error
      : undefined;
  const diagnostic = payload?.diagnostic;
  if (!isRecord(diagnostic) || !Array.isArray(diagnostic.issues)) {
    return undefined;
  }
  if (
    typeof diagnostic.issueCount !== "number" ||
    typeof diagnostic.truncated !== "boolean" ||
    typeof diagnostic.correlationId !== "string"
  ) {
    return undefined;
  }
  const issues = diagnostic.issues.filter(isDiagnosticIssue);
  if (issues.length !== diagnostic.issues.length) return undefined;
  return {
    issues,
    issueCount: diagnostic.issueCount,
    truncated: diagnostic.truncated,
    correlationId: diagnostic.correlationId,
  };
}

function extractProposalApprovalFailureMessage(
  error: unknown,
): string | undefined {
  const response = isRecord(error) ? error.response : undefined;
  const responseData = isRecord(response) ? response.data : undefined;
  const payload = isRecord(responseData)
    ? responseData
    : isRecord(error)
      ? error
      : undefined;
  const message = payload?.message;
  if (typeof message === "string" && message.length > 0) return message;
  if (Array.isArray(message)) {
    const text = message
      .filter((item): item is string => typeof item === "string")
      .join(", ");
    if (text.length > 0) return text;
  }
  return undefined;
}

class ProposalApprovalFailureError extends Error {
  readonly diagnostic: ProposalApprovalFailureDiagnostic;

  constructor(message: string, diagnostic: ProposalApprovalFailureDiagnostic) {
    super(message);
    this.name = "ProposalApprovalFailureError";
    this.diagnostic = diagnostic;
  }
}

export function toProposalApprovalFailureError(
  error: unknown,
  fallbackMessage: string,
): Error {
  const message =
    extractProposalApprovalFailureMessage(error) ??
    (error instanceof Error && error.message ? error.message : fallbackMessage);
  const diagnostic = extractProposalApprovalFailureDiagnostic(error);
  return diagnostic
    ? new ProposalApprovalFailureError(message, diagnostic)
    : error instanceof Error
      ? error
      : new Error(message);
}

export const ProposalFailureDiagnostic: React.FC<{
  diagnostic?: ProposalApprovalFailureDiagnostic | null;
}> = ({ diagnostic }) => {
  if (!diagnostic) return null;

  return (
    <Alert
      severity="error"
      variant="outlined"
      data-testid="proposal-failure-diagnostic"
    >
      <Stack spacing={0.5}>
        <Typography variant="body2" data-testid="proposal-failure-correlation">
          Correlation: {diagnostic.correlationId}
        </Typography>
        {diagnostic.issues.map((issue, index) => (
          <Typography
            key={`${issue.field}-${issue.code}-${index}`}
            variant="body2"
            data-testid="proposal-failure-issue"
          >
            {issue.layer} · {issue.field} · {issue.code}: {issue.reason}
            {issue.suggestion ? ` (${issue.suggestion})` : ""}
          </Typography>
        ))}
        {diagnostic.truncated ? (
          <Typography
            variant="caption"
            data-testid="proposal-failure-truncated"
          >
            Showing {diagnostic.issues.length} of {diagnostic.issueCount}{" "}
            issues.
          </Typography>
        ) : null}
      </Stack>
    </Alert>
  );
};
