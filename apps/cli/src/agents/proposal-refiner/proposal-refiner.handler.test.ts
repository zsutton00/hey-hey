import { describe, expect, it, vi } from 'vitest';
import { proposalRefinerHandler } from './proposal-refiner.handler';
import type { LocalProposalRefinerPromptPayload } from '../../shared/agent-bridge-contract/generated/api';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import type { AgenticSession } from '../../session/types';

it('carries authoritative generated context through the refiner prompt and scoped candidate submission', async () => {
  const proposalId = '10000000-0000-4000-8000-000000000001';
  const state = { status: 'AGENT_FIX_REQUIRED', currentBases: [{ entityType: 'TASK', entityId: proposalId,
    version: 'current-version', content: { name: 'Intervening content' } }], revisions: [], conflictingPaths: [] };
  const response = (data: object) => new Response(JSON.stringify({ data }), { status: 200 });
  const fetchImpl = vi.fn().mockResolvedValueOnce(response(state)).mockResolvedValueOnce(response({}))
    .mockResolvedValueOnce(response({ ...state, replacementProposalId: '10000000-0000-4000-8000-000000000002' }));
  const deps = { apiBaseUrl: 'http://local.test', fetchImpl, auth: { getAccessToken: async () => 'test-token' },
    logger: { info: vi.fn(), warn: vi.fn() } } as unknown as PromptTypeHandlerDeps;
  const run = { agentic_session_id: 'refiner-run', contextMetadata: { organizationId: 'org', projectId: 'project' } } as unknown as AgenticSession;
  const payload: LocalProposalRefinerPromptPayload = { payloadVersion: 1, userMessage: 'Reconcile this proposal while preserving intervening content.', proposal: {
    id: proposalId, action: 'UPDATE', status: 'PENDING', targetEntityId: proposalId, targetEntityType: 'TASK', updates: { name: 'Proposed' },
  } };
  const prepared = await proposalRefinerHandler.prepare!(run, payload, deps);
  expect(prepared.payload.proposal.reconciliation).toEqual(state);
  const prompt = proposalRefinerHandler.buildPrompt(prepared.payload);
  expect(prompt).toContain('Intervening content');
  expect(prompt).toContain('Ask the user');
  expect(prompt).toContain('submit_proposal_reconciliation');
  const tool = proposalRefinerHandler.submissionTools![0]!;
  if (tool.kind !== 'pass_through') throw new Error('Expected scoped reconciliation tool');
  await tool.execute({ runId: run.agentic_session_id, args: { method: 'AGENT_FIX', proposedResult: { name: 'Reviewed' }, expectedCurrentBases: state.currentBases } });
  expect(fetchImpl).toHaveBeenCalledTimes(3);
  const submitted = JSON.parse(fetchImpl.mock.calls[2]![1].body);
  expect(submitted.expectedCurrentBases).toEqual(state.currentBases);
  expect(submitted.proposedResult).toEqual({ name: 'Reviewed' });
});
