import { describe, expect, it } from 'vitest';
import { storedInput, decodeStoredRecord } from './input-admission-codec';
import { toStoredTriggerFrame } from './input-admission-payload';
import { ImplementPromptPayloadSchema } from '../../generated/coding-plan.schemas';
import type {
  AgentTriggerImplement,
  ImplementPromptPayload,
} from '../../shared/agent-bridge-contract/generated/api';

const id = '11111111-1111-4111-8111-111111111111';
const payload = {
  approvedVersion: {
    responseType: 'coding_plan_version_v1',
    markdown: '# Agreed plan\n\nKeep **this exact text**.\n',
    requiredServiceIds: [id],
  },
  versionMessageId: id,
  planningDiscussion: 'User: keep A\nPlanner: agreed\nUser: change B',
  approvalFeedback: 'Ready to build',
  runtime: { provider: 'codex', model: 'gpt-5.5', reasoningEffort: 'high', fastMode: true },
} satisfies ImplementPromptPayload;
const event = {
  promptType: 'implement',
  nodeId: 'feature-sync-implement',
  triggerMessageId: id,
  payload,
} satisfies AgentTriggerImplement;
const frame = { conversationId: id, signedEvent: event, event };

describe('approved Markdown handoff storage', () => {
  it('admits and restores the complete approved handoff without changing signed evidence', () => {
    const validated = ImplementPromptPayloadSchema.parse(payload);
    const admitted = toStoredTriggerFrame(id, event, validated);
    const input = storedInput('trigger_frame', 'trigger_message', admitted);
    expect(input.payload).toEqual(frame);
    const record = {
      ...input,
      key: id,
      fingerprint: 'a'.repeat(64),
      agentSessionId: id,
      runId: id,
      organizationId: id,
      projectId: id,
      machineId: id,
      userId: id,
      messageId: id,
      admissionId: id,
      sequence: 1,
      state: 'queued',
      admissionDisposition: 'immediate',
      turnId: null,
      revision: 1,
      projectedRevision: 0,
      settlement: null,
      settlementDelivered: false,
    };
    const restored = decodeStoredRecord(JSON.parse(JSON.stringify(record)));
    expect(restored).toMatchObject({ record: { payload: frame } });
  });

  it('admits an approved version that carries its discrepancies', () => {
    const withDiscrepancies = {
      ...payload,
      approvedVersion: {
        ...payload.approvedVersion,
        discrepancies: [
          {
            sourceRef: { sourceType: 'task', sourceId: id },
            sourceField: 'description',
            sourceExcerpt: 'The task says A.',
            reasoning: 'The code does B.',
            discrepancyText: 'Spec and code disagree.',
            severity: 'medium',
          },
        ],
      },
    } satisfies ImplementPromptPayload;
    const discrepancyEvent = { ...event, payload: withDiscrepancies };
    const admitted = toStoredTriggerFrame(id, discrepancyEvent, withDiscrepancies);
    expect(storedInput('trigger_frame', 'trigger_message', admitted).payload).toEqual({
      conversationId: id,
      signedEvent: discrepancyEvent,
      event: discrepancyEvent,
    });
  });

  it('still rejects undeclared fields rather than widening saved implementation inputs', () => {
    expect(() =>
      storedInput('trigger_frame', 'trigger_message', {
        ...frame,
        event: { ...event, payload: { ...payload, unexpected: true } },
      }),
    ).toThrow();
  });
});
