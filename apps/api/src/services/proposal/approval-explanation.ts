import Ajv from 'ajv';
import type { Prisma } from '@prisma/client';
import type { ProposalApprovalExplanation } from 'src/generated';
import { approvalPolicySchema } from 'src/generated/approval-policy.schema';
import type { ApprovalEvaluation } from './permission-evaluation';

const validateExplanation = new Ajv({
  strict: false,
  formats: { int32: true },
}).compile<ProposalApprovalExplanation>({
  ...approvalPolicySchema,
  $ref: '#/definitions/ProposalApprovalExplanation',
});

/** Viewer identity and actions are never part of durable decision evidence. */
export function captureApprovalEvidence(
  evaluation: ApprovalEvaluation,
  creditedProposerApprovals: number,
): Prisma.JsonObject {
  return {
    ...evaluation.explanation,
    conditions: evaluation.explanation.conditions
      ? { ...evaluation.explanation.conditions }
      : null,
    requirement: evaluation.explanation.requirement
      ? { ...evaluation.explanation.requirement }
      : null,
    changedFieldClassification: evaluation.explanation
      .changedFieldClassification
      ? { ...evaluation.explanation.changedFieldClassification }
      : null,
    evidence: 'CAPTURED',
    creditedProposerApprovals,
  };
}

export function readApprovalEvidence(
  value: unknown,
): ProposalApprovalExplanation | null {
  if (value === null || value === undefined) {
    return null;
  }
  // This is the disk trust boundary; validate against the generated contract once.
  const candidate = Object.assign({}, value, {
    viewerEligibility: { eligibleToApprove: false },
  });
  if (
    !validateExplanation(candidate) ||
    candidate.evidence !== 'CAPTURED' ||
    candidate.source === null ||
    candidate.conditions === null ||
    candidate.requirement === null ||
    candidate.changedFields === null ||
    candidate.changedFieldClassification === null ||
    candidate.creditedProposerApprovals === null
  ) {
    throw new Error('Stored approval decision evidence is invalid');
  }
  return candidate;
}

export function unavailableApprovalExplanation(): ProposalApprovalExplanation {
  return {
    evidence: 'UNAVAILABLE',
    source: null,
    conditions: null,
    requirement: null,
    changedFields: null,
    changedFieldClassification: null,
    creditedProposerApprovals: null,
    viewerEligibility: { eligibleToApprove: false },
  };
}
