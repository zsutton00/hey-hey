import { describe, expect, it } from 'vitest';
import { antigravityRuleKey, mapAntigravityPermission } from './antigravity-event-mapper';

const context = { runId: 'run', sessionId: 'session', timestamp: '2026-11-23T00:00:00.000Z' };
interface AcpOption {
  optionId: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once';
  name: string;
}
const allowOnce: AcpOption = { optionId: 'a', kind: 'allow_once' as const, name: 'Allow' };
const allowAlways: AcpOption = { optionId: 'b', kind: 'allow_always' as const, name: 'Always' };
const rejectOnce: AcpOption = { optionId: 'c', kind: 'reject_once' as const, name: 'Reject' };

const decisionsFor = (options: AcpOption[], name: string | undefined = 'run_command'): unknown => {
  const event = mapAntigravityPermission(context, 'request', {
    sessionId: 'session',
    toolCall: { toolCallId: 'call', kind: 'execute', ...(name ? { name } : {}) },
    options,
  } as never);
  const payload = event.payload as { permission_request: { availableDecisions: string[] } };
  return payload.permission_request.availableDecisions;
};

describe('Antigravity permission choices', () => {
  it('offers every Hey Hey choice when only a one-time allow and reject are available', () => {
    expect(decisionsFor([allowOnce, rejectOnce])).toEqual([
      'approve',
      'always_approve',
      'deny',
      'whitelist',
    ]);
  });

  it('offers the same choices when agy also offers allow-always', () => {
    expect(decisionsFor([allowOnce, allowAlways, rejectOnce])).toEqual([
      'approve',
      'always_approve',
      'deny',
      'whitelist',
    ]);
  });

  it('offers only what can be answered when the request has no reject option', () => {
    expect(decisionsFor([allowOnce])).toEqual(['approve', 'always_approve', 'whitelist']);
  });

  it('offers nothing to approve when there is no one-time allow', () => {
    expect(decisionsFor([allowAlways, rejectOnce])).toEqual(['deny']);
  });

  it('offers only Approve and Deny when the tool has no name to remember', () => {
    expect(decisionsFor([allowOnce, rejectOnce], '')).toEqual(['approve', 'deny']);
  });

  it('keys rules by provider so another provider’s tool of the same name never matches', () => {
    expect(antigravityRuleKey('run_command')).toBe('antigravity:run_command');
    expect(antigravityRuleKey('bad name!')).toBeUndefined();
  });
});
