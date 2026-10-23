import { describe, expect, it } from 'vitest';
import { translatePermissionDecisionToDispatch } from './permission-response-routing';

describe('permission-response-routing', () => {
  it('maps approve decisions into native Claude control responses', () => {
    const translated = translatePermissionDecisionToDispatch({
      runId: 'run-1',
      sessionId: 'provider-session-1',
      requestId: 'perm-1',
      agentType: 'claude',
      decision: 'approve',
      reason: null,
      idempotencyToken: 'token-1',
      deciderUserId: 'user-1',
    });

    expect(translated).toMatchObject({
      agentType: 'claude',
      callbackType: 'claude_control_response',
      callbackPayload: {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'perm-1',
          response: {
            behavior: 'allow',
            updatedInput: {},
          },
        },
      },
      routing: {
        runId: 'run-1',
        sessionId: 'provider-session-1',
        requestId: 'perm-1',
        idempotencyToken: 'token-1',
      },
    });
  });

  it('maps deny decisions into native Codex approval responses', () => {
    const translated = translatePermissionDecisionToDispatch({
      runId: 'run-2',
      sessionId: 'provider-session-2',
      requestId: 'perm-2',
      agentType: 'codex',
      decision: 'deny',
      reason: 'User denied network access.',
      idempotencyToken: null,
      deciderUserId: 'user-1',
    });

    expect(translated).toMatchObject({
      agentType: 'codex',
      callbackType: 'codex_exec_approval_response',
      callbackPayload: {
        type: 'exec_approval_response',
        call_id: 'perm-2',
        session_id: 'provider-session-2',
        approved: false,
        decision: 'deny',
        reason: 'User denied network access.',
      },
    });
  });
});
