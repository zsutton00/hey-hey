import { ForbiddenException } from '@nestjs/common';
import { assertProposalApplicationEligible } from '../proposal-application-eligibility';

describe('assertProposalApplicationEligible', () => {
  it('refuses an application-ineligible proposal whatever its ragEnabled says', () => {
    for (const ragEnabled of [true, false]) {
      expect(() =>
        assertProposalApplicationEligible(
          {
            id: 'proposal-1',
            applicationEligible: false,
            ragEnabled,
          } as never,
          'approve',
        ),
      ).toThrow(ForbiddenException);
    }
  });

  it('lets an eligible proposal through even when it is excluded from ingestion', () => {
    expect(() =>
      assertProposalApplicationEligible(
        {
          id: 'proposal-1',
          applicationEligible: true,
          ragEnabled: false,
        } as never,
        'approve',
      ),
    ).not.toThrow();
  });
});
