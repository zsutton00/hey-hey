import { BadRequestException } from '@nestjs/common';
import { ProposalReconciliationCandidatePipe } from 'src/pipes/proposal-reconciliation-candidate.pipe';
const pipe = new ProposalReconciliationCandidatePipe();
describe('OpenAPI reconciliation boundary', () => {
  it('accepts Merge without inventing Agent fix fields', () => {
    expect(pipe.transform({ method: 'MERGE' })).toEqual({ method: 'MERGE' });
  });
  it('requires Agent fix to include both the candidate and exact server basis', () => {
    expect(() =>
      pipe.transform({ method: 'AGENT_FIX', proposedResult: {} }),
    ).toThrow(BadRequestException);
    const candidate = {
      method: 'AGENT_FIX',
      proposedResult: { name: 'Reviewed result' },
      expectedCurrentBases: [
        {
          entityType: 'TASK',
          entityId: '30000000-0000-4000-8000-000000000001',
          version: 'v2',
          content: { name: 'Current' },
        },
      ],
    };
    expect(pipe.transform(candidate)).toEqual(candidate);
  });
  it('admits manual results only with a server-issued basis', () => {
    expect(() =>
      pipe.transform({ method: 'MANUAL', proposedResult: {} }),
    ).toThrow(BadRequestException);
    expect(
      pipe.transform({
        method: 'MANUAL',
        proposedResult: { name: 'Resolved' },
        expectedCurrentBases: [],
        expectedFutureRevision: 3,
      }),
    ).toMatchObject({ method: 'MANUAL', expectedFutureRevision: 3 });
  });
  it('rejects acknowledgement or approval fields as candidate authorization', () => {
    expect(() =>
      pipe.transform({ method: 'MERGE', acknowledgeOutOfDate: true }),
    ).toThrow(BadRequestException);
    expect(() => pipe.transform({ method: 'MERGE', reviewed: true })).toThrow(
      BadRequestException,
    );
  });
});
