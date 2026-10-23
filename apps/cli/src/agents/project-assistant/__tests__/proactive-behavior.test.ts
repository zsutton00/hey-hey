import { describe, expect, it } from 'vitest';
import type { ProjectAssistantPolicy } from '../../prompt-type-handler';
import { resolveProjectAssistantPolicy } from '../proactive-behavior';

const ceiling: ProjectAssistantPolicy = {
  allowEdgeUpdates: false,
  notifyDiscrepancies: true,
  workItemProposalMode: 'edit',
};

describe('resolveProjectAssistantPolicy', () => {
  it('returns no policy without a handler declaration', () => {
    expect(resolveProjectAssistantPolicy(undefined)).toBeUndefined();
  });

  it('returns the handler declaration unchanged when config is omitted', () => {
    expect(resolveProjectAssistantPolicy(ceiling)).toEqual(ceiling);
  });

  it('returns the handler declaration unchanged when explicitly enabled', () => {
    expect(resolveProjectAssistantPolicy(ceiling, { enabled: true })).toEqual(ceiling);
  });

  it('returns no policy when explicitly disabled', () => {
    expect(resolveProjectAssistantPolicy(ceiling, { enabled: false })).toBeUndefined();
  });

  it('narrows edge and discrepancy authority from persisted config', () => {
    expect(
      resolveProjectAssistantPolicy(ceiling, {
        notifyDiscrepancies: false,
      }),
    ).toEqual({
      allowEdgeUpdates: false,
      notifyDiscrepancies: false,
      workItemProposalMode: 'edit',
    });
  });

  it('preserves the handler ceiling when config flags are true', () => {
    expect(
      resolveProjectAssistantPolicy(ceiling, {
        allowEdgeUpdates: true,
        notifyDiscrepancies: true,
      }),
    ).toEqual({
      allowEdgeUpdates: false,
      notifyDiscrepancies: true,
      workItemProposalMode: 'edit',
    });
  });

  it('disables proposals independently from participation', () => {
    expect(resolveProjectAssistantPolicy(ceiling, { allowUpdateProposals: false })).toEqual({
      allowEdgeUpdates: false,
      notifyDiscrepancies: true,
      workItemProposalMode: 'none',
    });
  });
});
