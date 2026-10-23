import { describe, expect, it, vi } from 'vitest';

import { IncludeExistingProposalsInCurrentMessageTool } from './include-existing-proposals-in-current-message-tool';
import { makeTestTurn } from '../../run/handlers/__test-utils';
import { codingFreeformHandler } from '../coding-conversation';

describe('IncludeExistingProposalsInCurrentMessageTool', () => {
  it('merges existing IDs into the real active Turn without an external write', () => {
    const turn = makeTestTurn(codingFreeformHandler);
    const created = '11111111-1111-4111-8111-111111111111';
    const existing = '22222222-2222-4222-8222-222222222222';
    turn.recordCreatedProposal(created);
    const result = new IncludeExistingProposalsInCurrentMessageTool().execute({
      runId: 'run-1',
      args: { proposalIds: [existing, created, existing] },
      run: { activeTurn: turn } as never,
    });
    expect(JSON.parse(result.content[0]!.text)).toEqual({ proposalIds: [created, existing] });
    expect(turn.snapshotCompletionArtifactIds([]).proposalIds).toEqual([created, existing]);
  });

  it('adds canonical IDs to the active Turn', () => {
    const includeExistingProposals = vi.fn();
    const readCreatedProposalIds = vi.fn(() => ['11111111-1111-4111-8111-111111111111']);
    const tool = new IncludeExistingProposalsInCurrentMessageTool();
    const result = tool.execute({
      runId: 'run-1',
      args: { proposalIds: ['11111111-1111-4111-8111-111111111111'] },
      run: { activeTurn: { includeExistingProposals, readCreatedProposalIds } } as never,
    });

    expect(includeExistingProposals).toHaveBeenCalledOnce();
    expect(result.content[0]?.text).toContain('11111111-1111-4111-8111-111111111111');
  });

  it('rejects calls without an active Turn', () => {
    const tool = new IncludeExistingProposalsInCurrentMessageTool();
    expect(() =>
      tool.execute({ runId: 'run-1', args: { proposalIds: [] }, run: {} as never }),
    ).toThrow('No active Turn');
  });
});
