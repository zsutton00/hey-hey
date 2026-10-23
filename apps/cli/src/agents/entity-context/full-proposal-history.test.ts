import { describe, expect, it } from 'vitest';
import type { EntityContextDtoProposalsInner } from '../../shared/api/generated/api';
import { assertFullProposalHistory } from './full-proposal-history';

describe('assertFullProposalHistory', () => {
  it('accepts authoritative proposal payloads and rejects summaries', () => {
    const full = [{ updates: {} }] as EntityContextDtoProposalsInner[];
    expect(() => assertFullProposalHistory(full)).not.toThrow();

    const summary = [{ changes: [] }] as unknown as EntityContextDtoProposalsInner[];
    expect(() => assertFullProposalHistory(summary)).toThrow(
      'Context full proposal detail returned a summary payload.',
    );
  });
});
