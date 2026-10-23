import { describe, expect, it, vi } from 'vitest';
import { createTestOAuthClient } from '../../auth/oauth-client.test-support';
import { EntityConversationHandler } from '../../agents/entity-conversation/entity-conversation.handler';
import { createOnCompleteTestDeps } from '../../agents/prompt-type-handler.test-support';
import { SubmissionToolAuth } from '../../agents/submission-tools/submission-tool-auth';
import type { VerifyFeaturePayload } from '../../shared/api/generated/api';
import { handleAssistantComplete } from './assistant-complete';
import { handleAssistantDelta } from './assistant-delta';
import { makeDeps, makePoster, makeTestRun, makeTestTurn } from './__test-utils';

const proposalIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];
const featureCheck = {
  feature: { entityType: 'FEATURE', entityId: '33333333-3333-4333-8333-333333333333' },
  explanation: 'The delivered behavior changed.',
  impactedEntities: [],
} satisfies VerifyFeaturePayload;

function setup() {
  const poster = makePoster();
  const deps = makeDeps(poster);
  const handler = new EntityConversationHandler({
    auth: new SubmissionToolAuth(createTestOAuthClient()),
    apiBaseUrl: 'https://api.test/v1',
    fetchImpl: vi.fn(),
    logger: deps.logger,
  });
  deps.onCompleteDeps = createOnCompleteTestDeps({ logger: deps.logger, poster });
  const turn = makeTestTurn(handler);
  const run = makeTestRun({ lastSubmissionAction: { action: 'DONE' } });
  const eventBase = {
    runId: run.runId,
    source: 'provider' as const,
    eventType: 'agent_output',
    timestamp: '2026-09-14T09:00:00.000Z',
    sessionId: 'session-1',
    agentId: 'claude',
    payload: {},
  };
  vi.spyOn(run, 'readReportIdsForTurn').mockReturnValue(['report-1']);
  const delta = (summary: string) =>
    handleAssistantDelta({ ...eventBase, kind: 'assistant_delta', summary }, run, deps, turn);
  const complete = (summary: string) =>
    handleAssistantComplete({ ...eventBase, kind: 'assistant_complete', summary }, run, deps, turn);
  return { poster, deps, turn, delta, complete };
}

describe('Entity Conversation completion after mid-turn proposals', () => {
  it.each(['escaped', 'literal'] as const)(
    'publishes the reported reply with %s newlines without its completion wrapper',
    async (newlines) => {
      const { poster, turn, delta, complete } = setup();
      const response = `Yes — that’s the conclusion of the thread. @[task:d6d1dce5-40c3-4c6c-8909-9bb4852eaeff|Turn-End Proposal Attachment] removes carrier-message ownership for new turns, attaching canonical Proposal/Report IDs atomically to the final SYSTEM message. The Coding Plan report should therefore remain alongside the message whose reply is persisted.



Separate “reply missing” causes may still exist: @[task:c7ece6a8-30f6-442d-8dc3-edeb30785343|Coding Plan review responses do not restore chosen action and feedback] remains distinct, as do websocket/cache visibility and grouped-Proposal ownership regressions.`;
      const envelope = JSON.stringify({ response });
      // The pasted reproduction contains literal line breaks inside the JSON string.
      const summary = newlines === 'literal' ? envelope.replaceAll('\\n', '\n') : envelope;
      for (const id of proposalIds) turn.recordCreatedProposal(id);

      await delta(summary);
      expect(poster.createOutOfBand).not.toHaveBeenCalled();
      expect(poster.update).not.toHaveBeenCalled();

      await complete(summary);

      expect(poster.createOutOfBand).toHaveBeenCalledTimes(1);
      const final = vi.mocked(poster.createOutOfBand).mock.calls[0]?.[0].dto;
      expect(final).toMatchObject({
        proposalIds,
        reportIds: ['report-1'],
        data: { response, actionHint: 'task_complete' },
      });
      expect(final?.data).not.toHaveProperty('uiElements');
      expect(JSON.stringify(vi.mocked(poster.createOutOfBand).mock.calls)).not.toContain(
        'featureUpdateSyncCheck',
      );
      expect(poster.update).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['omitted', undefined],
    ['explicit null', null],
    ['valid', featureCheck],
    ['malformed', {}],
  ] as const)(
    'unwraps an older envelope with %s feature metadata and preserves attachments',
    async (_label, check) => {
      const { poster, turn, delta, complete } = setup();
      turn.recordCreatedProposal(proposalIds[0]!);
      await delta('Created the first proposal.');
      turn.recordCreatedProposal(proposalIds[1]!);
      await delta('Created the second proposal.');
      const summary = JSON.stringify({
        response: 'Two proposals are ready.',
        ...(check !== undefined ? { featureUpdateSyncCheck: check } : {}),
      });

      // Providers can emit the terminal envelope as a delta before completion.
      await delta(summary);
      expect(poster.createOutOfBand).toHaveBeenCalledTimes(1);
      expect(poster.update).toHaveBeenCalledTimes(1);
      expect(vi.mocked(poster.update).mock.calls[0]?.[3].data).toMatchObject({
        response: expect.stringMatching(
          /Created the first proposal\.[\s\S]*Created the second proposal\./,
        ),
      });

      await complete(summary);

      expect(poster.createOutOfBand).toHaveBeenCalledTimes(2);
      const final = vi.mocked(poster.createOutOfBand).mock.calls[1]?.[0].dto;
      expect(final).toMatchObject({
        proposalIds,
        reportIds: ['report-1'],
        data: { response: 'Two proposals are ready.', actionHint: 'task_complete' },
      });
      expect(final?.data).not.toHaveProperty('uiElements');
      expect(JSON.stringify(vi.mocked(poster.createOutOfBand).mock.calls)).not.toContain(
        'featureUpdateSyncCheck',
      );
      expect(JSON.stringify(vi.mocked(poster.update).mock.calls)).not.toContain(
        'featureUpdateSyncCheck',
      );
      expect(turn.readCreatedProposalIds()).toEqual([]);
    },
  );

  it.each([{}, { featureUpdateSyncCheck: null }, { response: '', featureUpdateSyncCheck: null }])(
    'rejects invalid primary content and retains proposals for retry (%j)',
    async (envelope) => {
      const { poster, deps, turn, complete } = setup();
      for (const id of proposalIds) turn.recordCreatedProposal(id);
      await complete(JSON.stringify(envelope));
      expect(poster.createOutOfBand).not.toHaveBeenCalled();
      expect(turn.readCreatedProposalIds()).toEqual(proposalIds);
      expect(turn.completionCorrection.hasPendingRejection).toBe(true);
      expect(deps.logger.warn).not.toHaveBeenCalledWith(
        'completion_reconciliation.rejected',
        expect.anything(),
      );
      await complete(JSON.stringify({ response: 'Done' }));
      expect(turn.completionCorrection.hasPendingRejection).toBe(false);
      expect(poster.createOutOfBand).toHaveBeenCalledWith(
        expect.objectContaining({
          dto: expect.objectContaining({
            proposalIds,
            data: expect.objectContaining({ response: 'Done' }),
          }),
        }),
      );
    },
  );

  it.each(['Ordinary reply', '{'])(
    'preserves the established text fallback for %j',
    async (summary) => {
      const { poster, turn, complete } = setup();
      for (const id of proposalIds) turn.recordCreatedProposal(id);
      await complete(summary);
      expect(poster.createOutOfBand).toHaveBeenCalledWith(
        expect.objectContaining({
          dto: expect.objectContaining({
            proposalIds,
            data: expect.objectContaining({ response: summary }),
          }),
        }),
      );
    },
  );
});
