import { ConflictException } from '@nestjs/common';
import {
  parseProposalApprovalFailure,
  proposalApprovalFailureMessage,
  serializeProposalApprovalFailure,
  toProposalApprovalFailureDiagnostic,
} from '../proposal-approval-failure-diagnostic';

describe('proposal approval failure diagnostics', () => {
  it('reads Nest issues ahead of payload data and preserves bounded originating correlation', () => {
    const diagnostic = toProposalApprovalFailureDiagnostic(
      new ConflictException({
        message: 'Reconciliation required',
        correlationId: 'origin'.repeat(200),
        data: { unrelated: true },
        issues: [
          {
            field: 'definition.name',
            code: 'changed',
            reason: 'Changed after review',
            layer: 'referential',
            suggestion: 'Review again',
          },
        ],
      }),
      'header-id',
    );
    expect(diagnostic.correlationId).toBe('origin'.repeat(200).slice(0, 512));
    expect(diagnostic.issues).toEqual([
      {
        field: 'definition.name',
        code: 'changed',
        reason: 'Changed after review',
        layer: 'referential',
        suggestion: 'Review again',
      },
    ]);
  });

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
