import { describe, expect, it, vi } from 'vitest';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import { ProposalReconciliationSubmission } from './reconciliation-submission';
import { parseCandidate, parseReconciliationResponse } from './reconciliation-boundary';

const proposalId = '10000000-0000-4000-8000-000000000001';
const state = {
  status: 'AGENT_FIX_REQUIRED',
  futureRevision: 4,
  currentBases: [
    { entityType: 'TASK', entityId: proposalId, version: 'current', content: { name: 'Current' } },
  ],
  revisions: [],
  conflictingPaths: [],
  interveningProposals: [],
  overlaps: [],
};
const response = (data: object, status = 200) =>
  new Response(JSON.stringify({ data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('scoped reconciliation submission', () => {
  it('uses server-owned current bases and submits only to the selected proposal', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(state))
      .mockResolvedValueOnce(
        response({ ...state, replacementProposalId: '10000000-0000-4000-8000-000000000002' }),
      );
    const deps = {
      apiBaseUrl: 'http://local.test',
      fetchImpl,
      auth: { getAccessToken: async () => 'test-token' },
      logger: { info: vi.fn() },
    } as unknown as PromptTypeHandlerDeps;
    const tool = new ProposalReconciliationSubmission();
    await tool.prepare('run', { deps, organizationId: 'org', projectId: 'project', proposalId });
    await tool.execute({
      runId: 'run',
      args: {
        method: 'AGENT_FIX',
        proposedResult: { name: 'Reconciled' },
        expectedCurrentBases: [],
      },
    });
    const [url, request] = fetchImpl.mock.calls[1]!;
    expect(url).toBe(
      `http://local.test/organizations/org/projects/project/proposals/${proposalId}/reconciliation`,
    );
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body)).toEqual({
      method: 'AGENT_FIX',
      proposedResult: { name: 'Reconciled' },
      expectedCurrentBases: state.currentBases,
      expectedFutureRevision: 4,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns refreshed context after drift without automatically resubmitting or applying', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(state))
      .mockResolvedValueOnce(response({}, 409))
      .mockResolvedValueOnce(
        response({ ...state, currentBases: [{ ...state.currentBases[0], version: 'newer' }] }),
      );
    const deps = {
      apiBaseUrl: 'http://local.test',
      fetchImpl,
      auth: { getAccessToken: async () => 'test-token' },
      logger: { info: vi.fn() },
    } as unknown as PromptTypeHandlerDeps;
    const tool = new ProposalReconciliationSubmission();
    await tool.prepare('run', { deps, organizationId: 'org', projectId: 'project', proposalId });
    const result = await tool.execute({ runId: 'run', args: { method: 'MERGE' } });
    expect(result.content[0]?.text).toContain('newer');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchImpl.mock.calls[1]![1].body)).toEqual({ method: 'MERGE' });
  });

  it('rejects malformed candidate and server data at the OpenAPI-derived boundary', () => {
    expect(() => parseCandidate({ method: 'AGENT_FIX', proposedResult: {} })).toThrow();
    expect(() => parseCandidate({ method: 'MERGE', approve: true })).toThrow();
    expect(() => parseReconciliationResponse({ data: { status: 'CURRENT' } })).toThrow();
    expect(
      parseCandidate({
        method: 'AGENT_FIX',
        proposedResult: {},
        expectedCurrentBases: state.currentBases,
      }).method,
    ).toBe('AGENT_FIX');
  });
});
