import { describe, expect, it } from 'vitest';
import { isAgentSessionConfig } from './config-validation';

const validConfig = {
  type: 'PROJECT_REPORT',
  version: 'v1',
  requestId: '11111111-1111-4111-8111-111111111111',
  attemptId: '22222222-2222-4222-8222-222222222222',
  model: 'gpt-5.6-sol',
  effort: 'high',
  fastMode: true,
};

describe('isAgentSessionConfig', () => {
  it('accepts a valid PROJECT_REPORT session config', () => {
    expect(isAgentSessionConfig(validConfig)).toBe(true);
  });

  it.each([
    { ...validConfig, requestId: 'not-a-uuid' },
    { ...validConfig, attemptId: 'not-a-uuid' },
    { ...validConfig, model: '   ' },
    { ...validConfig, effort: 'extreme' },
    { ...validConfig, fastMode: 'yes' },
    { ...validConfig, version: 'v2' },
  ])('rejects malformed PROJECT_REPORT config %#', (config) => {
    expect(isAgentSessionConfig(config)).toBe(false);
  });
});

describe('isAgentSessionConfig Verify Feature marker', () => {
  const entityConversation = { type: 'ENTITY_CONVERSATION', version: 'v1', model: 'gpt-5.6-sol' };
  const verifyFeature = {
    concern: 'The retry loop shipped without a requirement.',
    parentAgentSessionId: '33333333-3333-4333-8333-333333333333',
    impactedEntities: [{ entityType: 'TASK', entityId: '44444444-4444-4444-8444-444444444444' }],
  };

  it('accepts an Entity Conversation config that carries the marker, or none', () => {
    expect(isAgentSessionConfig(entityConversation)).toBe(true);
    expect(isAgentSessionConfig({ ...entityConversation, verifyFeature })).toBe(true);
  });

  it('accepts a Verify Feature marker saved before it carried starting points', () => {
    const legacy = {
      concern: verifyFeature.concern,
      parentAgentSessionId: verifyFeature.parentAgentSessionId,
    };
    expect(isAgentSessionConfig({ ...entityConversation, verifyFeature: legacy })).toBe(true);
  });

  it.each([
    { ...verifyFeature, concern: '' },
    { ...verifyFeature, parentAgentSessionId: 'not-a-uuid' },
    { concern: verifyFeature.concern },
    { ...verifyFeature, impactedEntities: [{ entityType: 'TASK', entityId: 'task-1' }] },
    'concern',
  ])('rejects a malformed marker %#', (marker) => {
    expect(isAgentSessionConfig({ ...entityConversation, verifyFeature: marker })).toBe(false);
  });
});
