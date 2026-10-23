import type { Client } from '@temporalio/client';
import { BadRequestException } from '@nestjs/common';
import { MessageController } from '../message.controller';
import type { ConversationService } from '../../services/conversation.service';
import type { MessageService } from '../../services/message.service';
import type { FlowExecutionService } from '../../services/workflows/flow-execution.service';
import type { WorkflowTypeRegistryService } from '../../services/workflows/workflow-type-registry.service';
import type { ExecutionGrantService } from '../../services/controller-authorization/execution-grant.service';
import type { AgentOperationRegistryService } from '../../services/agent-operation/agent-operation-registry.service';
import {
  CreateUserMessage,
  CreateSystemMessage,
  ConversationMessageHistoryPageDto,
  AgentSystemMessageData,
  SubmitExecutableUserMessageRequestDto,
  GetMessagesQueryDto,
  MessageResponseDto,
  MessageType,
  SearchConversationMessagesResponseDto,
  MessageStatus,
  UserMessageData,
  SystemMessageData,
  WorkflowName,
} from '../../generated';
import * as TestUtils from '../../utils/testUtils';
import {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../types';
import { createHash } from 'node:crypto';
import { canonicalizeJcs } from '../../core/websockets/trigger-canonicalization';

const { testIds } = TestUtils;
const executableRequest = (
  data: UserMessageData,
): SubmitExecutableUserMessageRequestDto => {
  const message = {
    type: 'USER' as const,
    conversationId: testIds.conversation as ConversationId,
    projectId: testIds.project as ProjectId,
    agentSessionId: '66666666-6666-4666-8666-666666666666',
    data,
  };
  return {
    ...message,
    operationId: '55555555-5555-4555-8555-555555555555',
    operationFingerprint: createHash('sha256')
      .update(
        canonicalizeJcs({
          kind: 'DIRECT_TRIGGER',
          organizationId: testIds.organization,
          projectId: testIds.project,
          message,
        }),
      )
      .digest('hex'),
    authorization: {
      kind: 'bounded_grant',
      grantId: '99999999-9999-4999-8999-999999999999',
    },
  };
};

describe('MessageController', () => {
  let controller: MessageController;
  let messageService: {
    getMessagesForAdapter: jest.Mock;
    getMessageForAdapter: jest.Mock;
    addMessageFromAdapter: jest.Mock;
    addMessage: jest.Mock;
    searchByWorkflowAbout: jest.Mock;
    updateMessageFromAdapter: jest.Mock;
  };
  let conversationService: { getConversationFromAdapter: jest.Mock };
  let flowExecutionService: {
    findPausedByConversation: jest.Mock;
    resolveConversationPromptType: jest.Mock;
  };
  let workflowTypeRegistry: { isNonTemporalBackedWorkflow: jest.Mock };
  const agentOperationRegistry = {
    begin: jest.fn().mockResolvedValue({
      disposition: 'EXECUTE',
      operation: {
        result: {
          reservedMessageId: '55555555-5555-4555-8555-555555555556',
          reservedTriggerMessageId: '55555555-5555-4555-8555-555555555557',
        },
      },
      executionOwner: '55555555-5555-4555-8555-555555555558',
    }),
    reservedMessageIds: jest.fn().mockReturnValue({
      messageId: '55555555-5555-4555-8555-555555555556',
      triggerMessageId: '55555555-5555-4555-8555-555555555557',
    }),
    recordAuthorization: jest.fn(),
    succeed: jest.fn(),
    fail: jest.fn(),
  };

  beforeEach(() => {
    messageService = {
      getMessagesForAdapter: jest.fn().mockResolvedValue([]),
      getMessageForAdapter: jest.fn().mockResolvedValue(null),
      addMessageFromAdapter: jest
        .fn()
        .mockImplementation(async (dto) => dto as MessageResponseDto),
      addMessage: jest.fn().mockResolvedValue({}),
      searchByWorkflowAbout: jest.fn().mockResolvedValue([]),
      updateMessageFromAdapter: jest.fn().mockResolvedValue({}),
    };
    conversationService = {
      getConversationFromAdapter: jest.fn().mockResolvedValue(
        TestUtils.createMockConversation({
          id: testIds.conversation,
          workflowId: testIds.workflow,
          workflowName: 'feature-sync',
        }),
      ),
    };
    flowExecutionService = {
      findPausedByConversation: jest.fn().mockResolvedValue(null),
      resolveConversationPromptType: jest.fn().mockResolvedValue({
        promptType: null,
        nodeId: null,
        triggerMessageId: null,
      }),
    };
    workflowTypeRegistry = {
      isNonTemporalBackedWorkflow: jest.fn().mockReturnValue(false),
    };
    const temporalClient = {} as Client;
    const executionGrantService = {
      assertInteractiveAuthorized: jest.fn().mockResolvedValue({
        authorizationId: '99999999-9999-4999-8999-999999999999',
        requestId: '88888888-8888-4888-8888-888888888888',
        machineId: '77777777-7777-4777-8777-777777777777',
        agentSessionId: '66666666-6666-4666-8666-666666666666',
        action: {},
        envelopeAuthorization: {
          kind: 'bounded_grant',
          grantId: '99999999-9999-4999-8999-999999999999',
        },
      }),
      deriveInteractiveGrant: jest.fn(),
    };
    controller = new MessageController(
      messageService as unknown as MessageService,
      conversationService as unknown as ConversationService,
      flowExecutionService as unknown as FlowExecutionService,
      workflowTypeRegistry as unknown as WorkflowTypeRegistryService,
      temporalClient,
      executionGrantService as unknown as ExecutionGrantService,
      agentOperationRegistry as unknown as AgentOperationRegistryService,
    );
  });

  describe('getMessages', () => {
    const baseQuery: GetMessagesQueryDto = {
      projectId: testIds.project,
      conversationId: testIds.conversation,
    };

    it('forwards includeReports=false to the service when the query flag is absent', async () => {
      await controller.getMessages(
        testIds.organization,
        testIds.project as ProjectId,
        baseQuery,
      );

      expect(messageService.getMessagesForAdapter).toHaveBeenCalledWith(
        baseQuery,
        testIds.organization,
        testIds.project,
        true, // includeResponses default
        true, // includeProposals default
        false, // includeReports default
      );
    });

    it('forwards includeReports=true to the service when the query flag is "true"', async () => {
      await controller.getMessages(
        testIds.organization,
        testIds.project as ProjectId,
        baseQuery,
        undefined,
        undefined,
        'true',
      );

      expect(messageService.getMessagesForAdapter).toHaveBeenCalledWith(
        baseQuery,
        testIds.organization,
        testIds.project,
        true,
        true,
        true,
      );
    });

    it('treats any non-"true" includeReports value as false (strict opt-in)', async () => {
      await controller.getMessages(
        testIds.organization,
        testIds.project as ProjectId,
        baseQuery,
        undefined,
        undefined,
        '1',
      );

      const call = messageService.getMessagesForAdapter.mock.calls[0];
      // 6th positional arg is includeReports
      expect(call?.[5]).toBe(false);
    });

    it('returns the service result unchanged', async () => {
      const fakeResult = [
        { id: 'msg-1', reports: [{ id: 'r-1' }] },
      ] as unknown as MessageResponseDto[];
      messageService.getMessagesForAdapter.mockResolvedValue(fakeResult);

      const result = await controller.getMessages(
        testIds.organization,
        testIds.project as ProjectId,
        baseQuery,
        undefined,
        undefined,
        'true',
      );

      expect(result).toBe(fakeResult);
    });

    it('returns a reverse-history page unchanged', async () => {
      const page = {
        messages: [],
        nextCursor: 'next-page',
      } satisfies ConversationMessageHistoryPageDto;
      messageService.getMessagesForAdapter.mockResolvedValue(page);

      const result = await controller.getMessages(
        testIds.organization,
        testIds.project as ProjectId,
        baseQuery,
      );

      expect(result).toBe(page);
    });
  });

  describe('postMessage — inbound USER validation (wire-discriminator contract)', () => {
    const post = (data: UserMessageData) =>
      controller.postMessage(
        testIds.project as ProjectId,
        testIds.organization as OrganizationId,
        testIds.user as UserId,
        executableRequest(data),
      );

    it('rejects a body that supplies data.triggersAgent (server-stamped only)', async () => {
      await expect(
        post({
          agentInput: { promptType: 'free_form' },
          triggersAgent: {
            promptType: 'user_message',
            triggerMessageId: 'x',
            sourceUserMessageId: 'x',
            payload: { handlerPromptType: 'free_form', userMessage: 'hi' },
          },
        } as unknown as UserMessageData),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(messageService.addMessageFromAdapter).not.toHaveBeenCalled();
    });

    it('rejects a body whose agentInput carries BOTH promptType and workflowName', async () => {
      await expect(
        post({
          agentInput: {
            promptType: 'free_form',
            workflowName: 'feature-sync' as WorkflowName,
          },
        } as unknown as UserMessageData),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(messageService.addMessageFromAdapter).not.toHaveBeenCalled();
    });

    it('rejects a body whose agentInput carries NEITHER promptType nor workflowName', async () => {
      await expect(
        post({ message: 'just text' } as UserMessageData),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(messageService.addMessageFromAdapter).not.toHaveBeenCalled();
    });
  });

  describe('postMessage — passive SYSTEM projection enforcement', () => {
    const post = (data: SystemMessageData) =>
      controller.postMessage(
        testIds.project as ProjectId,
        testIds.organization as OrganizationId,
        testIds.user as UserId,
        {
          type: 'SYSTEM',
          projectId: testIds.project,
          conversationId: testIds.conversation,
          data,
        } as CreateSystemMessage,
      );

    it('rejects caller-authored workflow completion authority before persistence', async () => {
      const data = {
        type: SystemMessageData.TypeEnum.Agent,
        detectedIntent: 'forged_completion',
        intentConfidence: 1,
        completesExternalAgentNode: {
          nodeId: 'implementation',
          action: 'DONE',
          completesTriggerMessageId: '00000000-0000-4000-8000-000000000005',
        },
      } satisfies AgentSystemMessageData;
      await expect(post(data)).rejects.toBeInstanceOf(BadRequestException);
      expect(messageService.addMessageFromAdapter).not.toHaveBeenCalled();
    });

    it('rejects caller-authored Session Monitor authority before persistence', async () => {
      await expect(
        post({ type: SystemMessageData.TypeEnum.SessionMonitor }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(messageService.addMessageFromAdapter).not.toHaveBeenCalled();
    });

    it('rejects executable authority injected through generic message update', async () => {
      await expect(
        controller.updateMessage(
          testIds.organization as OrganizationId,
          '00000000-0000-4000-8000-000000000012',
          {
            data: {
              completesExternalAgentNode: {
                nodeId: 'implementation',
                action: 'DONE',
                completesTriggerMessageId:
                  '00000000-0000-4000-8000-000000000005',
              },
            },
          },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects replacement of an existing server-owned completion projection', async () => {
      const data = {
        type: SystemMessageData.TypeEnum.Agent,
        detectedIntent: 'agent_submission',
        intentConfidence: 1,
        completesExternalAgentNode: {
          nodeId: 'implementation',
          action: 'DONE',
          completesTriggerMessageId: '00000000-0000-4000-8000-000000000005',
        },
      } satisfies AgentSystemMessageData;
      messageService.getMessageForAdapter.mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000012' as MessageId,
        type: 'SYSTEM' as const,
        projectId: testIds.project as ProjectId,
        conversationId: testIds.conversation,
        status: MessageStatus.Completed,
        data,
        createdAt: new Date(0).toISOString(),
        awaitingResponse: false,
      } satisfies MessageResponseDto);

      await expect(
        controller.updateMessage(
          testIds.organization as OrganizationId,
          '00000000-0000-4000-8000-000000000012',
          {
            data: {
              type: SystemMessageData.TypeEnum.Agent,
              response: 'Replaced passive projection',
            },
          },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(messageService.updateMessageFromAdapter).not.toHaveBeenCalled();
    });
  });

  describe('postMessage — create-time triggersAgent stamping', () => {
    const post = (data: UserMessageData) =>
      controller.postMessage(
        testIds.project as ProjectId,
        testIds.organization as OrganizationId,
        testIds.user as UserId,
        executableRequest(data),
      );

    const stampedArg = (): CreateUserMessage & { id?: string } =>
      messageService.addMessage.mock.calls[0]?.[0] ??
      messageService.addMessageFromAdapter.mock.calls[0][0];

    it('persists distinct user and trigger message identities for a promptType message', async () => {
      await post({
        agentInput: {
          promptType: 'feature_sync_analyze',
          userMessage: 'do the analyze',
        },
      } as unknown as UserMessageData);

      expect(messageService.addMessageFromAdapter).toHaveBeenCalledTimes(1);
      // promptType never consults the resolver.
      expect(
        flowExecutionService.resolveConversationPromptType,
      ).not.toHaveBeenCalled();
      const arg = stampedArg();
      const trigger = (arg.data as UserMessageData).triggersAgent as Record<
        string,
        unknown
      >;
      expect(arg.id).toBe('55555555-5555-4555-8555-555555555557');
      expect(trigger.promptType).toBe('user_message');
      expect(trigger.triggerMessageId).toBe(arg.id);
      expect(trigger.sourceUserMessageId).toBe(
        '55555555-5555-4555-8555-555555555556',
      );
      expect(
        (trigger.payload as Record<string, unknown>).handlerPromptType,
      ).toBe('feature_sync_analyze');
      expect((trigger.payload as Record<string, unknown>).userMessage).toBe(
        'do the analyze',
      );
      expect((trigger.payload as Record<string, unknown>).attachments).toEqual(
        [],
      );
    });

    it('copies the message attachment references onto the dispatch payload', async () => {
      const attachments = [
        {
          attachmentId: '77777777-7777-4777-8777-777777777777',
          fileName: 'notes.md',
        },
      ];

      await post({
        agentInput: {
          promptType: 'free_form',
          userMessage: 'read this',
        },
        attachments,
      } as unknown as UserMessageData);

      const trigger = (stampedArg().data as UserMessageData)
        .triggersAgent as Record<string, unknown>;
      expect((trigger.payload as Record<string, unknown>).attachments).toEqual(
        attachments,
      );
    });

    it.each(['commit', 'code_review'] as const)(
      'copies the %s modal runtime selection onto the signed dispatch payload',
      async (promptType) => {
        const runtime = {
          provider: 'codex' as const,
          model: 'gpt-6-luna',
          reasoningEffort: 'medium' as const,
          fastMode: false,
        };

        await post({
          agentInput: { promptType, userMessage: '', runtime },
        } as UserMessageData);

        const trigger = (stampedArg().data as UserMessageData)
          .triggersAgent as Record<string, unknown>;
        expect((trigger.payload as Record<string, unknown>).runtime).toEqual(
          runtime,
        );
      },
    );

    it('omits runtime from the signed payload when a commit follow-up carries no selection', async () => {
      await post({
        agentInput: { promptType: 'commit', userMessage: '' },
      } as UserMessageData);

      const trigger = (stampedArg().data as UserMessageData)
        .triggersAgent as Record<string, unknown>;
      expect(trigger.payload).not.toHaveProperty('runtime');
    });

    it('preserves typed Task Monitor lifecycle input in the signed dispatch payload', async () => {
      const taskMonitorPayload = {
        promptType: 'task_monitor' as const,
        monitorId: '66666666-6666-4666-8666-666666666666',
        cause: 'PAUSE' as const,
        correlationId: '88888888-8888-4888-8888-888888888888',
      };

      await post({ agentInput: taskMonitorPayload } as UserMessageData);

      const arg = stampedArg();
      const trigger = (arg.data as UserMessageData).triggersAgent as Record<
        string,
        unknown
      >;
      expect(trigger.payload).toMatchObject({
        handlerPromptType: 'task_monitor',
        userMessage: '',
        taskMonitorPayload: {
          monitorId: taskMonitorPayload.monitorId,
          cause: taskMonitorPayload.cause,
          correlationId: taskMonitorPayload.correlationId,
        },
      });
    });

    describe.skip('retired generic workflowName stamping', () => {
      it('does NOT stamp a Temporal-backed workflowName with a live workflowId (processor signals downstream)', async () => {
        workflowTypeRegistry.isNonTemporalBackedWorkflow.mockReturnValue(false);
        conversationService.getConversationFromAdapter.mockResolvedValue(
          TestUtils.createMockConversation({
            id: testIds.conversation,
            workflowId: testIds.workflow,
            workflowName: 'feature-sync',
          }),
        );

        await post({
          agentInput: { workflowName: 'feature-sync' as WorkflowName },
        } as unknown as UserMessageData);

        const arg = stampedArg();
        expect((arg.data as UserMessageData).triggersAgent).toBeUndefined();
        expect(arg.id).toBe('55555555-5555-4555-8555-555555555556');
        expect(
          flowExecutionService.findPausedByConversation,
        ).not.toHaveBeenCalled();
      });

      it('does NOT stamp a Temporal-backed workflowName with no live workflow but a resumable paused execution (processor resumes downstream)', async () => {
        workflowTypeRegistry.isNonTemporalBackedWorkflow.mockReturnValue(false);
        conversationService.getConversationFromAdapter.mockResolvedValue(
          TestUtils.createMockConversation({
            id: testIds.conversation,
            workflowId: undefined,
            workflowName: 'feature-sync',
          }),
        );
        flowExecutionService.findPausedByConversation.mockResolvedValue({
          id: 'paused-exec-1',
        });

        await post({
          agentInput: { workflowName: 'feature-sync' as WorkflowName },
        } as unknown as UserMessageData);

        const arg = stampedArg();
        expect((arg.data as UserMessageData).triggersAgent).toBeUndefined();
        expect(
          flowExecutionService.findPausedByConversation,
        ).toHaveBeenCalled();
      });

      it('stamps terminalPromptType for a Temporal-backed workflowName with no live workflow and nothing resumable', async () => {
        workflowTypeRegistry.isNonTemporalBackedWorkflow.mockReturnValue(false);
        conversationService.getConversationFromAdapter.mockResolvedValue(
          TestUtils.createMockConversation({
            id: testIds.conversation,
            workflowId: undefined,
            workflowName: 'feature-sync',
          }),
        );
        flowExecutionService.findPausedByConversation.mockResolvedValue(null);
        flowExecutionService.resolveConversationPromptType.mockResolvedValue({
          promptType: 'feature_sync_iterate',
          nodeId: null,
          triggerMessageId: null,
        });

        await post({
          agentInput: {
            workflowName: 'feature-sync' as WorkflowName,
            userMessage: 'go',
          },
        } as unknown as UserMessageData);

        const arg = stampedArg();
        const trigger = (arg.data as UserMessageData).triggersAgent as Record<
          string,
          unknown
        >;
        expect(arg.id).toBeTruthy();
        expect(trigger.triggerMessageId).toBe(arg.id);
        expect(
          (trigger.payload as Record<string, unknown>).handlerPromptType,
        ).toBe('feature_sync_iterate');
        // Resolver is consulted with workflowId:null so it returns terminalPromptType.
        expect(
          flowExecutionService.resolveConversationPromptType,
        ).toHaveBeenCalledWith(expect.objectContaining({ workflowId: null }));
      });

      it('stamps a non-Temporal-backed workflowName (defensive: nothing to signal or resume)', async () => {
        workflowTypeRegistry.isNonTemporalBackedWorkflow.mockReturnValue(true);
        conversationService.getConversationFromAdapter.mockResolvedValue(
          TestUtils.createMockConversation({
            id: testIds.conversation,
            workflowId: undefined,
            workflowName: 'daily-session',
          }),
        );
        flowExecutionService.resolveConversationPromptType.mockResolvedValue({
          promptType: 'daily_session',
          nodeId: null,
          triggerMessageId: null,
        });

        await post({
          agentInput: { workflowName: 'daily-session' as WorkflowName },
        } as unknown as UserMessageData);

        const arg = stampedArg();
        const trigger = (arg.data as UserMessageData).triggersAgent as Record<
          string,
          unknown
        >;
        expect(trigger.promptType).toBe('user_message');
        expect(
          (trigger.payload as Record<string, unknown>).handlerPromptType,
        ).toBe('daily_session');
        // Non-Temporal never probes for a resumable execution.
        expect(
          flowExecutionService.findPausedByConversation,
        ).not.toHaveBeenCalled();
      });

      it('leaves the message unstamped when no handlerPromptType is resolvable for a workflowName stamp', async () => {
        workflowTypeRegistry.isNonTemporalBackedWorkflow.mockReturnValue(true);
        conversationService.getConversationFromAdapter.mockResolvedValue(
          TestUtils.createMockConversation({
            id: testIds.conversation,
            workflowId: undefined,
            workflowName: 'agent-session',
          }),
        );
        flowExecutionService.resolveConversationPromptType.mockResolvedValue({
          promptType: null,
          nodeId: null,
          triggerMessageId: null,
        });

        await post({
          agentInput: { workflowName: 'agent-session' as WorkflowName },
        } as unknown as UserMessageData);

        const arg = stampedArg();
        expect((arg.data as UserMessageData).triggersAgent).toBeUndefined();
        expect(arg.id).toBe('55555555-5555-4555-8555-555555555556');
      });
    });
  });

  describe('searchMessages', () => {
    const ANCHOR_ID = 'goal-anchor-123';
    const ANCHOR_TYPE = 'GOAL';
    const OTHER_ANCHOR_ID = 'goal-anchor-other';

    const callSearch = (
      query: string,
      opts: {
        workflowAboutId?: string;
        workflowAboutType?: string;
        limit?: string;
      } = {},
    ) =>
      controller.searchMessages(
        testIds.organization as OrganizationId,
        testIds.project as ProjectId,
        opts.workflowAboutId ?? ANCHOR_ID,
        opts.workflowAboutType ?? ANCHOR_TYPE,
        query,
        opts.limit,
      );

    it('happy path: returns matches the service produced across multiple conversations anchored to the same entity', async () => {
      const matches: SearchConversationMessagesResponseDto[] = [
        {
          conversationId: 'conv-a' as unknown as ConversationId,
          conversationTitle: 'First conversation',
          messageId: 'msg-1' as unknown as ConversationId &
            SearchConversationMessagesResponseDto['messageId'],
          snippet: '…matching snippet a…',
          createdAt: '2026-06-01T12:00:00.000Z',
          type: MessageType.User,
        },
        {
          conversationId: 'conv-b' as unknown as ConversationId,
          conversationTitle: null,
          messageId: 'msg-2' as unknown as ConversationId &
            SearchConversationMessagesResponseDto['messageId'],
          snippet: '…matching snippet b…',
          createdAt: '2026-06-01T11:00:00.000Z',
          type: MessageType.System,
        },
      ];
      messageService.searchByWorkflowAbout.mockResolvedValue(matches);

      const result = await callSearch('matching');

      expect(result).toBe(matches);
      expect(messageService.searchByWorkflowAbout).toHaveBeenCalledWith({
        organizationId: testIds.organization,
        projectId: testIds.project,
        workflowAboutId: ANCHOR_ID,
        workflowAboutType: ANCHOR_TYPE,
        query: 'matching',
        limit: undefined,
      });
      const distinctConversations = new Set(
        result.map((r) => r.conversationId),
      );
      expect(distinctConversations.size).toBe(2);
    });

    it('exclusion: the controller scopes the service call to the requested workflowAboutId — a different anchor never reaches the same query', async () => {
      messageService.searchByWorkflowAbout.mockResolvedValue([]);

      await callSearch('matching');
      await callSearch('matching', { workflowAboutId: OTHER_ANCHOR_ID });

      const calls = messageService.searchByWorkflowAbout.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0].workflowAboutId).toBe(ANCHOR_ID);
      expect(calls[1][0].workflowAboutId).toBe(OTHER_ANCHOR_ID);
      // The two anchors hit the service with distinct ids — there is no
      // controller-level path that would merge results across anchors.
      expect(calls[0][0].workflowAboutId).not.toBe(calls[1][0].workflowAboutId);
    });

    it('empty query rejects: the service throws BadRequestException for an empty/whitespace query and the controller propagates it', async () => {
      messageService.searchByWorkflowAbout.mockRejectedValue(
        new BadRequestException('`query` is required and must be non-empty'),
      );

      await expect(callSearch('   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('no-match: an empty data array passes through unchanged', async () => {
      messageService.searchByWorkflowAbout.mockResolvedValue([]);

      const result = await callSearch('nothing-matches-this');

      expect(result).toEqual([]);
    });

    it('rejects a request with missing workflowAboutId before the service is touched', async () => {
      await expect(
        callSearch('q', { workflowAboutId: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(messageService.searchByWorkflowAbout).not.toHaveBeenCalled();
    });

    it('forwards a numeric `limit` query param to the service', async () => {
      messageService.searchByWorkflowAbout.mockResolvedValue([]);

      await callSearch('q', { limit: '42' });

      expect(messageService.searchByWorkflowAbout).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 42 }),
      );
    });
  });
});
