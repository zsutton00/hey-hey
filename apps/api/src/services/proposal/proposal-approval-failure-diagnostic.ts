import { v4 as uuidv4 } from 'uuid';
import type { ProposalApprovalFailureDiagnostic } from 'src/generated';
import { ProjectedWorkItemChangeSetIssue } from 'src/generated';

const MAX_DIAGNOSTIC_ISSUES = 32;
const MAX_DIAGNOSTIC_TEXT_LENGTH = 512;

type DiagnosticIssue = ProposalApprovalFailureDiagnostic['issues'][number];
export type PersistedProposalApprovalFailure = {
  message: string;
  diagnostic: ProposalApprovalFailureDiagnostic;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: string): string {
  return value.trim().slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH);
}

function isDiagnosticLayer(value: unknown): value is DiagnosticIssue['layer'] {
  return (
    value === ProjectedWorkItemChangeSetIssue.LayerEnum.Structural ||
    value === ProjectedWorkItemChangeSetIssue.LayerEnum.Referential ||
    value === ProjectedWorkItemChangeSetIssue.LayerEnum.Permission
  );
}

function toDiagnosticIssue(value: unknown): DiagnosticIssue | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.field !== 'string' ||
    typeof value.code !== 'string' ||
    typeof value.reason !== 'string' ||
    !isDiagnosticLayer(value.layer)
  ) {
    return undefined;
  }
  return {
    field: boundedText(value.field),
    code: boundedText(value.code),
    reason: boundedText(value.reason),
    layer: value.layer,
    ...(typeof value.suggestion === 'string'
      ? { suggestion: boundedText(value.suggestion) }
      : {}),
  };
}

function responsePayload(error: unknown): unknown {
  if (!isRecord(error)) return error;
  const response = error.response;
  if (isRecord(response) && 'data' in response) return response.data;
  if (typeof error.getResponse === 'function') {
    return error.getResponse();
  }
  return error;
}

function nestedCandidates(value: unknown): unknown[] {
  if (!isRecord(value)) return [value];
  const candidates: unknown[] = [value];
  for (const key of [
    'diagnostic',
    'projection',
    'data',
    'response',
    'errors',
  ]) {
    if (key in value) candidates.push(value[key]);
  }
  return candidates;
}

function findDiagnosticRecord(error: unknown): UnknownRecord | undefined {
  for (const candidate of nestedCandidates(responsePayload(error))) {
    if (isRecord(candidate) && isRecord(candidate.diagnostic)) {
      return candidate.diagnostic;
    }
  }
  return undefined;
}

function findIssueValues(error: unknown): unknown[] {
  const values: unknown[] = [];
  const seen = new Set<unknown>();
  const addValues = (candidates: unknown[]) => {
    for (const candidate of candidates) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      values.push(candidate);
    }
  };
  for (const candidate of nestedCandidates(responsePayload(error))) {
    if (!isRecord(candidate)) continue;
    if (Array.isArray(candidate.issues)) addValues(candidate.issues);
    if (Array.isArray(candidate.errors)) addValues(candidate.errors);
    if (isRecord(candidate.projection)) {
      const projectionIssues = candidate.projection.issues;
      if (Array.isArray(projectionIssues)) addValues(projectionIssues);
    }
  }
  return values;
}

function diagnosticFromRecord(
  record: UnknownRecord,
  fallbackCorrelationId: string,
): ProposalApprovalFailureDiagnostic {
  const rawIssues = Array.isArray(record.issues) ? record.issues : [];
  const issues = rawIssues
    .map(toDiagnosticIssue)
    .filter((issue): issue is DiagnosticIssue => issue !== undefined)
    .slice(0, MAX_DIAGNOSTIC_ISSUES);
  const issueCount =
    typeof record.issueCount === 'number' && Number.isFinite(record.issueCount)
      ? Math.max(issues.length, Math.floor(record.issueCount))
      : rawIssues.length;
  return {
    issues,
    issueCount,
    truncated:
      record.truncated === true ||
      issueCount > issues.length ||
      rawIssues.length > issues.length,
    correlationId:
      typeof record.correlationId === 'string' &&
      record.correlationId.length > 0
        ? boundedText(record.correlationId)
        : fallbackCorrelationId,
  };
}

export function toProposalApprovalFailureDiagnostic(
  error: unknown,
  correlationId = uuidv4(),
): ProposalApprovalFailureDiagnostic {
  const existing = findDiagnosticRecord(error);
  if (existing) return diagnosticFromRecord(existing, correlationId);

  const rawIssues = findIssueValues(error);
  const issues = rawIssues
    .map(toDiagnosticIssue)
    .filter((issue): issue is DiagnosticIssue => issue !== undefined)
    .slice(0, MAX_DIAGNOSTIC_ISSUES);
  return {
    issues,
    issueCount: rawIssues.length,
    truncated: rawIssues.length > issues.length,
    correlationId,
  };
}

export function proposalApprovalFailureMessage(error: unknown): string {
  const payload = responsePayload(error);
  if (isRecord(payload)) {
    const message = payload.message;
    if (typeof message === 'string' && message.length > 0)
      return boundedText(message);
    if (Array.isArray(message)) {
      return boundedText(
        message
          .filter((item): item is string => typeof item === 'string')
          .join(', '),
      );
    }
  }
  if (error instanceof Error && error.message.length > 0)
    return boundedText(error.message);
  return 'Proposal approval or enactment failed.';
}

export function serializeProposalApprovalFailure(
  message: string,
  diagnostic: ProposalApprovalFailureDiagnostic,
): string {
  const persisted: PersistedProposalApprovalFailure = {
    message: boundedText(message),
    diagnostic: diagnosticFromRecord(
      diagnostic as unknown as UnknownRecord,
      diagnostic.correlationId,
    ),
  };
  return JSON.stringify(persisted);
}

export function parseProposalApprovalFailure(
  value: string | null | undefined,
): PersistedProposalApprovalFailure | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || typeof parsed.message !== 'string')
      return undefined;
    if (!isRecord(parsed.diagnostic)) return undefined;
    return {
      message: boundedText(parsed.message),
      diagnostic: diagnosticFromRecord(
        parsed.diagnostic,
        typeof parsed.diagnostic.correlationId === 'string'
          ? parsed.diagnostic.correlationId
          : uuidv4(),
      ),
    };
  } catch {
    return undefined;
  }
}
