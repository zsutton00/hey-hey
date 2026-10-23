import { describe, expect, it } from 'vitest';
import { buildRunMcpSessionContext } from './run';
import type { AgenticSession } from '../session/types';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const SERVICE_A = '00000000-0000-4000-8000-000000000003';
const SERVICE_B = '00000000-0000-4000-8000-000000000004';

const makeSession = (
  overrides: {
    launchServiceId?: string | undefined;
    services?: AgenticSession['services'];
  } = {},
): AgenticSession =>
  ({
    agentic_session_id: SESSION_ID,
    conversationId: 'conversation-1',
    contextMetadata: { projectId: PROJECT_ID },
    entity: null,
    launchServiceId: SERVICE_A,
    services: [{ id: SERVICE_A, path: '/workspace/service-a' }],
    ...overrides,
  }) as AgenticSession;

describe('buildRunMcpSessionContext', () => {
  it('preserves the launch anchor and carries the complete first-turn scope', () => {
    expect(buildRunMcpSessionContext(makeSession())).toEqual({
      projectId: PROJECT_ID,
      conversationId: 'conversation-1',
      serviceId: SERVICE_A,
      serviceIds: [SERVICE_A],
      agentSessionId: SESSION_ID,
    });
  });

  it('carries an expanded authorized scope on resume without changing the launch anchor', () => {
    const resumed = makeSession({
      services: [
        { id: SERVICE_B, path: '/workspace/service-b' },
        { id: SERVICE_A, path: '/workspace/service-a' },
      ],
    });

    expect(buildRunMcpSessionContext(resumed)).toEqual({
      projectId: PROJECT_ID,
      conversationId: 'conversation-1',
      serviceId: SERVICE_A,
      serviceIds: [SERVICE_A, SERVICE_B],
      agentSessionId: SESSION_ID,
    });
  });

  it('reuses the same authorized scope for follow-up turns and keeps graph-only scope empty', () => {
    const expanded = makeSession({
      services: [
        { id: SERVICE_A, path: '/workspace/service-a' },
        { id: SERVICE_B, path: '/workspace/service-b' },
      ],
    });

    expect(buildRunMcpSessionContext(expanded).serviceIds).toEqual([SERVICE_A, SERVICE_B]);
    expect(
      buildRunMcpSessionContext(makeSession({ launchServiceId: undefined, services: [] })),
    ).toMatchObject({
      serviceId: undefined,
      serviceIds: [],
    });
  });
});
