import { describe, expect, it } from 'vitest';
import type { VerifyFeaturePromptPayload } from '../../shared/agent-bridge-contract/generated';
import { VerifyFeatureHandler } from './verify-feature.handler';
import type { PromptTypeHandlerContext } from '../prompt-type-handler';

const payload: VerifyFeaturePromptPayload = {
  concern: 'The retry loop shipped without a requirement.',
  parentAgentSessionId: '3f2f0c3e-5b0e-4d52-9d58-6f1f5a3a8f10',
  impactedEntities: [{ entityType: 'DIAGRAM', entityId: '9a1f0c3e-5b0e-4d52-9d58-6f1f5a3a8f12' }],
  userMessage: 'Please verify this concern.',
};

const context = {
  loadedEntityContext: {
    kind: 'entity',
    focalEntity: { entityType: 'TASK', entityId: '8c1f0c3e-5b0e-4d52-9d58-6f1f5a3a8f11' },
    entity: { name: 'Checkout flow', type: 'FEATURE' },
    context: {},
  },
} as unknown as PromptTypeHandlerContext;

describe('VerifyFeatureHandler', () => {
  const handler = new VerifyFeatureHandler([]);

  it('opts out of the shared Verify Feature suggestion', () => {
    expect(handler.excludedBaseSubmissionTools).toEqual(['suggest_feature_verification']);
  });

  it('makes the flagged concern and parent session the whole task', () => {
    const prompt = handler.buildPrompt(payload, context);

    expect(prompt).toContain('Investigate only that concern');
    expect(prompt).toContain(payload.concern);
    expect(prompt).toContain(payload.parentAgentSessionId);
    expect(prompt).toContain('Checkout flow');
    expect(prompt).toContain('get_agent_session');
    expect(prompt).toContain('list_reports_by_entity');
    expect(prompt).toContain('Do not start or request another Feature Sync.');
  });

  it('refuses to build a prompt without the concern or parent session', () => {
    expect(() => handler.buildPrompt({ userMessage: 'hi' } as never, context)).toThrow();
    expect(() => handler.buildPromptSegments({ userMessage: 'hi' } as never, context)).toThrow();
  });

  it('splits stable instructions from the flagged concern', () => {
    const segments = handler.buildPromptSegments(payload, context);

    expect(segments.stableInstructions).not.toContain(payload.concern);
    expect(segments.dynamicContext).toContain(payload.concern);
    expect(segments.dynamicContext).toContain('## Starting points');
    expect(segments.dynamicContext).toContain('DIAGRAM `9a1f0c3e-5b0e-4d52-9d58-6f1f5a3a8f12`');
    expect(segments.dynamicContext).toContain('follow the graph beyond them');
  });

  it('starts from the feature for a launch saved before starting points existed', () => {
    const legacy: VerifyFeaturePromptPayload = {
      concern: payload.concern,
      parentAgentSessionId: payload.parentAgentSessionId,
      userMessage: payload.userMessage,
    };
    const segments = new VerifyFeatureHandler([]).buildPromptSegments(legacy, context);

    expect(segments.dynamicContext).toContain('No starting points were named');
  });

  it('starts from the feature when no starting points were named', () => {
    const segments = new VerifyFeatureHandler([]).buildPromptSegments(
      { ...payload, impactedEntities: [] },
      context,
    );

    expect(segments.dynamicContext).toContain('No starting points were named');
  });

  it('grants its own access to the parent session', () => {
    expect(handler.additionalAllowedTools).toContain('get_agent_session');
  });

  it('appends the opening message under the standard preamble', () => {
    expect(handler.addUserMessage(payload)).toContain(payload.userMessage);
  });
});
