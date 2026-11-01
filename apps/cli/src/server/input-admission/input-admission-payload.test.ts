import { request } from '../../agents/repository-feature-enrichment/repository-feature-enrichment.test-fixture';
import { describe, expect, it } from 'vitest';
import {
  LocalPromptType,
  type AgentTrigger,
} from '../../shared/agent-bridge-contract/generated/api';
import { validateTriggerPayload } from '../conversation-dispatch/trigger-payload-schemas';
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

  it('stores a handoff with the created Feature identities', () => {
    const payload = request;
    const event = {
      promptType: LocalPromptType.RepositoryFeatureEnrichment,
      nodeId: 'onboarding-repository-feature-enrichment',
      triggerMessageId: 'trigger-1',
      payload,
    } as unknown as AgentTrigger;
    const validated = validateTriggerPayload(LocalPromptType.RepositoryFeatureEnrichment, payload);

    const stored = toStoredTriggerFrame(null, event, validated);

    expect(stored.event).toMatchObject({
      payload: { materializedFeatureIds: payload.materializedFeatureIds },
    });
  });
});
