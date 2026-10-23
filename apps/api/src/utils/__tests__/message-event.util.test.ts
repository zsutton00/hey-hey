import {
  CreateSystemMessage,
  CreateUserMessage,
  MessageCreatedUserMessage,
  SystemMessageData,
} from '../../generated';
import {
  buildMessageCreatedEventPayload,
  buildMessageUpdatedEventPayload,
  extractMessageEventContent,
} from '../message-event.util';

const buildSystemCreateMessage = (
  data: Partial<SystemMessageData>,
): CreateSystemMessage =>
  ({
    type: 'SYSTEM',
    workflowId: 'workflow-1',
    projectId: 'project-1',
    conversationId: 'conversation-1',
    data: {
      type: SystemMessageData.TypeEnum.Questions,
      detectedIntent: '',
      intentConfidence: 0,
      uiElements: [],
      ...data,
    },
  }) as unknown as CreateSystemMessage;

describe('extractMessageEventContent', () => {
  it('sets shouldProcess=false for system message create when ragEnabled=false', () => {
    const result = extractMessageEventContent({
      createMessage: buildSystemCreateMessage({
        response: 'x'.repeat(80),
        ragEnabled: false,
      }),
    });

    expect(result.shouldProcess).toBe(false);
  });

  it('keeps shouldProcess=true for system message create when ragEnabled=true', () => {
    const result = extractMessageEventContent({
      createMessage: buildSystemCreateMessage({
        response: 'x'.repeat(80),
        ragEnabled: true,
      }),
    });

    expect(result.shouldProcess).toBe(true);
  });

  it('keeps routing create messages non-processable', () => {
    const result = extractMessageEventContent({
      createMessage: buildSystemCreateMessage({
        type: SystemMessageData.TypeEnum.Routing,
        response: 'x'.repeat(80),
        ragEnabled: true,
      }),
    });

    expect(result.shouldProcess).toBe(false);
  });

  it('keeps system message update ragEnabled=false non-processable', () => {
    const result = extractMessageEventContent({
      update: {
        data: { response: 'x'.repeat(80), ragEnabled: false },
      } as any,
    });

    expect(result.shouldProcess).toBe(false);
  });
});

describe('eval attempt output', () => {
  it('keeps a long user message written with ragEnabled false non-processable', () => {
    const message = {
      type: 'USER',
      projectId: 'project-1',
      conversationId: 'conversation-1',
      data: { content: 'x'.repeat(200), ragEnabled: false },
    } as unknown as CreateUserMessage;
    const ordinary = { ...message, data: { content: 'x'.repeat(200) } };

    expect(
      buildMessageCreatedEventPayload({
        organizationId: 'org-1' as never,
        projectId: 'project-1' as never,
        conversationId: 'conversation-1' as never,
        message,
      }).message,
    ).toMatchObject({ shouldProcess: false });
    expect(
      buildMessageCreatedEventPayload({
        organizationId: 'org-1' as never,
        projectId: 'project-1' as never,
        conversationId: 'conversation-1' as never,
        message: ordinary as CreateUserMessage,
      }).message,
    ).toMatchObject({ shouldProcess: true });
  });

  it('forces shouldProcess=false on an update of an eval message that omits ragEnabled', () => {
    const update = { data: { response: 'x'.repeat(120) } };
    const params = {
      organizationId: 'org-1' as never,
      projectId: 'project-1' as never,
      conversationId: 'conversation-1' as never,
      update: update as never,
    };

    expect(
      buildMessageUpdatedEventPayload({ ...params, inert: true }).update,
    ).toMatchObject({ shouldProcess: false });
    expect(buildMessageUpdatedEventPayload(params).update).toMatchObject({
      shouldProcess: true,
    });
  });
});

describe('buildMessageCreatedEventPayload', () => {
  it('does not throw when parent message has no extractable content', () => {
    const message = {
      type: 'USER',
      workflowId: 'workflow-1',
      projectId: 'project-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
      data: {
        comment:
          'Startup Plan Review. Approve and proceed with implementation after applying feedback.',
      },
      parentMessageId: 'parent-1',
      createdAt: new Date().toISOString(),
    } as unknown as CreateUserMessage;

    const payload = buildMessageCreatedEventPayload({
      organizationId: 'org-1' as any,
      projectId: 'project-1' as any,
      workflowId: 'workflow-1' as any,
      conversationId: 'conversation-1' as any,
      message,
      parentMessage: {
        id: 'parent-1' as any,
        type: 'SYSTEM',
        data: {
          type: SystemMessageData.TypeEnum.Noop,
          ragEnabled: false,
        },
      },
    });

    const createdMessage = payload.message as MessageCreatedUserMessage;
    expect(createdMessage.parentMessage).toBeUndefined();
    expect(createdMessage.userMessage).toContain('Startup Plan Review');
    expect(payload.messageDataType).toBeUndefined();
    expect((createdMessage as any).data).toBeUndefined();
  });

  it('elevates message.data.type into top-level messageDataType for system messages', () => {
    const message = buildSystemCreateMessage({
      response: 'x'.repeat(80),
    });

    const payload = buildMessageCreatedEventPayload({
      organizationId: 'org-1' as any,
      projectId: 'project-1' as any,
      workflowId: 'workflow-1' as any,
      conversationId: 'conversation-1' as any,
      message,
    });

    expect(payload.messageDataType).toBe('QUESTIONS');
    expect((payload.message as any).data).toBeUndefined();
  });

  it('elevates completesExternalAgentNode onto the payload root', () => {
    const completion = {
      nodeId: 'analyze',
      action: 'NO_DISCREPANCY',
      completesTriggerMessageId: 'trigger-msg-1',
    };
    const message = buildSystemCreateMessage({
      type: 'AGENT' as any,
      response: 'completion',
      completesExternalAgentNode: completion,
    } as any);

    const payload = buildMessageCreatedEventPayload({
      organizationId: 'org-1' as any,
      projectId: 'project-1' as any,
      workflowId: 'workflow-1' as any,
      conversationId: 'conversation-1' as any,
      message,
    });

    expect(payload.completesExternalAgentNode).toEqual(completion);
    expect((payload.message as any).data).toBeUndefined();
  });

  it('elevates triggersAgent onto the payload root', () => {
    const trigger = {
      promptType: 'implement',
      nodeId: 'iterate',
      triggerMessageId: 'msg-1',
    };
    const message = buildSystemCreateMessage({
      response: 'x'.repeat(80),
      triggersAgent: trigger,
    } as any);

    const payload = buildMessageCreatedEventPayload({
      organizationId: 'org-1' as any,
      projectId: 'project-1' as any,
      workflowId: 'workflow-1' as any,
      conversationId: 'conversation-1' as any,
      message,
    });

    expect(payload.triggersAgent).toEqual(trigger);
    expect((payload.message as any).data).toBeUndefined();
  });

  it('omits the elevated routing fields when message.data carries neither', () => {
    const message = buildSystemCreateMessage({
      response: 'x'.repeat(80),
    });

    const payload = buildMessageCreatedEventPayload({
      organizationId: 'org-1' as any,
      projectId: 'project-1' as any,
      workflowId: 'workflow-1' as any,
      conversationId: 'conversation-1' as any,
      message,
    });

    expect(payload.completesExternalAgentNode).toBeUndefined();
    expect(payload.triggersAgent).toBeUndefined();
  });
});

describe('buildMessageUpdatedEventPayload', () => {
  it('elevates update.data.type into top-level messageDataType and removes data', () => {
    const payload = buildMessageUpdatedEventPayload({
      workflowId: 'workflow-1' as any,
      nodeId: 'node-1' as any,
      organizationId: 'org-1' as any,
      projectId: 'project-1' as any,
      conversationId: 'conversation-1' as any,
      update: {
        status: 'completed',
        data: { type: 'ANALYSIS', response: 'x'.repeat(80) },
      } as any,
    });

    expect(payload.messageDataType).toBe('ANALYSIS');
    expect((payload.update as any).data).toBeUndefined();
  });

  it('omits messageDataType when update.data.type is missing', () => {
    const payload = buildMessageUpdatedEventPayload({
      workflowId: 'workflow-1' as any,
      nodeId: 'node-1' as any,
      organizationId: 'org-1' as any,
      projectId: 'project-1' as any,
      conversationId: 'conversation-1' as any,
      update: {
        status: 'completed',
      } as any,
    });

    expect(payload.messageDataType).toBeUndefined();
  });
});
