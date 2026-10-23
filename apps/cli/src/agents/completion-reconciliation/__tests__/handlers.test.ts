import { describe, expect, it } from 'vitest';
import type { AssistantCompleteEvent, AssistantDeltaEvent } from '../../../run/types';
import { implementHandler } from '../../implement/implement.handler';
import { codingFreeformHandler, freeFormHandler } from '../../coding-conversation';
import { EntityConversationHandler } from '../../entity-conversation/entity-conversation.handler';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../../prompt-type-registry.test-support';
import { resolveMcpToolNames } from '../../mcp-server-config';

const handlers = [
  implementHandler,
  freeFormHandler,
  codingFreeformHandler,
  new EntityConversationHandler(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES.entityConversation),
];
function event(summary: string): AssistantCompleteEvent {
  return {
    kind: 'assistant_complete',
    summary,
    runId: 'run',
    source: 'provider',
    eventType: 'complete',
    timestamp: '2026-09-04T00:00:00Z',
    sessionId: 'provider-session',
    agentId: null,
    payload: {},
  };
}

function delta(summary: string): AssistantDeltaEvent {
  return { ...event(summary), kind: 'assistant_delta' };
}

describe.each(handlers)('$id completion boundary', (handler) => {
  it('retains resumable provider sessions and task proposal tool access', () => {
    expect(handler.runnerKind).toBe('provider_session');
    expect(resolveMcpToolNames({ useCase: handler.mcpToolUseCase ?? 'general' })).toContain(
      'edit_work_item',
    );
  });
  it('maps text-only completion without leaking structured JSON', () => {
    const completion = event(JSON.stringify({ response: 'Ordinary response' }));
    expect(handler.validateCompletion?.(completion)).toEqual({ ok: true });
    expect(handler.transformCompletionOutput?.(completion)).toMatchObject({
      data: { type: 'AGENT', response: 'Ordinary response' },
    });
    expect(handler.isCompletionOutput?.(delta(completion.summary))).toBe(true);
  });
  it('maps a legacy unstructured response', () => {
    const completion = event('Ordinary unstructured response');
    expect(handler.validateCompletion?.(completion)).toEqual({ ok: true });
    expect(handler.transformCompletionOutput?.(completion)).toMatchObject({
      data: { type: 'AGENT', response: 'Ordinary unstructured response' },
    });
    expect(handler.isCompletionOutput?.(delta(completion.summary))).toBe(false);
  });
  it('maps an older envelope carrying a feature check to a plain reply', () => {
    const check = {
      feature: { entityType: 'FEATURE', entityId: '3782302e-54ad-4908-b168-0b2260a89b3c' },
      explanation: 'Material impact',
    };
    const completion = event(JSON.stringify({ response: 'Done', featureUpdateSyncCheck: check }));
    expect(handler.validateCompletion?.(completion)).toEqual({ ok: true });
    const output = handler.transformCompletionOutput?.(completion);
    expect(output).toMatchObject({ data: { response: 'Done' } });
    expect(output?.data).not.toHaveProperty('uiElements');
  });
  it.each([
    ['omitted', { response: 'Done' }],
    ['explicit null', { response: 'Done', featureUpdateSyncCheck: null }],
    ['malformed', { response: 'Done', featureUpdateSyncCheck: {} }],
  ])('publishes valid primary text when older feature metadata is %s', (_label, envelope) => {
    const completion = event(JSON.stringify(envelope));
    expect(handler.isCompletionOutput?.(delta(completion.summary))).toBe(true);
    expect(handler.validateCompletion?.(completion)).toEqual({ ok: true });
    const output = handler.transformCompletionOutput?.(completion);
    expect(output).toMatchObject({
      data: { response: 'Done' },
    });
    expect(output?.data).not.toHaveProperty('uiElements');
  });
  it.each([{}, { featureUpdateSyncCheck: null }, { response: '', featureUpdateSyncCheck: null }])(
    'rejects invalid or missing primary response (%j)',
    (envelope) => {
      const completion = event(JSON.stringify(envelope));
      expect(handler.isCompletionOutput?.(delta(completion.summary))).toBe(false);
      expect(handler.validateCompletion?.(completion)).toMatchObject({ ok: false });
    },
  );
});
