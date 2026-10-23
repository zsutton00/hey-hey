import { EVENT_TYPES } from '../../events/types/event.types';
import { RealtimeBridge } from '../websocket-bridge.service';
import { v4 as uuidv4 } from 'uuid';

const assertDefined = <T>(value: T | undefined, label: string): T => {
  if (!value) {
    throw new Error(`Expected ${label}`);
  }
  return value;
};

// Create lightweight mocks for EventRouter and WebsocketGateway
class MockEventRouter {
  handlers: Record<string, (env: any) => void> = {};
  async on(eventType: string, handler: any) {
    this.handlers[eventType] = handler;
  }
}

class MockGateway {
  emitToProject = jest.fn();
  emitToOrganization = jest.fn();
  emitToAll = jest.fn();
  emitMessageRealtime = jest.fn();
  emitInitiativeCreated = jest.fn();
  emitInitiativeUpdated = jest.fn();
  emitTaskUpdated = jest.fn();
  emitDesignDocUpdated = jest.fn();
  emitSystemNotification = jest.fn();
  emitConversationCreated = jest.fn();
  emitConversationUpdated = jest.fn();
  emitConversationStatusChanged = jest.fn();
  emitProposalGroupLifecycle = jest.fn();
  emitEvalRunUpdated = jest.fn();
  emitEvalAttemptUpdated = jest.fn();
}

class MockTriggerEmitter {
  emitConversationTriggerForMessage = jest.fn().mockResolvedValue(undefined);
  emitPlatformEventTrigger = jest.fn().mockResolvedValue(undefined);
}

describe('RealtimeBridge initiative.created routing', () => {
  let router: MockEventRouter;
  let gateway: MockGateway;
  let triggerEmitter: MockTriggerEmitter;
  let bridge: RealtimeBridge;

  beforeEach(() => {
    router = new MockEventRouter();
    gateway = new MockGateway();
    triggerEmitter = new MockTriggerEmitter();
    bridge = new RealtimeBridge(
      router as any,
      gateway as any,
      triggerEmitter as any,
    );
    bridge.onModuleInit();
  });

  function emitInitiativeCreatedEvent(payloadOverrides: Partial<any>) {
    const event = {
      id: uuidv4(),
      type: EVENT_TYPES.INITIATIVE.CREATED,
      aggregateId: uuidv4(),
      payload: {
        payloadType: EVENT_TYPES.INITIATIVE.CREATED,
        organizationId: 'org-1',
        projectId: payloadOverrides.projectId,
        initiative: {
          id: uuidv4(),
          name: 'Init',
          organizationId: 'org-1',
          status: 'PLANNING',
          tags: [],
        },
      },
    } as any;

    const envelope = { event };
    const handler = assertDefined(
      router.handlers[EVENT_TYPES.INITIATIVE.CREATED],
      'initiative created handler',
    );
    handler(envelope);
    return { event };
  }

  it('emits to project when projectId present', () => {
    const projectId = 'proj-123';
    const { event } = emitInitiativeCreatedEvent({ projectId });

    expect(gateway.emitInitiativeCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'initiative.created',
        projectId: projectId,
        initiativeId: expect.any(String),
        organizationId: 'org-1',
        timestamp: expect.any(String),
        userId: undefined,
        conversationId: undefined,
      }),
    );
  });

  it('emits to organization when no projectId', () => {
    const { event } = emitInitiativeCreatedEvent({ projectId: undefined });

    expect(gateway.emitInitiativeCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'initiative.created',
        projectId: undefined,
        initiativeId: expect.any(String),
        organizationId: 'org-1',
        timestamp: expect.any(String),
        userId: undefined,
        conversationId: undefined,
      }),
    );
  });

  it('maps initiative.content_changed to initiative.updated websocket payload', () => {
    const aggregateId = uuidv4();
    const handler = assertDefined(
      router.handlers[EVENT_TYPES.INITIATIVE.CONTENT_CHANGED],
      'initiative content changed handler',
    );

    handler({
      event: {
        id: uuidv4(),
        type: EVENT_TYPES.INITIATIVE.CONTENT_CHANGED,
        aggregateId,
        payload: {
          payloadType: EVENT_TYPES.INITIATIVE.CONTENT_CHANGED,
          organizationId: 'org-1',
          projectId: 'proj-1',
          content: {
            description: 'Updated description',
            details: 'Updated details',
            acceptanceCriteria: 'Updated acceptance criteria',
          },
        },
      },
    });

    expect(gateway.emitInitiativeUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'initiative.updated',
        initiativeId: aggregateId,
        organizationId: 'org-1',
        projectId: 'proj-1',
      }),
    );
  });

  it('maps task.content_changed to task.updated websocket payload', () => {
    const aggregateId = uuidv4();
    const handler = assertDefined(
      router.handlers[EVENT_TYPES.TASK.CONTENT_CHANGED],
      'task content changed handler',
    );

    handler({
      event: {
        id: uuidv4(),
        type: EVENT_TYPES.TASK.CONTENT_CHANGED,
        aggregateId,
        payload: {
          payloadType: EVENT_TYPES.TASK.CONTENT_CHANGED,
          organizationId: 'org-1',
          projectId: 'proj-1',
          initiativeId: 'init-1',
          content: {
            type: 'STANDARD',
            description: 'Updated description',
            acceptanceCriteria: 'Updated acceptance criteria',
          },
        },
      },
    });

    expect(gateway.emitTaskUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task.updated',
        taskId: aggregateId,
        initiativeId: 'init-1',
        organizationId: 'org-1',
        projectId: 'proj-1',
      }),
    );
  });

  it('maps design_doc.content_changed to design_doc.updated websocket payload', () => {
    const aggregateId = uuidv4();
    const handler = assertDefined(
      router.handlers[EVENT_TYPES.DESIGN_DOC.CONTENT_CHANGED],
      'design doc content changed handler',
    );

    handler({
      event: {
        id: uuidv4(),
        type: EVENT_TYPES.DESIGN_DOC.CONTENT_CHANGED,
        aggregateId,
        payload: {
          payloadType: EVENT_TYPES.DESIGN_DOC.CONTENT_CHANGED,
          organizationId: 'org-1',
          projectId: 'proj-1',
          designDoc: {
            id: aggregateId,
            name: 'Doc',
            description: null,
            status: 'DRAFT',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isArchived: false,
            sourceTaskId: null,
            sections: [],
          },
        },
      },
    });

    expect(gateway.emitDesignDocUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'design_doc.updated',
        designDocId: aggregateId,
        organizationId: 'org-1',
        projectId: 'proj-1',
      }),
    );
  });

  it('maps proposal-group lifecycle invalidations without adding snapshot data', () => {
    const handler = assertDefined(
      router.handlers[EVENT_TYPES.PROPOSAL_GROUP.LIFECYCLE],
      'proposal group lifecycle handler',
    );

    handler({
      event: {
        id: uuidv4(),
        type: EVENT_TYPES.PROPOSAL_GROUP.LIFECYCLE,
        aggregateId: 'group-1',
        payload: {
          payloadType: EVENT_TYPES.PROPOSAL_GROUP.LIFECYCLE,
          organizationId: 'org-1',
          projectId: 'project-1',
          groupId: 'group-1',
          revision: 7,
          changedMemberIds: new Set(['member-1', 'member-2']),
        },
      },
    });

    expect(gateway.emitProposalGroupLifecycle).toHaveBeenCalledWith({
      type: 'proposal_group.lifecycle',
      timestamp: expect.any(String),
      organizationId: 'org-1',
      projectId: 'project-1',
      groupId: 'group-1',
      revision: 7,
      changedMemberIds: new Set(['member-1', 'member-2']),
    });
  });

  it.each([
    [EVENT_TYPES.EVAL_RUN.UPDATED, 'emitEvalRunUpdated'],
    [EVENT_TYPES.EVAL_ATTEMPT.UPDATED, 'emitEvalAttemptUpdated'],
  ] as const)(
    'passes %s through unchanged to the gateway',
    (eventType, gatewayMethod) => {
      const handler = assertDefined(router.handlers[eventType], eventType);
      const event = {
        id: uuidv4(),
        type: eventType,
        aggregateId: uuidv4(),
        payload: { organizationId: 'org-1', projectId: 'project-1' },
      };

      handler({ event });

      expect(gateway[gatewayMethod]).toHaveBeenCalledWith(event);
    },
  );

  it('emits message.realtime websocket payloads and drops stale sequence values', () => {
    const handler = assertDefined(
      router.handlers[EVENT_TYPES.MESSAGE.REALTIME],
      'message realtime handler',
    );

    const baseEvent = {
      id: uuidv4(),
      type: EVENT_TYPES.MESSAGE.REALTIME,
      aggregateId: 'msg-1',
      payload: {
        payloadType: EVENT_TYPES.MESSAGE.REALTIME,
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        requestId: 'req-1',
        sequence: 1,
        kind: 'loading.update',
        source: 'hey-hey-agents',
        timestamp: new Date().toISOString(),
        payload: {
          loadingText: 'Working...',
          currentStep: 'tool-call',
        },
      },
    };

    handler({ event: baseEvent });
    handler({
      event: {
        ...baseEvent,
        id: uuidv4(),
        payload: {
          ...baseEvent.payload,
          sequence: 1,
          payload: { loadingText: 'duplicate' },
        },
      },
    });
    handler({
      event: {
        ...baseEvent,
        id: uuidv4(),
        payload: {
          ...baseEvent.payload,
          sequence: 2,
          kind: 'response.delta',
          payload: { responseDelta: ' next chunk' },
        },
      },
    });

    expect(gateway.emitMessageRealtime).toHaveBeenCalledTimes(2);
    expect(gateway.emitMessageRealtime).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'message.realtime',
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        requestId: 'req-1',
        sequence: 1,
        kind: 'loading.update',
        source: 'hey-hey-agents',
      }),
    );
    expect(gateway.emitMessageRealtime).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sequence: 2,
        kind: 'response.delta',
      }),
    );
  });

  it('propagates latestMessageId on conversation.updated websocket payload', () => {
    const handler = assertDefined(
      router.handlers[EVENT_TYPES.CONVERSATION.UPDATED],
      'conversation updated handler',
    );

    handler({
      event: {
        id: uuidv4(),
        type: EVENT_TYPES.CONVERSATION.UPDATED,
        aggregateId: 'conv-1',
        payload: {
          payloadType: EVENT_TYPES.CONVERSATION.UPDATED,
          organizationId: 'org-1',
          projectId: 'proj-1',
          conversationId: 'conv-1',
          update: { messageAdded: 'msg-99' },
          latestMessageId: 'msg-99',
          previousVersion: 5,
          newVersion: 6,
          changeType: 'message_added',
        },
      },
    });

    expect(gateway.emitConversationUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'conversation.updated',
        conversationId: 'conv-1',
        latestMessageId: 'msg-99',
        changeType: 'message_added',
      }),
    );
  });

  it('omits latestMessageId on conversation.updated when no messages exist yet', () => {
    const handler = assertDefined(
      router.handlers[EVENT_TYPES.CONVERSATION.UPDATED],
      'conversation updated handler',
    );

    handler({
      event: {
        id: uuidv4(),
        type: EVENT_TYPES.CONVERSATION.UPDATED,
        aggregateId: 'conv-1',
        payload: {
          payloadType: EVENT_TYPES.CONVERSATION.UPDATED,
          organizationId: 'org-1',
          projectId: 'proj-1',
          conversationId: 'conv-1',
          update: { title: 'renamed' },
          previousVersion: 5,
          newVersion: 6,
          changeType: 'system',
        },
      },
    });

    const wsCall = gateway.emitConversationUpdated.mock.calls[0]?.[0];
    expect(wsCall).toMatchObject({
      type: 'conversation.updated',
      conversationId: 'conv-1',
    });
    expect(wsCall.latestMessageId).toBeUndefined();
  });

  it('forwards an added message to the trigger emitter alongside the broadcast', () => {
    const handler = assertDefined(
      router.handlers[EVENT_TYPES.CONVERSATION.UPDATED],
      'conversation updated handler',
    );

    handler({
      event: {
        id: uuidv4(),
        type: EVENT_TYPES.CONVERSATION.UPDATED,
        aggregateId: 'conv-1',
        payload: {
          payloadType: EVENT_TYPES.CONVERSATION.UPDATED,
          organizationId: 'org-1',
          projectId: 'proj-1',
          conversationId: 'conv-1',
          update: { messageAdded: 'msg-99' },
          latestMessageId: 'msg-99',
          previousVersion: 5,
          newVersion: 6,
          changeType: 'message_added',
          triggersAgent: {
            promptType: 'implement',
            nodeId: 'node-1',
            triggerMessageId: 'msg-99',
          },
        },
      },
    });

    // The room-wide broadcast still happens, unchanged.
    expect(gateway.emitConversationUpdated).toHaveBeenCalledTimes(1);
    // And the added message is handed to the trigger emitter.
    expect(
      triggerEmitter.emitConversationTriggerForMessage,
    ).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      messageId: 'msg-99',
      organizationId: 'org-1',
      projectId: 'proj-1',
    });
  });

  it('skips the trigger emitter for added messages without triggersAgent', () => {
    const handler = assertDefined(
      router.handlers[EVENT_TYPES.CONVERSATION.UPDATED],
      'conversation updated handler',
    );

    handler({
      event: {
        id: uuidv4(),
        type: EVENT_TYPES.CONVERSATION.UPDATED,
        aggregateId: 'conv-1',
        payload: {
          payloadType: EVENT_TYPES.CONVERSATION.UPDATED,
          organizationId: 'org-1',
          projectId: 'proj-1',
          conversationId: 'conv-1',
          update: { messageAdded: 'msg-99' },
          latestMessageId: 'msg-99',
          previousVersion: 5,
          newVersion: 6,
          changeType: 'message_added',
        },
      },
    });

    // The room-wide broadcast still fires for every conversation.updated.
    expect(gateway.emitConversationUpdated).toHaveBeenCalledTimes(1);
    // But the trigger emitter is not dispatched — the common case skips
    // the DB round-trip the emitter would have done.
    expect(
      triggerEmitter.emitConversationTriggerForMessage,
    ).not.toHaveBeenCalled();
  });

  it('does not invoke the trigger emitter for non-message conversation updates', () => {
    const handler = assertDefined(
      router.handlers[EVENT_TYPES.CONVERSATION.UPDATED],
      'conversation updated handler',
    );

    handler({
      event: {
        id: uuidv4(),
        type: EVENT_TYPES.CONVERSATION.UPDATED,
        aggregateId: 'conv-1',
        payload: {
          payloadType: EVENT_TYPES.CONVERSATION.UPDATED,
          organizationId: 'org-1',
          projectId: 'proj-1',
          conversationId: 'conv-1',
          update: { title: 'renamed' },
          previousVersion: 5,
          newVersion: 6,
          changeType: 'system',
        },
      },
    });

    expect(gateway.emitConversationUpdated).toHaveBeenCalledTimes(1);
    expect(
      triggerEmitter.emitConversationTriggerForMessage,
    ).not.toHaveBeenCalled();
  });
});
