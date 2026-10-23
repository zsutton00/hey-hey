import { describe, expect, it } from 'vitest';
import type { AgenticSession } from '../session/types';
import { createRunArgsFromSession, RunActivationContextError } from './run-activation';

const makeSession = (): AgenticSession => ({
  entity: null,
  agentic_session_id: 'run-1',
  services: [{ id: 'service-1', path: '/repo' }],
  launchServiceId: 'service-1',
  provider: 'codex',
  provider_session_id: 'provider-1',
  provider_conversation_id: 'thread-1',
  status: 'idle',
  conversationId: 'conversation-1',
  contextMetadata: {
    capturedAt: '2026-07-18T00:00:00.000Z',
    organizationId: 'organization-1',
    projectId: 'project-1',
    agentSessionId: 'agent-session-1',
    userComments: [],
    fileReferences: { resolved: [], unresolved: [] },
  },
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
  events: [],
});

describe('createRunArgsFromSession', () => {
  it('preserves persisted Run and platform identity', () => {
    const session = makeSession();

    expect(createRunArgsFromSession(session)).toMatchObject({
      runId: 'run-1',
      organizationId: 'organization-1',
      projectId: 'project-1',
      conversationId: 'conversation-1',
      provider: 'codex',
      session,
      hasProviderSession: true,
    });
  });

  it('hydrates the durable Project Assistant marker into Run activation', () => {
    const session = makeSession();
    session.projectAssistantDone = true;

    expect(createRunArgsFromSession(session)).toMatchObject({
      skipProjectAssistant: true,
    });
  });

  it('hydrates the persisted started prompt types into Run activation', () => {
    const session = makeSession();
    session.startedPromptTypes = ['feature_sync_analyze'];

    expect(createRunArgsFromSession(session)).toMatchObject({
      startedPromptTypes: ['feature_sync_analyze'],
    });
  });

  it('restores a Run persisted without the record as having started no prompt types', () => {
    expect(createRunArgsFromSession(makeSession())).toMatchObject({
      startedPromptTypes: [],
    });
  });

  it('fails fast when required persisted context is missing', () => {
    const session = makeSession();
    session.contextMetadata.agentSessionId = '';

    expect(() => createRunArgsFromSession(session)).toThrowError(RunActivationContextError);
    expect(() => createRunArgsFromSession(session)).toThrow(
      'contextMetadata.agentSessionId is missing',
    );
  });
});
