import { describe, expect, it, vi } from 'vitest';
import {
  SubmissionActionPoster,
  warnOnExternalAgentNodeIdMismatch,
  type PostSubmissionActionInput,
} from './action-poster';
import type { MessagePoster } from '../../run/message-poster';
import type { MessagePosterExternalAgentCompletionArgs } from '../../run/types';
import { createTestMessagePoster } from '../../run/run.test-support';
import { NOOP_LOGGER } from '../../server/logger';

const makePoster = (): MessagePoster => {
  const poster = createTestMessagePoster();
  vi.mocked(poster.submitExternalAgentCompletion).mockResolvedValue('completion-1');
  return poster;
};

const outOfBandCalls = (poster: MessagePoster) =>
  (poster.submitExternalAgentCompletion as ReturnType<typeof vi.fn>).mock.calls;

const postSubmissionAction = ({
  poster,
  effectId = EFFECT_ID,
  ...input
}: Omit<PostSubmissionActionInput, 'effectId'> &
  Partial<Pick<PostSubmissionActionInput, 'effectId'>> & {
    poster: MessagePoster;
  }): Promise<string> => new SubmissionActionPoster(poster).post({ ...input, effectId });

const EFFECT_ID = '00000000-0000-4000-8000-000000000001';

const requestFromCall = (call: unknown[]) =>
  (call[0] as MessagePosterExternalAgentCompletionArgs).request;

const dtoFromCall = requestFromCall;

const dataAsRecord = (
  request: MessagePosterExternalAgentCompletionArgs['request'],
): Record<string, unknown> => ({
  response: request['response'] ?? '',
  ...(request['providerSessionId'] !== undefined
    ? { providerSessionId: request['providerSessionId'] }
    : {}),
  ...(request['promptHandler'] !== undefined ? { promptHandler: request['promptHandler'] } : {}),
  ...(request['hidden'] === true
    ? { uiElements: [{ id: 'agent_hidden', type: 'agent_hidden', label: '' }] }
    : {}),
  completesExternalAgentNode: {
    nodeId: request['workflowNodeId'],
    action: request['action'],
    ...(request['payload'] !== undefined ? { payload: request['payload'] } : {}),
    completesTriggerMessageId: request['pendingTriggerMessageId'],
  },
});

describe('postSubmissionAction', () => {
  it('appends the completion to the conversation tail — never prepends or creates with a parent', async () => {
    const poster = makePoster();
    await postSubmissionAction({
      poster,
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: 'agent-session-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'external-agent-node-1',
      triggerMessageId: 'trigger-msg-1',
      action: { action: 'NO_DISCREPANCY' },
      stamp: null,
    });

    expect(poster.submitExternalAgentCompletion).toHaveBeenCalledTimes(1);

    const args = outOfBandCalls(poster)[0]![0] as MessagePosterExternalAgentCompletionArgs;
    expect(args.organizationId).toBe('org-1');
    expect(args.projectId).toBe('proj-1');
    expect(args.agentSessionId).toBe('agent-session-1');
    expect(args.effectId).toBe(EFFECT_ID);
    expect(args.request['conversationId']).toBe('conv-1');
    const data = dataAsRecord(args.request);
    expect(data['completesExternalAgentNode']).toEqual({
      nodeId: 'external-agent-node-1',
      action: 'NO_DISCREPANCY',
      completesTriggerMessageId: 'trigger-msg-1',
    });
    // The server bridge discriminates only on completesExternalAgentNode; flat
    // `action`/`payload` fields would collide with ordinary AGENT messages.
    expect(data).not.toHaveProperty('action');
    expect(data).not.toHaveProperty('payload');
  });

  it('back-references the originating trigger via completesTriggerMessageId on every completion', async () => {
    const poster = makePoster();
    await postSubmissionAction({
      poster,
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: 'agent-session-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'external-agent-node-iterate',
      triggerMessageId: 'trigger-msg-iterate',
      action: { action: 'REVISED', payload: { proposalIds: ['p-1'] } },
      stamp: null,
    });

    const dto = dtoFromCall(outOfBandCalls(poster)[0]!);
    expect(dataAsRecord(dto)['completesExternalAgentNode']).toEqual({
      nodeId: 'external-agent-node-iterate',
      action: 'REVISED',
      payload: { proposalIds: ['p-1'] },
      completesTriggerMessageId: 'trigger-msg-iterate',
    });
  });

  it('carries the action payload into completesExternalAgentNode.payload', async () => {
    const poster = makePoster();
    const discrepancies = [
      { summary: 'parent re-ranks child', rationale: 'observed in /parent.ts:42' },
    ];
    await postSubmissionAction({
      poster,
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: 'agent-session-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'external-agent-node-analyze',
      triggerMessageId: 'trigger-msg-analyze',
      action: { action: 'DISCREPANCY', payload: { discrepancies } },
      stamp: null,
    });

    const dto = dtoFromCall(outOfBandCalls(poster)[0]!);
    expect(dataAsRecord(dto)['completesExternalAgentNode']).toEqual({
      nodeId: 'external-agent-node-analyze',
      action: 'DISCREPANCY',
      payload: { discrepancies },
      completesTriggerMessageId: 'trigger-msg-analyze',
    });
  });

  it('stamps providerSessionId and promptHandler on the AGENT data when supplied (Turn-scoped completion)', async () => {
    const poster = makePoster();
    await postSubmissionAction({
      poster,
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: 'agent-session-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'external-agent-node-1',
      triggerMessageId: 'trigger-msg-1',
      action: { action: 'NO_DISCREPANCY' },
      stamp: { providerSessionId: 'sess-123', promptHandler: 'FEATURE_SYNC_ANALYZE' },
    });

    const dto = dtoFromCall(outOfBandCalls(poster)[0]!);
    expect(dataAsRecord(dto)['providerSessionId']).toBe('sess-123');
    expect(dataAsRecord(dto)['promptHandler']).toBe('FEATURE_SYNC_ANALYZE');
  });

  it('omits providerSessionId and promptHandler when caller passes a null stamp', async () => {
    // Callers that have no active Turn provenance (no provider session, no
    // prompt handler context) pass `stamp: null`; both fields must stay off
    // the persisted data so consumers can distinguish Turn-scoped completions
    // from out-of-band ones.
    const poster = makePoster();
    await postSubmissionAction({
      poster,
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: 'agent-session-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'external-agent-node-1',
      triggerMessageId: 'trigger-msg-1',
      action: { action: 'APPROVED' },
      stamp: null,
    });

    const dto = dtoFromCall(outOfBandCalls(poster)[0]!);
    const data = dataAsRecord(dto);
    expect(data).not.toHaveProperty('providerSessionId');
    expect(data).not.toHaveProperty('promptHandler');
  });

  it('appends a single AgentHidden uiElement when hidden: true, leaving completesExternalAgentNode unchanged', async () => {
    const poster = makePoster();
    await postSubmissionAction({
      poster,
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: 'agent-session-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'external-agent-node-1',
      triggerMessageId: 'trigger-msg-1',
      action: { action: 'NO_DISCREPANCY' },
      hidden: true,
      stamp: null,
    });

    const dto = dtoFromCall(outOfBandCalls(poster)[0]!);
    const data = dataAsRecord(dto);

    // uiElements must contain exactly the AgentHidden sentinel
    expect(data['uiElements']).toEqual([{ id: 'agent_hidden', type: 'agent_hidden', label: '' }]);

    // completesExternalAgentNode envelope is unchanged
    expect(data['completesExternalAgentNode']).toEqual({
      nodeId: 'external-agent-node-1',
      action: 'NO_DISCREPANCY',
      completesTriggerMessageId: 'trigger-msg-1',
    });
  });

  it('omits uiElements entirely when hidden is not set', async () => {
    const poster = makePoster();
    await postSubmissionAction({
      poster,
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: 'agent-session-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'external-agent-node-1',
      triggerMessageId: 'trigger-msg-1',
      action: { action: 'NO_DISCREPANCY' },
      stamp: null,
    });

    const dto = dtoFromCall(outOfBandCalls(poster)[0]!);
    expect(dataAsRecord(dto)).not.toHaveProperty('uiElements');
  });

  it('uses userFacingResponse when provided and falls back to empty string — never leaks the internal tool name', async () => {
    // With userFacingResponse supplied, that exact string is the posted
    // response. Without it, response stays empty so tool names (e.g.
    // "Submitted submit_discrepancies") never leak to the UI.
    const poster = makePoster();
    await postSubmissionAction({
      poster,
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: 'agent-session-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'external-agent-node-1',
      triggerMessageId: 'trigger-msg-disc',
      action: { action: 'DISCREPANCY', payload: { discrepancies: [] } },
      userFacingResponse: 'Flagging discrepancies for review.',
      stamp: null,
    });
    await postSubmissionAction({
      poster,
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: 'agent-session-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'external-agent-node-1',
      triggerMessageId: 'trigger-msg-1',
      action: { action: 'NO_DISCREPANCY' },
      stamp: null,
    });

    const calls = outOfBandCalls(poster);
    const first = dtoFromCall(calls[0]!);
    const second = dtoFromCall(calls[1]!);

    expect(dataAsRecord(first)['response']).toBe('Flagging discrepancies for review.');
    expect(dataAsRecord(second)['response']).toBe('');
    for (const call of calls) {
      const dto = dtoFromCall(call);
      expect(dataAsRecord(dto)['response']).not.toMatch(/submit_/);
    }
  });
});

describe('warnOnExternalAgentNodeIdMismatch', () => {
  const makeLogger = () => {
    const logger = NOOP_LOGGER.child({ component: 'submission-action-poster.test' });
    const warn = vi.spyOn(logger, 'warn');
    warn.mockClear();
    return { logger, warn };
  };

  it('emits a structured warn when declaredNodeId differs from runStampedNodeId', () => {
    const { logger, warn } = makeLogger();

    warnOnExternalAgentNodeIdMismatch(logger, {
      site: 'submission-tools.dispatchActionTool',
      runId: 'run-1',
      declaredNodeId: 'node-A',
      runStampedNodeId: 'node-B',
      triggerMessageId: 'trigger-1',
      action: 'approve',
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const [eventName, payload] = warn.mock.calls[0]!;
    expect(eventName).toBe('local.submission.external_agent_node_id_mismatch');
    expect(payload).toEqual({
      site: 'submission-tools.dispatchActionTool',
      runId: 'run-1',
      declaredNodeId: 'node-A',
      runStampedNodeId: 'node-B',
      triggerMessageId: 'trigger-1',
      action: 'approve',
    });
  });

  it('stays silent when declaredNodeId equals runStampedNodeId', () => {
    const { logger, warn } = makeLogger();

    warnOnExternalAgentNodeIdMismatch(logger, {
      site: 'assistant-complete.pending_completion',
      runId: 'run-1',
      declaredNodeId: 'node-A',
      runStampedNodeId: 'node-A',
      triggerMessageId: 'trigger-1',
      action: 'approve',
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it('treats two nulls as equal (no warn)', () => {
    const { logger, warn } = makeLogger();

    warnOnExternalAgentNodeIdMismatch(logger, {
      site: 'assistant-complete.pending_completion',
      runId: 'run-1',
      declaredNodeId: null,
      runStampedNodeId: null,
      triggerMessageId: null,
    });

    expect(warn).not.toHaveBeenCalled();
  });
});
