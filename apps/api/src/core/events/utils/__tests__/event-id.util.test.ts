import {
  AgentSessionCreatedEvent,
  AgentSessionDeletedEvent,
  ConversationCreatedEvent,
  ConversationUpdatedEvent,
  AgentSessionStatusChangedEvent,
  ImplementationHintCreatedEvent,
  LlmRequestEvent,
  MessageCreatedEvent,
  MessageRealtimeEvent,
  MessageUpdatedEvent,
  OrganizationClosedEvent,
  ProjectDeletedEvent,
  ProjectUpdatedEvent,
  ProposalGroupLifecycleEvent,
  ReportCreatedEvent,
  SubfacetCreatedEvent,
  GitHubWebhookAcceptedEvent,
  HelpContentChangedEvent,
} from '../../types/domain-events';
import { EVENT_TYPES } from '../../types/event.types';
import { extractEventIds } from '../event-id.util';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  WorkflowId,
} from 'src/types';
import { MessageId } from 'src/types';

describe('extractEventIds', () => {
  it('does not invent tenant identifiers for global Help events', () => {
    const event: HelpContentChangedEvent = {
      id: '99999999-9999-4999-8999-999999999999',
      type: 'help.content_changed',
      aggregateId: '11111111-1111-4111-8111-111111111111',
      payload: {
        payloadType: 'help.content_changed',
        helpNode: {
          id: '11111111-1111-4111-8111-111111111111',
          parentId: null,
          slug: 'root',
          title: 'Root',
          ordering: 1,
          body: 'Body',
          demos: [],
        },
        contentHash: 'a'.repeat(64),
      },
    };

    expect(extractEventIds(event)).toEqual({});
  });

  const conversationId = 'conv1' as ConversationId;
  const projectId = 'proj1' as ProjectId;
  const messageId = 'msg1' as MessageId;
  const llmRequestId = 'req1';
  const organizationId = 'org1' as OrganizationId;
  const workflowId = 'wf1' as WorkflowId;

  const baseExecutionContext = {
    organizationId,
    projectId,
  };

  it('handles conversation.updated with minimal payload', () => {
    const evt = {
      id: 'evt1',
      type: EVENT_TYPES.CONVERSATION.UPDATED,
      aggregateId: 'conv1' as ConversationId,
      payload: {
        payloadType: EVENT_TYPES.CONVERSATION.UPDATED,

        ...baseExecutionContext,
        update: {
          expectedVersion: 1,
        },
      },
    } as ConversationUpdatedEvent;

    const ids = extractEventIds(evt);
    expect(ids).toEqual({
      conversationId: 'conv1',
      organizationId: 'org1',
      projectId: 'proj1',
    });
  });

  it('handles conversation.created with hoisted workflow fields', () => {
    const evt = {
      id: 'evt2',
      type: EVENT_TYPES.CONVERSATION.CREATED,
      aggregateId: 'conv2' as ConversationId,
      payload: {
        payloadType: EVENT_TYPES.CONVERSATION.CREATED,
        ...baseExecutionContext,
        workflowName: 'onboarding',
        initiatedBy: 'USER',
        status: 'STARTED',
      },
    } as ConversationCreatedEvent;

    const ids = extractEventIds(evt);
    expect(ids).toEqual({
      conversationId: 'conv2',
      projectId: 'proj1',
      organizationId: 'org1',
    });
  });

  it('handles message.created', () => {
    const evt = {
      id: 'evt3',
      type: EVENT_TYPES.MESSAGE.CREATED,
      aggregateId: messageId,
      payload: {
        payloadType: EVENT_TYPES.MESSAGE.CREATED,

        ...baseExecutionContext,
        message: {
          workflowId,
          projectId: 'proj2' as ProjectId,
          conversationId: 'conv3' as ConversationId,
          type: 'USER',
          parentMessage: {
            id: 'parent-msg' as MessageId,
            content: 'Parent message content',
          },
          shouldProcess: true,
        },
      },
    } as MessageCreatedEvent;

    const ids = extractEventIds(evt);
    expect(ids).toEqual({
      projectId: 'proj2',
      conversationId: 'conv3',
      organizationId: 'org1',
    });
  });

  it('handles message.updated', () => {
    const evt = {
      id: 'evt4',
      type: EVENT_TYPES.MESSAGE.UPDATED,
      aggregateId: messageId,
      payload: {
        payloadType: EVENT_TYPES.MESSAGE.UPDATED,

        ...baseExecutionContext,
        update: {
          shouldProcess: true,
          contentChanged: true,
          data: { projectId: 'proj3' as ProjectId, conversationId },
        },
      },
    } as MessageUpdatedEvent;

    const ids = extractEventIds(evt);
    expect(ids).toEqual({
      projectId: 'proj1',
      conversationId: undefined,
      organizationId: 'org1',
    });
  });

  it('handles message.realtime', () => {
    const evt = {
      id: 'evt4b',
      type: EVENT_TYPES.MESSAGE.REALTIME,
      aggregateId: messageId,
      payload: {
        payloadType: EVENT_TYPES.MESSAGE.REALTIME,
        ...baseExecutionContext,
        conversationId,
        messageId,
        requestId: llmRequestId,
        sequence: 3,
        kind: 'loading.update',
        source: 'api',
        timestamp: new Date().toISOString(),
      },
    } as MessageRealtimeEvent;

    const ids = extractEventIds(evt);
    expect(ids).toEqual({
      projectId: 'proj1',
      conversationId: 'conv1',
      organizationId: 'org1',
    });
  });

  it('handles project.updated', () => {
    const evt = {
      id: 'evt5',
      type: EVENT_TYPES.PROJECT.UPDATED,
      aggregateId: 'proj99' as ProjectId,
      payload: {
        payloadType: EVENT_TYPES.PROJECT.UPDATED,

        ...baseExecutionContext,
        update: {},
      },
    } as ProjectUpdatedEvent;

    const ids = extractEventIds(evt);
    expect(ids).toEqual({ projectId: 'proj99', organizationId: 'org1' });
  });

  it('handles project.deleted', () => {
    const evt = {
      id: 'evt5b',
      type: EVENT_TYPES.PROJECT.DELETED,
      aggregateId: 'proj98' as ProjectId,
      payload: {
        payloadType: EVENT_TYPES.PROJECT.DELETED,
        ...baseExecutionContext,
        deletedAt: new Date().toISOString(),
      },
    } as ProjectDeletedEvent;

    const ids = extractEventIds(evt);
    expect(ids).toEqual({ projectId: 'proj98', organizationId: 'org1' });
  });

  it('handles organization.closed without inventing project scope', () => {
    const evt = {
      id: 'evt-organization-closed',
      type: EVENT_TYPES.ORGANIZATION.CLOSED,
      aggregateId: organizationId,
      payload: {
        payloadType: EVENT_TYPES.ORGANIZATION.CLOSED,
        organizationId,
        markerId: '43ed65fa-b0a8-4fe3-9577-28ee86f964d1',
        irreversibleClosureAt: '2026-08-14T12:00:00.000Z',
        deletionDeadline: '2026-09-13T12:00:00.000Z',
      },
    } satisfies OrganizationClosedEvent;

    expect(extractEventIds(evt)).toEqual({ organizationId });
  });

  it('preserves organization and project routing for GitHub webhook acceptance', () => {
    const evt = {
      id: 'evt-github-webhook',
      type: EVENT_TYPES.GITHUB_WEBHOOK.ACCEPTED,
      aggregateId: 'ef0099ee-468b-4841-a473-df9f9363a15f',
      payload: {
        organizationId,
        projectId,
        integrationId: '9bd92fd6-16b1-4f8c-a773-b07ae4cc1f90',
        inboxId: 'ef0099ee-468b-4841-a473-df9f9363a15f',
        deliveryId: 'delivery-1',
        eventName: 'pull_request',
        repository: {
          id: 42,
          fullName: 'hey-hey/api',
          htmlUrl: 'https://github.com/hey-hey/api',
        },
        action: 'closed',
        pullRequest: {
          id: 100,
          number: 12,
          title: 'Preserve accepted merge facts',
          state: 'closed',
          merged: true,
          mergedAt: '2026-08-18T18:00:00.000Z',
          mergedByLogin: 'octocat',
          htmlUrl: 'https://github.com/hey-hey/api/pull/12',
          headSha: 'abc123',
          baseSha: 'def456',
        },
        acceptedAt: '2026-08-18T18:01:00.000Z',
      },
    } satisfies GitHubWebhookAcceptedEvent;

    expect(extractEventIds(evt)).toEqual({ organizationId, projectId });
  });

  it('handles LLM.request', () => {
    const evt = {
      id: 'evt6',
      type: EVENT_TYPES.LLM.REQUEST,
      aggregateId: llmRequestId,
      payload: {
        payloadType: EVENT_TYPES.LLM.REQUEST,

        ...baseExecutionContext,
        conversationId,
        prompt: 'hi',
      },
    } as LlmRequestEvent;

    const ids = extractEventIds(evt);
    expect(ids).toEqual({ projectId, conversationId, organizationId: 'org1' });
  });

  it('handles subfacet.created', () => {
    const evt = {
      id: 'evt7',
      type: EVENT_TYPES.SUBFACET.CREATED,
      aggregateId: 'sf-1',
      payload: {
        payloadType: EVENT_TYPES.SUBFACET.CREATED,
        ...baseExecutionContext,
        subfacet: {
          id: 'sf-1',
          name: 'Observability',
          slug: 'observability',
          category: 'technology',
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    } as SubfacetCreatedEvent;

    const ids = extractEventIds(evt);
    expect(ids).toEqual({
      projectId: 'proj1',
      organizationId: 'org1',
    });
  });

  it('handles report.created', () => {
    const evt = {
      id: 'evt8',
      type: EVENT_TYPES.REPORT.CREATED,
      aggregateId: 'report-1',
      payload: {
        payloadType: EVENT_TYPES.REPORT.CREATED,
        organizationId,
        projectId,
        shouldProcess: true,
        report: {
          id: 'report-1',
          organizationId,
          projectId,
          reportType: 'CODING_RESEARCH',
          audience: 'WORKFLOW_ONLY',
          title: 'Coding Research',
          payload: {
            reportType: 'CODING_RESEARCH',
            summary: 'Research stub.',
            analysis: '',
            frame: {},
            provenance: { discoveryCalls: [], edgesTraversed: [] },
            updates: [],
          },
          version: 1,
          schemaVersion: 1,
          createdAt: new Date().toISOString(),
          expiresAt: new Date().toISOString(),
          entities: [],
        },
      },
    } as ReportCreatedEvent;

    const ids = extractEventIds(evt);
    expect(ids).toEqual({
      projectId: 'proj1',
      organizationId: 'org1',
    });
  });

  it('handles agent_session.status_changed', () => {
    const evt = {
      id: 'evt9',
      type: EVENT_TYPES.AGENT_SESSION.STATUS_CHANGED,
      aggregateId: 'cs-1',
      payload: {
        payloadType: EVENT_TYPES.AGENT_SESSION.STATUS_CHANGED,
        organizationId,
        projectId: 'pdefault' as ProjectId,
        conversationId,
        agentSession: {
          id: 'cs-1',
          organizationId,
          projectId: 'pdefault' as ProjectId,
          userId: 'user-1',
          status: 'COMPLETED',
          currentState: 'IDLE',
          sessionDate: new Date().toISOString(),
          title: 'Session',
          conversationId,
          lastSyncedAt: null,
          hasUnsyncedChanges: false,
          monitoringEnabled: false,
          autoDecide: false,
          type: 'CODING',
        },
        previousStatus: 'IN_PROGRESS',
        newStatus: 'COMPLETED',
      },
    } as AgentSessionStatusChangedEvent;

    const ids = extractEventIds(evt);
    expect(ids).toEqual({
      organizationId: 'org1',
      projectId: 'pdefault',
      conversationId: 'conv1',
      userId: 'user-1',
    });
  });

  it('handles agent_session.created', () => {
    const evt = {
      id: 'evt9b',
      type: EVENT_TYPES.AGENT_SESSION.CREATED,
      aggregateId: 'cs-1',
      payload: {
        payloadType: EVENT_TYPES.AGENT_SESSION.CREATED,
        organizationId,
        projectId,
        conversationId: 'conv-from-payload',
        taskId: 'task-1',
        serviceId: 'service-1',
        agentSession: {
          id: 'cs-1',
          organizationId,
          projectId,
          userId: 'user-1',
          status: 'IN_PROGRESS',
          sessionDate: new Date().toISOString(),
          title: 'Session',
          conversationId: 'conv-from-session',
          lastSyncedAt: null,
          hasUnsyncedChanges: false,
          type: 'CODING',
        },
      },
    } as unknown as AgentSessionCreatedEvent;

    const ids = extractEventIds(evt);
    expect(ids).toEqual({
      organizationId: 'org1',
      projectId: 'proj1',
      conversationId: 'conv-from-payload',
      userId: 'user-1',
    });
  });

  it('handles agent_session.deleted', () => {
    const evt = {
      id: 'evt10',
      type: EVENT_TYPES.AGENT_SESSION.DELETED,
      aggregateId: 'cs-1',
      payload: {
        payloadType: EVENT_TYPES.AGENT_SESSION.DELETED,
        organizationId,
        projectId,
        conversationId,
        agentSession: {
          id: 'cs-1',
          organizationId,
          projectId,
          userId: 'user-1',
          status: 'COMPLETED',
          currentState: 'IDLE',
          sessionDate: new Date().toISOString(),
          title: 'Session',
          conversationId,
          lastSyncedAt: null,
          hasUnsyncedChanges: false,
          monitoringEnabled: false,
          autoDecide: false,
          type: 'CODING',
        },
      },
    } as AgentSessionDeletedEvent;

    const ids = extractEventIds(evt);
    expect(ids).toEqual({
      organizationId: 'org1',
      projectId: 'proj1',
      conversationId: 'conv1',
      userId: 'user-1',
    });
  });

  it('handles implementation_hint.created', () => {
    const evt = {
      type: EVENT_TYPES.IMPLEMENTATION_HINT.CREATED,
      aggregateId: 'hint-1',
      payload: {
        payloadType: EVENT_TYPES.IMPLEMENTATION_HINT.CREATED,
        organizationId,
        projectId,
        implementationHint: {
          id: 'hint-1',
          serviceId: 'service-1',
          agentSessionId: 'agent-session-1',
          featureName: 'Auth',
          description: 'Use JWT guard',
          sourceType: 'USER',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    } as ImplementationHintCreatedEvent;

    const ids = extractEventIds(evt);
    expect(ids).toEqual({
      organizationId: 'org1',
      projectId: 'proj1',
    });
  });

  it('extracts project scope from proposal-group lifecycle invalidations', () => {
    const evt = {
      id: 'evt12',
      type: EVENT_TYPES.PROPOSAL_GROUP.LIFECYCLE,
      aggregateId: 'group-1',
      payload: {
        payloadType: EVENT_TYPES.PROPOSAL_GROUP.LIFECYCLE,
        organizationId,
        projectId,
        groupId: 'group-1',
        revision: 2,
        changedMemberIds: new Set(['member-1']),
      },
    } as ProposalGroupLifecycleEvent;

    expect(extractEventIds(evt)).toEqual({
      organizationId: 'org1',
      projectId: 'proj1',
    });
  });
});
