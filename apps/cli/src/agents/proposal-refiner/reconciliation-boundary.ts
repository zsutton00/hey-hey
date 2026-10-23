import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { CreateProposalReconciliationCandidate, ProposalReconciliationState } from '../../shared/api/generated/api';
import { proposalReconciliationCandidateSchema, proposalReconciliationStateSchema } from '../../shared/api/generated/proposal-reconciliation.schema';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateCandidate = ajv.compile<CreateProposalReconciliationCandidate>(proposalReconciliationCandidateSchema);
const validateState = ajv.compile<ProposalReconciliationState>(proposalReconciliationStateSchema);

export function parseCandidate(value: unknown): CreateProposalReconciliationCandidate {
  if (!validateCandidate(value)) throw new Error('Candidate does not match the reconciliation API contract.');
  return value;
}

export function parseReconciliationResponse(value: unknown): ProposalReconciliationState {
  if (value === null || typeof value !== 'object' || !('data' in value) || !validateState(value.data)) {
    throw new Error('Reconciliation response does not match the API contract.');
  }
  return value.data;
}
