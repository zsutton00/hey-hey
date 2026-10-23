import {
  parseProposalApprovalFailure,
  proposalApprovalFailureMessage,
  serializeProposalApprovalFailure,
  toProposalApprovalFailureDiagnostic,
} from '../proposal-approval-failure-diagnostic';

describe('proposal approval failure diagnostics', () => {
  it('normalizes generated issue fields and bounds the returned collection', () => {
    const diagnostic = toProposalApprovalFailureDiagnostic(
      {
        response: {
          data: {
            issues: Array.from({ length: 40 }, (_, index) => ({
              field: `operations[${index}].name`,
              code: 'invalid',
              reason: 'Invalid value',
              layer: 'structural',
              metadata: { requestBody: 'private payload' },
            })),
          },
        },
      },
      'correlation-1',
    );

    expect(diagnostic.issues).toHaveLength(32);
    expect(diagnostic.issueCount).toBe(40);
    expect(diagnostic.truncated).toBe(true);
    expect(diagnostic.correlationId).toBe('correlation-1');
    expect(diagnostic.issues[0]).toEqual({
      field: 'operations[0].name',
      code: 'invalid',
      reason: 'Invalid value',
      layer: 'structural',
    });
  });

  it('round-trips bounded durable failure state without arbitrary payloads', () => {
    const diagnostic = toProposalApprovalFailureDiagnostic(
      {
        projection: {
          valid: false,
          issues: [
            {
              field: 'operations[0].name',
              code: 'required',
              reason: 'Name is required',
              layer: 'referential',
              suggestion: 'Provide a name',
            },
          ],
        },
      },
      'correlation-2',
    );
    const persisted = serializeProposalApprovalFailure(
      'Cannot materialize an invalid work-item change set',
      diagnostic,
    );

    expect(parseProposalApprovalFailure(persisted)).toEqual({
      message: 'Cannot materialize an invalid work-item change set',
      diagnostic: {
        issues: [
          {
            field: 'operations[0].name',
            code: 'required',
            reason: 'Name is required',
            layer: 'referential',
            suggestion: 'Provide a name',
          },
        ],
        issueCount: 1,
        truncated: false,
        correlationId: 'correlation-2',
      },
    });
    expect(persisted).not.toContain('requestBody');
  });

  it('preserves an API-owned message from an HTTP response', () => {
    expect(
      proposalApprovalFailureMessage({
        response: { data: { message: 'Projection requires retry' } },
      }),
    ).toBe('Projection requires retry');
  });
});
