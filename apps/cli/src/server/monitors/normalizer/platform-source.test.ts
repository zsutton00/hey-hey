import { describe, expect, it } from 'vitest';
import type { PlatformWebSocketEvent } from '../../platform-ws';
import { fromPlatformWebSocketEvent } from './platform-source';

describe('fromPlatformWebSocketEvent', () => {
  it('maps a PlatformWebSocketEvent to the platform-lane raw inbound input', () => {
    const event: PlatformWebSocketEvent = {
      type: 'conversation.message.created',
      timestamp: '2026-06-22T10:00:00.000Z',
      organizationId: 'org-1',
      conversationId: 'conv-1',
      projectId: 'proj-1',
      userId: 'user-1',
    };

    expect(fromPlatformWebSocketEvent(event)).toEqual({
      eventType: 'conversation.message.created',
      conversationId: 'conv-1',
      projectId: 'proj-1',
      userId: 'user-1',
      // No taskId/entityId on the event, so entityId falls back to conversationId.
      entityId: 'conv-1',
      timestamp: '2026-06-22T10:00:00.000Z',
    });
  });

  it('keys entityId on taskId for task-scoped events that carry no conversation', () => {
    const event: PlatformWebSocketEvent = {
      type: 'task.status_changed',
      timestamp: '2026-06-22T10:00:00.000Z',
      organizationId: 'org-1',
      projectId: 'proj-1',
      taskId: 'task-7',
    };

    const raw = fromPlatformWebSocketEvent(event);

    expect(raw.entityId).toBe('task-7');
    expect(raw.conversationId).toBeUndefined();
  });

  it('keys agent-session events by agentSessionId instead of their conversation', () => {
    const event: PlatformWebSocketEvent = {
      type: 'agent_session.status_changed',
      timestamp: '2026-06-22T10:00:00.000Z',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      agentSessionId: 'session-1',
    };

    const raw = fromPlatformWebSocketEvent(event);

    expect(raw.entityId).toBe('session-1');
    expect(raw.conversationId).toBe('conv-1');
  });

  it('falls back to conversationId when no entity-specific identifier exists', () => {
    const event: PlatformWebSocketEvent = {
      type: 'agent_session.status_changed',
      timestamp: '2026-06-22T10:00:00.000Z',
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
    };

    expect(fromPlatformWebSocketEvent(event).entityId).toBe('conv-1');
  });

  it('preserves undefined optional identifiers', () => {
    const event: PlatformWebSocketEvent = {
      type: 'project.updated',
      timestamp: '2026-06-22T10:00:00.000Z',
      organizationId: 'org-1',
    };

    const raw = fromPlatformWebSocketEvent(event);

    expect(raw.eventType).toBe('project.updated');
    expect(raw.timestamp).toBe('2026-06-22T10:00:00.000Z');
    expect(raw.conversationId).toBeUndefined();
    expect(raw.projectId).toBeUndefined();
    expect(raw.userId).toBeUndefined();
  });

  it('drops organizationId and any unknown extra fields', () => {
    const event: PlatformWebSocketEvent = {
      type: 'conversation.message.created',
      timestamp: '2026-06-22T10:00:00.000Z',
      organizationId: 'org-1',
      conversationId: 'conv-1',
      extra: 'payload',
    };

    const raw = fromPlatformWebSocketEvent(event);

    expect(raw).not.toHaveProperty('organizationId');
    expect(raw).not.toHaveProperty('extra');
  });
});
