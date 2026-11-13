import {
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventContextManager } from 'src/core/events/observable-event.context';

export const SAVED_POLICY_INVALID_CODE =
  'SAVED_PROJECT_APPROVAL_POLICY_INVALID';
export const DECISION_EVIDENCE_INVALID_CODE =
  'STORED_APPROVAL_DECISION_EVIDENCE_INVALID';

/** Bounded reasons an approval-policy read can fail in a collection. */
export type ApprovalPolicyReadFailureCategory =
  | 'SAVED_POLICY_INVALID'
  | 'POLICY_STORAGE_UNAVAILABLE'
  | 'PROJECT_POLICY_MISSING'
  | 'DECISION_EVIDENCE_INVALID'
  | 'TARGET_UNRESOLVED'
  | 'EVALUATION_FAILED';

export class StoredDecisionEvidenceInvalidError extends Error {
  readonly code = DECISION_EVIDENCE_INVALID_CODE;
}

export class ProjectPolicyMissingError extends Error {}

export class ProposalTargetUnresolvedError extends Error {}

interface FailureScope {
  projectId: string;
  proposalId?: string;
}

/**
 * Classify a failure into a bounded category. Only the category and a
 * non-sensitive error class are exposed: messages can embed connection
 * strings, policy documents or payloads, so they are never read.
 */
export function classifyApprovalPolicyReadFailure(
  error: unknown,
  fallback: ApprovalPolicyReadFailureCategory,
): ApprovalPolicyReadFailureCategory {
  if (error instanceof StoredDecisionEvidenceInvalidError) {
    return 'DECISION_EVIDENCE_INVALID';
  }
  if (error instanceof ProjectPolicyMissingError) {
    return 'PROJECT_POLICY_MISSING';
  }
  if (
    error instanceof ProposalTargetUnresolvedError ||
    error instanceof NotFoundException
  ) {
    return 'TARGET_UNRESOLVED';
  }
  if (isSavedPolicyInvalid(error)) {
    return 'SAVED_POLICY_INVALID';
  }
  return fallback;
}

function isSavedPolicyInvalid(error: unknown): boolean {
  if (!(error instanceof InternalServerErrorException)) {
    return false;
  }
  const body = error.getResponse();
  return (
    typeof body === 'object' &&
    body !== null &&
    'code' in body &&
    body.code === SAVED_POLICY_INVALID_CODE
  );
}

/**
 * Driver and database codes are fixed-format identifiers (Prisma `P2010`,
 * SQLSTATE `42P01`, Node `ECONNREFUSED`), unlike messages, which can embed
 * connection strings or payloads. Anything else is dropped.
 */
const SAFE_CODE_PATTERN = /^(P\d{4}|[0-9A-Z]{5}|E[A-Z]{2,24})$/;

interface CodedError {
  code?: unknown;
  errorCode?: unknown;
  meta?: { code?: unknown };
}

export interface SafeErrorCauses {
  errorCode?: string;
  databaseCode?: string;
}

function isCodedError(error: unknown): error is CodedError {
  return error instanceof Error;
}

function safeCode(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_CODE_PATTERN.test(value)
    ? value
    : undefined;
}

/** Allowlisted, bounded cause identifiers; never the error message. */
export function readSafeErrorCauses(error: unknown): SafeErrorCauses {
  if (!isCodedError(error)) {
    return {};
  }
  return {
    errorCode: safeCode(error.code) ?? safeCode(error.errorCode),
    databaseCode: safeCode(error.meta?.code),
  };
}

export function logApprovalPolicyReadFailure(
  logger: Logger,
  error: unknown,
  fallback: ApprovalPolicyReadFailureCategory,
  scope: FailureScope,
): ApprovalPolicyReadFailureCategory {
  const category = classifyApprovalPolicyReadFailure(error, fallback);
  logger.warn('Approval policy read failed in collection', {
    category,
    errorClass: error instanceof Error ? error.constructor.name : 'unknown',
    ...readSafeErrorCauses(error),
    ...scope,
    correlationId:
      EventContextManager.getInstance().getCurrentContext()?.correlationId,
  });
  return category;
}
