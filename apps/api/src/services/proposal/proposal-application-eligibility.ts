import { ForbiddenException, Logger } from '@nestjs/common';

const logger = new Logger('ProposalApplicationEligibility');

type EligibilityRecord = {
  id: string;
  applicationEligible?: boolean;
};

/**
 * Eval output must never change project state, whichever path tries to
 * approve, enact or materialize it. Kept independent of ragEnabled.
 */
export function assertProposalApplicationEligible(
  proposal: EligibilityRecord,
  operation: string,
): void {
  if (proposal.applicationEligible !== false) return;
  logger.warn('Refusing to apply application-ineligible proposal', {
    proposalId: proposal.id,
    operation,
  });
  throw new ForbiddenException(
    `Proposal ${proposal.id} is evaluation output and cannot be approved or applied`,
  );
}
