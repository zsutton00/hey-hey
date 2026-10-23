import { describe, expect, it } from 'vitest';
import type { AgentTrigger } from '../../shared/agent-bridge-contract/generated/api';
import { toStoredTriggerFrame } from './input-admission-payload';

const followUp = (payload: Record<string, unknown>): AgentTrigger =>
  ({
    promptType: 'user_message',
    operationId: '11111111-1111-4111-8111-111111111111',
    operationFingerprint: 'a'.repeat(64),
    triggerMessageId: 'trigger-1',
    sourceUserMessageId: 'source-1',
    payload,
  }) as unknown as AgentTrigger;

describe('toStoredTriggerFrame', () => {
  it('keeps the runtime a user picked for a Commit follow-up, so a restored input runs on it', () => {
    const runtime = { provider: 'codex', model: 'gpt-5.5', reasoningEffort: 'low', fastMode: true };
    const payload = { handlerPromptType: 'commit', userMessage: '', attachments: [], runtime };

    const stored = toStoredTriggerFrame(null, followUp(payload), payload);

    expect(stored.event).toMatchObject({ payload: { runtime } });
  });

  it('stores a follow-up without a selection without one', () => {
    const payload = { handlerPromptType: 'code_review', userMessage: '', attachments: [] };

    const stored = toStoredTriggerFrame(null, followUp(payload), payload);

    expect((stored.event as { payload: object }).payload).not.toHaveProperty('runtime');
  });
});
