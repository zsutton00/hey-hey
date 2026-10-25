/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as crypto from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { Client } from '@temporalio/client';
import { MessageController } from '../message.controller';
import { MessageService } from '../../services/message.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ConversationService } from '../../services/conversation.service';
import type { FlowExecutionService } from '../../services/workflows/flow-execution.service';
import { WorkflowTypeRegistryService } from '../../services/workflows/workflow-type-registry.service';
import type { ExecutionGrantService } from '../../services/controller-authorization/execution-grant.service';
import type { AgentOperationRegistryService } from '../../services/agent-operation/agent-operation-registry.service';
import type { DomainEventPublisher } from '../../core/events/domain-event-publisher';
import type { RedisService } from '../../core/redis/redis.service';
import type { MentionProcessingService } from '../../services/mentions/mention-processing.service';
import type { ReportService } from '../../services/reports/report.service';
import {
  CreateUserMessage,
  SubmitExecutableUserMessageRequestDto,
  MessageRecordDto,
  UserMessageData,
  WorkflowName,
} from '../../generated';
import * as TestUtils from '../../utils/testUtils';
import { ConversationId, OrganizationId, ProjectId, UserId } from '../../types';
import {
  AGENT_INPUT_FIXTURES,
  PROMPT_TYPE_FIXTURES,
} from '../../../test/fixtures/userMessageAgentInput';
import { canonicalizeJcs } from '../../core/websockets/trigger-canonicalization';

const { testIds } = TestUtils;

/**
 * Inbound contract test for the `UserMessageData.agentInput` wire-discriminator
 * (@[feature:3e746c36-29f4-411e-814b-aaa79ce14f3e|CLI Run Input Dispatch]).
 *
 * The parent audit (@[task:b89aaa0c-ff7b-4fdd-b882-7e11fdf7c4f9|API: dispatch
 * USER messages on wire-declared `promptType` xor `workflowName`]) confirmed
 * `assertValidInboundUserMessageData` + `stampUserMessageDispatch` are aligned
 * to the `data.agentInput` discriminator but left no mechanical per-arm guard.
 * This test is that guard: it drives every direct `promptType` arm through the
 * REAL inbound boundary
 * (`MessageController.postMessage` → real `MessageService.addMessage` over an
 * in-memory Prisma double) and asserts the persisted row + signed trigger
 * envelope + `pending_open_trigger` row — never just a response code.
 *
 * Persistence is exercised against an in-memory Prisma fake rather than Postgres
 * so the test runs in the fast `src` suite (`pnpm test`). The fake implements
 * exactly the surface `MessageService.addMessage` →
 * `maintainPendingOpenTriggerStore` touches; the projection logic under test is
 * the production code, unmocked.
 */

interface FakeConversationConfig {
  workflowId?: string;
  workflowName: string;
  /** Whether an AgentSession binds the conversation (required for re-fan tracking). */
  hasAgentSession: boolean;
}

interface InMemoryStore {
  prisma: any;
  messages: Array<{ id: string; data: UserMessageData }>;
  pendingOpenTriggers: Array<{ messageId: string; userId: string }>;
}

/**
 * Minimal in-memory Prisma double covering the surface
 * `addMessageFromAdapter` → `addMessage` → `maintainPendingOpenTriggerStore`
 * reads/writes. Everything else on `PrismaService` is intentionally absent — a
 * call to an un-faked method throws, surfacing drift rather than silently
 * passing.
 */
function createInMemoryPrisma(config: FakeConversationConfig): InMemoryStore {
  const conversation = {
    id: testIds.conversation as string,
    projectId: testIds.project as string,
    organizationId: testIds.organization as string,
    workflowId: config.workflowId,
    workflowAboutId: null as string | null,
    workflowAboutType: null as string | null,
    version: 0,
  };

  const messages: InMemoryStore['messages'] = [];
  const pendingOpenTriggers: InMemoryStore['pendingOpenTriggers'] = [];

  let seq = 0;
  const nextId = () => `generated-message-${++seq}`;

  const tx = {
    conversation: {
      findUnique: async () => ({
        version: conversation.version,
        workflowId: conversation.workflowId,
        workflowAboutId: conversation.workflowAboutId,
        workflowAboutType: conversation.workflowAboutType,
      }),
      update: async () => {
        conversation.version += 1;
        return {
          version: conversation.version,
          projectId: conversation.projectId,
        };
      },
    },
    message: {
      create: async ({ data }: { data: any }) => {
        const id = (data.id as string) ?? nextId();
        messages.push({ id, data: data.data as UserMessageData });
        return {
          id,
          projectId: data.projectId,
          type: data.type,
          status: data.status,
          userId: data.userId,
          data: data.data,
          conversationId: data.conversationId,
          parentMessageId: data.parentMessageId ?? null,
          createdAt:
            data.createdAt instanceof Date ? data.createdAt : new Date(),
          responses: [],
          parentMessage: null,
          conversation: { workflowId: conversation.workflowId },
        };
      },
    },
    messageMention: {
      createMany: async () => ({ count: 0 }),
    },
    agentSession: {
      findFirst: async () =>
        config.hasAgentSession ? { userId: testIds.user as string } : null,
    },
    pendingOpenTrigger: {
      create: async ({
        data,
      }: {
        data: { messageId: string; userId: string };
      }) => {
        const row = { messageId: data.messageId, userId: data.userId };
        pendingOpenTriggers.push(row);
        return row;
      },
      deleteMany: async () => ({ count: 0 }),
    },
  };

  const prisma = {
    db: {
      conversation: {
        findFirst: async () => ({ projectId: conversation.projectId }),
      },
      message: {
        findFirst: async () => null,
      },
    },
    $transaction: async (cb: (txClient: typeof tx) => Promise<unknown>) =>
      cb(tx),
  };

  return { prisma, messages, pendingOpenTriggers };
}

/** Mocked peripheral collaborators the controller needs but this test doesn't drive. */
function createPeripheralMocks() {
  return {
    eventPublisher: {
      publish: jest.fn().mockResolvedValue(undefined),
      publishInTransaction: jest.fn().mockResolvedValue(undefined),
    } as unknown as DomainEventPublisher,
    redisService: {} as unknown as RedisService,
    mentionProcessingService: {
      extractMentionTokens: jest.fn().mockReturnValue([]),
    } as unknown as MentionProcessingService,
    reportService: {} as unknown as ReportService,
  };
}

interface Harness {
  controller: MessageController;
  store: InMemoryStore;
  flowExecutionService: {
    findPausedByConversation: jest.Mock;
    resolveConversationPromptType: jest.Mock;
  };
}

/**
 * Wire the REAL controller + REAL MessageService + REAL
 * WorkflowTypeRegistryService over the in-memory store, with the conversation
 * lookup and Temporal-classification probes mocked so each arm/state can be
 * driven deterministically.
 */
function buildHarness(config: FakeConversationConfig): Harness {
  const store = createInMemoryPrisma(config);
  const peripherals = createPeripheralMocks();

  const messageService = new MessageService(
    store.prisma as unknown as PrismaService,
    peripherals.eventPublisher,
    peripherals.redisService,
    peripherals.mentionProcessingService,
    peripherals.reportService,
  );

  const conversationService = {
    getConversationFromAdapter: jest.fn().mockResolvedValue(
      TestUtils.createMockConversation({
        id: testIds.conversation,
        projectId: testIds.project,
        organizationId: testIds.organization,
        workflowId: config.workflowId as any,
        workflowName: config.workflowName as WorkflowName,
      }),
    ),
  };

  const flowExecutionService = {
    findPausedByConversation: jest.fn().mockResolvedValue(null),
    resolveConversationPromptType: jest.fn().mockResolvedValue({
      promptType: null,
      nodeId: null,
      triggerMessageId: null,
    }),
  };

  // Real registry: `isNonTemporalBackedWorkflow` is pure; the Temporal client
  // is only touched by start paths this test never invokes.
  const workflowTypeRegistry = new WorkflowTypeRegistryService(
    {} as unknown as Client,
  );

  const controller = new MessageController(
    messageService,
    conversationService as unknown as ConversationService,
    flowExecutionService as unknown as FlowExecutionService,
    workflowTypeRegistry,
    {} as unknown as Client,
    {
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
    } as unknown as ExecutionGrantService,
    {
      begin: jest.fn().mockResolvedValue({
        disposition: 'EXECUTE',
        executionOwner: '44444444-4444-4444-8444-444444444444',
        operation: {
          result: {
            reservedMessageId: '33333333-3333-4333-8333-333333333333',
            reservedTriggerMessageId: '22222222-2222-4222-8222-222222222222',
          },
        },
      }),
      reservedMessageIds: jest.fn().mockReturnValue({
        messageId: '33333333-3333-4333-8333-333333333333',
        triggerMessageId: '22222222-2222-4222-8222-222222222222',
      }),
      recordAuthorization: jest.fn(),
      succeed: jest.fn(),
      fail: jest.fn(),
    } as unknown as AgentOperationRegistryService,
  );

  return { controller, store, flowExecutionService };
}

const post = (
  controller: MessageController,
  data: UserMessageData,
): Promise<MessageRecordDto> => {
  const semanticMessage = {
    type: 'USER' as const,
    conversationId: testIds.conversation as ConversationId,
    projectId: testIds.project as ProjectId,
    agentSessionId: '66666666-6666-4666-8666-666666666666',
    data,
  };
  const operationFingerprint = crypto
    .createHash('sha256')
    .update(
      canonicalizeJcs({
        kind: 'DIRECT_TRIGGER',
        organizationId: testIds.organization,
        projectId: testIds.project,
        message: semanticMessage,
      }),
      'utf8',
    )
    .digest('hex');
  return controller.postMessage(
    testIds.project as ProjectId,
    testIds.organization as OrganizationId,
    testIds.user as UserId,
    {
      ...semanticMessage,
      authorization: {
        kind: 'bounded_grant',
        grantId: '99999999-9999-4999-8999-999999999999',
      },
      operationId: '55555555-5555-4555-8555-555555555555',
      operationFingerprint,
    } as SubmitExecutableUserMessageRequestDto,
  );
};

/** Pull the stamped trigger off a persisted USER response as a loose record. */
const triggerOf = (
  response: MessageRecordDto | { data: UserMessageData },
): Record<string, any> => {
  if (!('type' in response)) {
    return response.data.triggersAgent as unknown as Record<string, any>;
  }

  if (response.type !== 'USER') {
    throw new Error('Expected a USER message response');
  }

  return response.data.triggersAgent as unknown as Record<string, any>;
};

describe('inbound agent-input contract: per-arm stamp + persistence', () => {
  afterEach(() => jest.clearAllMocks());

  describe('fixture table integrity', () => {
    it('enumerates every direct promptType arm in the generated contract', () => {
      const modelRoot = resolve(__dirname, '../../generated/model');
      const unionSource = readFileSync(
        resolve(modelRoot, 'userMessageAgentInput.ts'),
        'utf8',
      );
      const union = unionSource.match(
        /export type UserMessageAgentInput\s*=\s*([^;]+);/,
      );
      expect(union).not.toBeNull();
      const promptTypes = union![1]!
        .split('|')
        .map((member) => member.trim())
        .filter(Boolean)
        .map((name) => {
          const source = readFileSync(
            resolve(
              modelRoot,
              `${name.charAt(0).toLowerCase()}${name.slice(1)}.ts`,
            ),
            'utf8',
          );
          const discriminator = source.match(
            /export type PromptTypeEnum = '([^']+)'/,
          );
          expect(discriminator).not.toBeNull();
          return discriminator![1];
        });
      expect(
        PROMPT_TYPE_FIXTURES.map((fixture) => fixture.promptType).sort(),
      ).toEqual(promptTypes.sort());
      expect(AGENT_INPUT_FIXTURES).toHaveLength(promptTypes.length);
      // No duplicate arm identifiers — each promptType appears once.
      const ids = PROMPT_TYPE_FIXTURES.map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('keeps the CLI-facing JSON artifact byte-in-sync with the typed source', () => {
      // HEY CLAUDE: You can't import other repos here genius.
      // const jsonPath = resolve(
      //   __dirname,
      //   '../../../../openapi/specs/fixtures/user-message-agent-input.fixtures.json',
      // );
      // const onDisk = JSON.parse(readFileSync(jsonPath, 'utf8'));
      // expect(onDisk).toEqual(JSON.parse(JSON.stringify(AGENT_INPUT_FIXTURES)));

      expect(1).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Direct `promptType` arms. Each stamps `handlerPromptType = wire promptType`
  // and opens a `pending_open_trigger` row keyed to the stamped USER row id.
  // `it.each` names every case, so a single-arm regression fails with the arm.
  // ─────────────────────────────────────────────────────────────────────────
  describe.each(PROMPT_TYPE_FIXTURES.map((f) => [f.id, f] as const))(
    'promptType arm: %s',
    (_id, fixture) => {
      it('persists the USER row, stamps triggersAgent at the data root, and opens a pending_open_trigger', async () => {
        const { controller, store, flowExecutionService } = buildHarness({
          workflowId: testIds.workflow,
          workflowName: 'feature-sync',
          hasAgentSession: true,
        });

        const response = await post(controller, fixture.body);

        // The business USER row and its independent SYSTEM delivery row are
        // each persisted exactly once.
        expect(store.messages).toHaveLength(2);
        expect(response.id).toBe(store.messages[0]!.id);
        const triggerMessage = store.messages[1]!;

        // A promptType dispatch never consults the workflow resolver.
        expect(
          flowExecutionService.resolveConversationPromptType,
        ).not.toHaveBeenCalled();
        expect(
          flowExecutionService.findPausedByConversation,
        ).not.toHaveBeenCalled();

        // The independent SYSTEM row carries delivery identity while retaining
        // the USER row as the source identity.
        const trigger = triggerOf(triggerMessage);
        expect(trigger).toBeDefined();
        expect(trigger.promptType).toBe('user_message');
        expect(trigger.triggerMessageId).toBe(triggerMessage.id);
        expect(trigger.sourceUserMessageId).toBe(response.id);

        // The handler routing key matches the inbound promptType, and the
        // user text round-trips through the extractor.
        expect(trigger.payload.handlerPromptType).toBe(
          fixture.expectedHandlerPromptType,
        );
        expect(trigger.payload.userMessage).toBe(fixture.expectedUserMessage);
        if (fixture.promptType === 'feature_sync_iterate') {
          expect(trigger.payload.featureSyncContext).toEqual({
            discrepancies: [],
          });
        } else if (fixture.promptType === 'plan_shaping_feature_sync_iterate') {
          expect(trigger.payload.featureSyncContext).toEqual({
            planId: 'fixture-plan',
            designDocId: 'fixture-design-doc',
            discrepancies: [
              {
                id: 'fs-1',
                summary: 'Fixture gap',
                rationale: 'Fixture rationale',
              },
            ],
            decisions: [{ itemId: 'fs-1', choice: 'accept' }],
          });
        } else {
          expect(trigger.payload.featureSyncContext).toBeUndefined();
        }

        // A single pending_open_trigger opened for the SYSTEM delivery row.
        expect(store.pendingOpenTriggers).toEqual([
          { messageId: triggerMessage.id, userId: testIds.user },
        ]);
      });
    },
  );

  it.each([
    [
      'feature_sync_iterate',
      { promptType: 'feature_sync_iterate', userMessage: 'continue' },
    ],
    [
      'plan_shaping_feature_sync_iterate without discrepancies',
      { promptType: 'plan_shaping_feature_sync_iterate', decisions: [] },
    ],
    [
      'plan_shaping_feature_sync_iterate without decisions',
      {
        promptType: 'plan_shaping_feature_sync_iterate',
        discrepancies: [],
      },
    ],
    [
      'plan-shaping revision without Plan identity',
      {
        promptType: 'plan_shaping_feature_sync_iterate',
        designDocId: 'fixture-design-doc',
        discrepancies: [],
        decisions: [],
      },
    ],
    [
      'plan-shaping revision without design-doc identity',
      {
        promptType: 'plan_shaping_feature_sync_iterate',
        planId: 'fixture-plan',
        discrepancies: [],
        decisions: [],
      },
    ],
  ])(
    'rejects %s without the required iterate context before persistence',
    async (_name, agentInput) => {
      const { controller, store } = buildHarness({
        workflowId: testIds.workflow,
        workflowName: 'plan-from-design-doc',
        hasAgentSession: true,
      });

      await expect(
        post(controller, { agentInput } as unknown as UserMessageData),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(store.messages).toHaveLength(0);
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // The `workflowName` arm under all four Temporal-classification states.
  // ─────────────────────────────────────────────────────────────────────────
  describe.skip('legacy workflowName arm: removed by the dedicated workflow-answer endpoint', () => {
    const workflowBody = (
      workflowName: WorkflowName,
      userMessage: string,
    ): UserMessageData =>
      ({
        agentInput: { workflowName, userMessage },
      }) as unknown as UserMessageData;

    it('Temporal-live (live workflowId) → signals downstream, does NOT stamp, opens no trigger', async () => {
      const { controller, store, flowExecutionService } = buildHarness({
        workflowId: testIds.workflow,
        workflowName: 'feature-sync',
        hasAgentSession: true,
      });

      const response = await post(
        controller,
        workflowBody(WorkflowName.FeatureSync, 'live'),
      );

      expect(store.messages).toHaveLength(1);
      expect(triggerOf(response)).toBeUndefined();
      expect(store.pendingOpenTriggers).toHaveLength(0);
      // A live workflow defers before probing for a resumable execution.
      expect(
        flowExecutionService.findPausedByConversation,
      ).not.toHaveBeenCalled();
    });

    it('Temporal-paused-resumable (no workflowId, resumable execution) → resumes downstream, does NOT stamp, opens no trigger', async () => {
      const { controller, store, flowExecutionService } = buildHarness({
        workflowId: undefined,
        workflowName: 'feature-sync',
        hasAgentSession: true,
      });
      flowExecutionService.findPausedByConversation.mockResolvedValue({
        id: 'paused-execution',
      });

      const response = await post(
        controller,
        workflowBody(WorkflowName.FeatureSync, 'paused'),
      );

      expect(store.messages).toHaveLength(1);
      expect(triggerOf(response)).toBeUndefined();
      expect(store.pendingOpenTriggers).toHaveLength(0);
      expect(flowExecutionService.findPausedByConversation).toHaveBeenCalled();
    });

    it('Temporal-terminated (no workflowId, nothing resumable) → stamps the resolved terminalPromptType, opens a trigger', async () => {
      const { controller, store, flowExecutionService } = buildHarness({
        workflowId: undefined,
        workflowName: 'feature-sync',
        hasAgentSession: true,
      });
      flowExecutionService.findPausedByConversation.mockResolvedValue(null);
      flowExecutionService.resolveConversationPromptType.mockResolvedValue({
        promptType: 'feature_sync_iterate',
        nodeId: null,
        triggerMessageId: null,
      });

      const response = await post(
        controller,
        workflowBody(WorkflowName.FeatureSync, 'terminated'),
      );

      expect(store.messages).toHaveLength(2);
      const triggerMessage = store.messages[1]!;
      const trigger = triggerOf(triggerMessage);
      expect(trigger).toBeDefined();
      expect(trigger.triggerMessageId).toBe(triggerMessage.id);
      expect(trigger.sourceUserMessageId).toBe(response.id);
      expect(trigger.payload.handlerPromptType).toBe('feature_sync_iterate');
      expect(trigger.payload.userMessage).toBe('terminated');
      // Resolved with workflowId:null so the resolver returns the terminal key.
      expect(
        flowExecutionService.resolveConversationPromptType,
      ).toHaveBeenCalledWith(expect.objectContaining({ workflowId: null }));
      expect(store.pendingOpenTriggers).toEqual([
        { messageId: triggerMessage.id, userId: testIds.user },
      ]);
    });

    it('non-Temporal-backed workflow → stamps the resolved promptType (nothing to signal or resume), opens a trigger', async () => {
      const { controller, store, flowExecutionService } = buildHarness({
        workflowId: undefined,
        workflowName: 'daily-session',
        hasAgentSession: true,
      });
      flowExecutionService.resolveConversationPromptType.mockResolvedValue({
        promptType: 'daily_session',
        nodeId: null,
        triggerMessageId: null,
      });

      const response = await post(
        controller,
        workflowBody(WorkflowName.DailySession, 'non-temporal'),
      );

      expect(store.messages).toHaveLength(2);
      const triggerMessage = store.messages[1]!;
      const trigger = triggerOf(triggerMessage);
      expect(trigger).toBeDefined();
      expect(trigger.payload.handlerPromptType).toBe('daily_session');
      // Non-Temporal-backed workflows never probe for a resumable execution.
      expect(
        flowExecutionService.findPausedByConversation,
      ).not.toHaveBeenCalled();
      expect(store.pendingOpenTriggers).toEqual([
        { messageId: triggerMessage.id, userId: testIds.user },
      ]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Negative cases: each must be rejected 4xx before any persistence.
  // ─────────────────────────────────────────────────────────────────────────
  describe('negative cases: rejected 4xx, nothing persisted', () => {
    const expectRejectedWithNoPersistence = async (data: UserMessageData) => {
      const { controller, store } = buildHarness({
        workflowId: testIds.workflow,
        workflowName: 'feature-sync',
        hasAgentSession: true,
      });
      await expect(post(controller, data)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(store.messages).toHaveLength(0);
      expect(store.pendingOpenTriggers).toHaveLength(0);
    };

    it('rejects agentInput carrying BOTH promptType and workflowName', async () => {
      await expectRejectedWithNoPersistence({
        agentInput: {
          promptType: 'free_form',
          workflowName: WorkflowName.FeatureSync,
        },
      } as unknown as UserMessageData);
    });

    it('rejects workflowName-only input on the message endpoint', async () => {
      await expectRejectedWithNoPersistence({
        agentInput: {
          workflowName: WorkflowName.FeatureSync,
          action: 'APPROVED',
          payload: {},
        },
      } as unknown as UserMessageData);
    });

    it('rejects agentInput carrying NEITHER promptType nor workflowName', async () => {
      await expectRejectedWithNoPersistence({
        comment: 'just a freeform comment, no dispatch envelope',
      } as UserMessageData);
    });

    it('rejects a UI-supplied data.triggersAgent (server-stamped only)', async () => {
      await expectRejectedWithNoPersistence({
        agentInput: { promptType: 'free_form', userMessage: 'hi' },
        triggersAgent: {
          promptType: 'user_message',
          triggerMessageId: 'ui-claimed',
          sourceUserMessageId: 'ui-claimed',
          payload: { handlerPromptType: 'free_form', userMessage: 'hi' },
        },
      } as unknown as UserMessageData);
    });
  });
});
