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

  it('stores a repository enrichment request whose reviewed candidates are the contract hierarchy', () => {
    const hierarchy = {
      topLevels: [
        {
          id: 'imports',
          name: 'Repository Imports',
          description: 'Import repository capabilities.',
          tag: 'product',
          children: [
            { id: 'review', name: 'Import Review', description: 'Review imports.', tag: 'frontend' },
          ],
        },
      ],
    };
    const payload = {
      promptType: LocalPromptType.RepositoryFeatureEnrichment,
      projectId: '11111111-1111-4111-8111-111111111111',
      conversationId: '22222222-2222-4222-8222-222222222222',
      workflowId: '33333333-3333-4333-8333-333333333333',
      workflowNodeId: 'onboarding-repository-feature-enrichment',
      serviceId: '44444444-4444-4444-8444-444444444444',
      machineId: '55555555-5555-4555-8555-555555555555',
      provider: 'codex',
      resolvedFrontierModel: 'gpt-6-astra',
      reasoningEffort: 'high',
      analysis: {
        outcome: 'success',
        serviceId: '44444444-4444-4444-8444-444444444444',
        provider: 'codex',
        resolvedFrontierModel: 'gpt-6-astra',
        narrative: 'Repository discovery.',
        hierarchy,
        evidence: [{ path: 'src/import.ts', summary: 'Repository import behavior.' }],
        briefDiscrepancies: [],
      },
      reviewedCandidates: { topLevels: [{ ...hierarchy.topLevels[0]!, name: 'Reviewed Imports' }] },
      completedRounds: 0,
      answerBatches: [],
    };
    const event = {
      promptType: LocalPromptType.RepositoryFeatureEnrichment,
      nodeId: 'onboarding-repository-feature-enrichment',
      triggerMessageId: 'trigger-1',
      payload,
    } as unknown as AgentTrigger;
    const validated = validateTriggerPayload(LocalPromptType.RepositoryFeatureEnrichment, payload);

    const stored = toStoredTriggerFrame(null, event, validated);

    expect(stored.event).toMatchObject({ payload: { reviewedCandidates: payload.reviewedCandidates } });
  });
});
