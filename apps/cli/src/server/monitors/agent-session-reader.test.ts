import { describe, expect, it, vi } from 'vitest';
import type { ServerLogger } from '../logger';
import { AgentSessionReader } from './agent-session-reader';
import { createTestPlatformAuthContext } from './test-owners.test-support';

const authProvider = createTestPlatformAuthContext({
  accessToken: 'token-1',
  organizationId: 'organization-1',
  userId: 'user-1',
  projectId: 'project-1',
});

interface LogCall {
  event: string;
  fields?: Record<string, unknown>;
}

const createLoggerFixture = (): { logger: ServerLogger; calls: LogCall[] } => {
  const calls: LogCall[] = [];
  const record = (event: string, fields?: Record<string, unknown>): void => {
    calls.push(fields === undefined ? { event } : { event, fields });
  };
  const logger: ServerLogger = {
    trace: record,
    debug: record,
    info: record,
    warn: record,
    error: record,
    child: () => logger,
  };
  return { logger, calls };
};

describe('AgentSessionReader', () => {
  it('validates and returns only the monitor-owned session projection', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        data: {
          id: 'session-1',
          autoDecide: true,
          config: {
            type: 'CODING_SESSION',
            version: 'v2',
            model: 'gpt-5.6',
            taskMonitorId: 'monitor-1',
          },
        },
      }),
    );
    const reader = new AgentSessionReader({
      apiBaseUrl: 'https://api.example.test/',
      authProvider,
      logger: createLoggerFixture().logger,
      fetchImpl,
    });

    await expect(reader.readAgentSession('session/1')).resolves.toEqual({
      autoDecide: true,
      config: {
        type: 'CODING_SESSION',
        version: 'v2',
        model: 'gpt-5.6',
        taskMonitorId: 'monitor-1',
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.test/organizations/organization-1/projects/project-1/agent-sessions/session%2F1',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer token-1' },
      },
    );
  });

  it('accepts Entity Conversation session config', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        data: {
          conversationId: 'conversation-1',
          autoDecide: false,
          config: {
            type: 'ENTITY_CONVERSATION',
            version: 'v1',
            model: 'claude-opus-4-1',
            effort: 'medium',
          },
        },
      }),
    );
    const reader = new AgentSessionReader({
      apiBaseUrl: 'https://api.example.test',
      authProvider,
      logger: createLoggerFixture().logger,
      fetchImpl,
    });

    await expect(reader.readAgentSession('session-entity-conversation')).resolves.toEqual({
      conversationId: 'conversation-1',
      autoDecide: false,
      config: {
        type: 'ENTITY_CONVERSATION',
        version: 'v1',
        model: 'claude-opus-4-1',
      },
    });
  });

  it('rejects malformed platform JSON at the boundary', async () => {
    const { logger, calls } = createLoggerFixture();
    const reader = new AgentSessionReader({
      apiBaseUrl: 'https://api.example.test',
      authProvider,
      logger,
      fetchImpl: vi.fn(async () => Response.json({ data: { autoDecide: 'yes' } })),
    });

    await expect(reader.readAgentSession('session-1')).rejects.toThrow(
      'AgentSession read returned an invalid response.',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      event: 'monitors.agent_session_reader.response_invalid',
      fields: {
        agentSessionId: 'session-1',
        status: 200,
        contentType: 'application/json',
        validationIssues: [
          {
            code: 'invalid_type',
            path: ['data', 'autoDecide'],
          },
        ],
        responseShape: {
          topLevel: {
            typeof: 'object',
            nullable: false,
          },
          data: {
            typeof: 'object',
            nullable: false,
          },
          fields: {
            autoDecide: {
              typeof: 'string',
              nullable: false,
            },
          },
        },
      },
    });
  });

  it('logs malformed envelopes and field metadata without logging response values', async () => {
    const { logger, calls } = createLoggerFixture();
    const reader = new AgentSessionReader({
      apiBaseUrl: 'https://api.example.test',
      authProvider,
      logger,
      fetchImpl: vi.fn(async () =>
        Response.json({
          secret: 'do-not-log-this-value',
          data: {
            autoDecide: true,
            config: {
              type: 'CODING_SESSION',
              version: 'v2',
              model: 42,
            },
          },
        }),
      ),
    });

    await expect(reader.readAgentSession('session-2')).rejects.toThrow(
      'AgentSession read returned an invalid response.',
    );

    const call = calls[0];
    expect(call).toMatchObject({
      event: 'monitors.agent_session_reader.response_invalid',
      fields: {
        validationIssues: [
          {
            code: 'invalid_type',
            path: ['data', 'config', 'model'],
          },
        ],
        responseShape: {
          topLevel: {
            typeof: 'object',
            nullable: false,
          },
          data: {
            typeof: 'object',
            nullable: false,
          },
          configFields: {
            model: {
              typeof: 'number',
              nullable: false,
            },
          },
        },
      },
    });
    expect(JSON.stringify(call)).not.toContain('do-not-log-this-value');
    expect(JSON.stringify(call)).not.toContain('secret');
  });

  it('never copies untrusted object or array keys into invalid-response diagnostics', async () => {
    const { logger, calls } = createLoggerFixture();
    const untrustedKeys = Object.fromEntries(
      Array.from({ length: 2_000 }, (_, index) => [`untrusted-${String(index)}`, index]),
    );
    const reader = new AgentSessionReader({
      apiBaseUrl: 'https://api.example.test',
      authProvider,
      logger,
      fetchImpl: vi.fn(async () =>
        Response.json({
          ...untrustedKeys,
          data: Array.from({ length: 2_000 }, (_, index) => ({
            [`array-key-${String(index)}`]: true,
          })),
        }),
      ),
    });

    await expect(reader.readAgentSession('session-keys')).rejects.toThrow(
      'AgentSession read returned an invalid response.',
    );

    const serializedCall = JSON.stringify(calls[0]);
    expect(serializedCall).not.toContain('untrusted-');
    expect(serializedCall).not.toContain('array-key-');
    expect(serializedCall.length).toBeLessThan(2_000);
  });

  it('logs JSON parsing failures separately and rethrows the parser error', async () => {
    const { logger, calls } = createLoggerFixture();
    const response = new Response('', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const parseError = new SyntaxError('invalid JSON');
    vi.spyOn(response, 'json').mockRejectedValue(parseError);
    const reader = new AgentSessionReader({
      apiBaseUrl: 'https://api.example.test',
      authProvider,
      logger,
      fetchImpl: vi.fn(async () => response),
    });

    await expect(reader.readAgentSession('session-3')).rejects.toBe(parseError);
    expect(calls).toEqual([
      {
        event: 'monitors.agent_session_reader.response_json_failed',
        fields: {
          agentSessionId: 'session-3',
          status: 200,
          contentType: 'application/json',
          errorType: 'SyntaxError',
        },
      },
    ]);
  });

  it('returns null for a missing Agent Session', async () => {
    const reader = new AgentSessionReader({
      apiBaseUrl: 'https://api.example.test',
      authProvider,
      logger: createLoggerFixture().logger,
      fetchImpl: vi.fn(async () => new Response('', { status: 404 })),
    });

    await expect(reader.readAgentSession('missing')).resolves.toBeNull();
  });
});
