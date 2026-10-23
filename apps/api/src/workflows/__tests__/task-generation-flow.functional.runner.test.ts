/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { v4 as uuidv4 } from 'uuid';

import { Message, WorkStatus } from '@prisma/client';
import { MessageStatus } from '../../constants/message-status.constants';
import { NodeRegistry } from '../../flows/nodes/node-registry.service';
import {
  TaskGenerationConversationNode,
  TaskGenerationEndNode,
  TaskGenerationGenerateNode,
  TaskGenerationGenerateStubsNode,
  TaskGenerationRecoveryNode,
  TaskGenerationWelcomeNode,
} from '../../flows/nodes/task-generation';
import { taskGenerationFlow } from '../../flows/templates/task-generation.flow';
import {
  ConversationResponseDto,
  ConversationStatus,
  MessageType,
} from '../../generated';
import { ConversationService } from '../../services/conversation.service';
import { DesignDocService } from '../../services/design-doc/design-doc.service';
import { LLMClientService } from '../../services/llm/llm-client.service';
import { TaskService } from '../../services/tasks/task.service';
import { InitiativeId, ProjectId, WorkflowId } from '../../types';
import * as activities from '../activities';
import { FunctionalTestRunner } from './utils/shared_functional_setup';

const runner = new FunctionalTestRunner({
  temporal: {
    taskQueue: 'conversation-queue',
    workflowsPath: require.resolve('../../workflows/workers'),
    activities,
  },
  registerFlows: (flowEngine) => {
    flowEngine.registerFlow(taskGenerationFlow);
  },
});

let nodesRegistered = false;

async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  { timeoutMs = 30000, intervalMs = 250 } = {},
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result) {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('waitFor timed out');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const expectConversation = (
  value: ConversationResponseDto | null,
): ConversationResponseDto => {
  expect(value).toBeDefined();
  if (!value) {
    throw new Error('Expected conversation to be created');
  }
  return value;
};

const waitForMessageCount = async (
  conversationId: string,
  expectedCount: number,
  mostRecentStatus?: MessageStatus,
) => {
  const { prisma } = runner.context;
  let attempts = 0;

  await waitFor(async () => {
    attempts += 1;
    const messages = await prisma.db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });

    if (messages.length < expectedCount) {
      if (attempts % 10 === 0) {
        console.log('[test] waitForMessageCount', {
          conversationId,
          current: messages.length,
          expected: expectedCount,
        });
      }
      return null;
    }

    if (mostRecentStatus) {
      const status = messages[messages.length - 1]?.status;
      if (status !== mostRecentStatus) {
        return null;
      }
    }

    return messages;
  });
};

const describeTaskFunctional =
  process.env.RUN_TASK_FUNCTIONAL_TESTS === '1' ? describe : describe.skip;

describeTaskFunctional('Task Generation Flow Compensation (Runner)', () => {
  beforeAll(async () => {
    await runner.suiteSetup();
  });

  afterAll(async () => {
    await runner.suiteTeardown();
  });

  beforeEach(async () => {
    await runner.testSetup();

    // Register task-generation flow nodes (only once)
    if (!nodesRegistered) {
      const nodeRegistry = runner.context.module.get(NodeRegistry);
      const taskService = runner.context.module.get(TaskService);
      const designDocService = runner.context.module.get(DesignDocService);
      nodeRegistry.register(new TaskGenerationWelcomeNode());
      nodeRegistry.register(new TaskGenerationConversationNode());
      nodeRegistry.register(new TaskGenerationGenerateStubsNode());
      nodeRegistry.register(
        new TaskGenerationGenerateNode(taskService, designDocService),
      );
      nodeRegistry.register(new TaskGenerationRecoveryNode());
      nodeRegistry.register(new TaskGenerationEndNode());
      nodesRegistered = true;
    }
  });

  afterEach(async () => {
    await runner.testTeardown();
  });

  it('retries task_generation_conversation after transient failure', async () => {
    const { prisma, module, messageService, testEnv } = runner.context;
    const conversationService =
      module.get<ConversationService>(ConversationService);

    const projectId = uuidv4() as ProjectId;
    await prisma.db.project.create({
      data: {
        id: projectId,
        name: 'Task Generation Compensation Test Project',
        description:
          'Test compensation system for task_generation_conversation node',
        organizationId: runner.organizationId,
        status: 'ACTIVE',
        createdBy: runner.userId,
      },
    });

    const workflowId = `task-gen-compensation-${Date.now()}` as WorkflowId;
    const taskConversation = expectConversation(
      await conversationService.createConversation(
        {
          projectId,
          workflowId,
          initiatedBy: 'USER',
          triggerEvent: 'TASK_GENERATION_STARTED',
          status: ConversationStatus.Started,
          title: 'Task Generation - Compensation Test',
          organizationId: runner.organizationId,
          workflowName: 'task-generation',
          workflowAboutId: projectId,
          workflowAboutType: 'initiative',
          context: {
            aboutId: projectId,
            aboutType: 'initiative',
          },
        },
        runner.organizationId,
      ),
    );

    await testEnv.client.workflow.start('conversationFlowWorkflow', {
      taskQueue: 'conversation-queue',
      workflowId,
      args: [
        {
          projectId,
          workflowId,
          organizationId: runner.organizationId,
          flowId: 'task-generation',
          userId: runner.userId,
          conversationId: taskConversation.id,
          initiatedBy: 'USER' as const,
          triggerEvent: 'TASK_GENERATION_STARTED',
          title: 'Task Generation - Compensation Test',
          workflowName: 'task-generation',
          additionalContext: {},
        },
      ],
    });

    await waitForMessageCount(taskConversation.id, 1);

    const llmClientService = module.get<LLMClientService>(LLMClientService);
    const originalCallStructured = llmClientService.callStructured;
    let attemptCount = 1;

    llmClientService.callStructured = jest
      .fn()
      .mockImplementation(async (prompt, options, source) => {
        const isConversationCall =
          prompt.includes('engages in conversation about task generation') ||
          prompt.includes('Understanding their project context and goals') ||
          prompt.includes(
            'task generation needs rather than immediately generating tasks',
          );

        if (attemptCount === 1 && isConversationCall) {
          attemptCount += 1;
          const timeoutError = new Error('Request timeout');
          timeoutError.name = 'TimeoutError';
          throw timeoutError;
        }

        if (attemptCount === 2 && isConversationCall) {
          attemptCount += 1;
          return {
            content: {
              response:
                'I understand you want to discuss task generation. Let me help you understand your project context and generate the right tasks.',
            },
            usage: {
              promptTokens: 100,
              completionTokens: 80,
              totalTokens: 180,
            },
            costData: {
              model: 'claude-4-haiku-20250108',
              inputTokens: 100,
              outputTokens: 80,
              totalTokens: 180,
              inputCost: 0.1,
              outputCost: 0.32,
              totalCost: 0.42,
            },
          };
        }

        return originalCallStructured.call(
          llmClientService,
          prompt,
          options,
          source,
        );
      });

    const initialMessages = await prisma.db.message.findMany({
      where: { conversationId: taskConversation.id },
      orderBy: { createdAt: 'asc' },
    });
    const latestSystemMessage = initialMessages
      .filter((msg: Message) => msg.type === MessageType.System)
      .pop();

    if (!latestSystemMessage) {
      throw new Error('No system message available to respond to');
    }

    await sleep(2000);

    await messageService.addMessage(
      {
        projectId,
        conversationId: taskConversation.id,
        type: 'USER' as const,
        status: MessageStatus.Completed,
        userId: runner.userId,
        data: {
          message:
            'I want to discuss what kinds of tasks would be best for my project. Can you help?',
        },
        parentMessageId: latestSystemMessage.id,
      },
      runner.organizationId,
      'runner-compensation-user',
    );

    await waitForMessageCount(taskConversation.id, 4, MessageStatus.Completed);

    const finalConversation = await prisma.db.conversation.findUnique({
      where: { id: taskConversation.id },
    });

    expect(attemptCount).toBeGreaterThan(2);
    expect(finalConversation?.status).toBe('IN_PROGRESS');

    llmClientService.callStructured = originalCallStructured;
  }, 90000);

  it('handles RATE_LIMITED compensation with proper delay', async () => {
    const { prisma, module, messageService, testEnv } = runner.context;
    const conversationService =
      module.get<ConversationService>(ConversationService);

    const projectId = uuidv4() as ProjectId;
    await prisma.db.project.create({
      data: {
        id: projectId,
        name: 'Task Generation Rate Limit Test Project',
        description:
          'Test RATE_LIMITED compensation for task_generation_conversation node',
        organizationId: runner.organizationId,
        status: 'ACTIVE',
        createdBy: runner.userId,
      },
    });

    const workflowId = `task-gen-rate-limit-${Date.now()}` as WorkflowId;
    const taskConversation = expectConversation(
      await conversationService.createConversation(
        {
          projectId,
          workflowId,
          initiatedBy: 'USER',
          triggerEvent: 'TASK_GENERATION_STARTED',
          status: ConversationStatus.Started,
          title: 'Task Generation - Rate Limit Test',
          organizationId: runner.organizationId,
          workflowName: 'task-generation',
          workflowAboutId: projectId,
          workflowAboutType: 'initiative',
          context: {
            aboutId: projectId,
            aboutType: 'initiative',
          },
        },
        runner.organizationId,
      ),
    );

    await testEnv.client.workflow.start('conversationFlowWorkflow', {
      taskQueue: 'conversation-queue',
      workflowId,
      args: [
        {
          projectId,
          workflowId,
          organizationId: runner.organizationId,
          flowId: 'task-generation',
          userId: runner.userId,
          conversationId: taskConversation.id,
          initiatedBy: 'USER' as const,
          triggerEvent: 'TASK_GENERATION_STARTED',
          title: 'Task Generation - Rate Limit Test',
          workflowName: 'task-generation',
          additionalContext: {},
        },
      ],
    });

    await waitForMessageCount(taskConversation.id, 1);

    const llmClientService = module.get<LLMClientService>(LLMClientService);
    const originalCallStructured = llmClientService.callStructured;
    let attemptCount = 0;

    llmClientService.callStructured = jest
      .fn()
      .mockImplementation(async (prompt, options, source) => {
        attemptCount += 1;
        const isConversationCall =
          prompt.includes(
            'helpful assistant that engages in conversation about task generation',
          ) || prompt.includes('Understanding their project context and goals');

        if (attemptCount === 1 && isConversationCall) {
          const rateLimitError = new Error('Rate limit exceeded');
          rateLimitError.name = 'RateLimitError';
          throw rateLimitError;
        }

        if (attemptCount === 2 && isConversationCall) {
          return {
            content: {
              response:
                'Thank you for your patience. I can now help you with task generation planning.',
            },
            usage: {
              promptTokens: 100,
              completionTokens: 80,
              totalTokens: 180,
            },
            costData: {
              model: 'claude-4-haiku-20250108',
              inputTokens: 100,
              outputTokens: 80,
              totalTokens: 180,
              inputCost: 0.1,
              outputCost: 0.32,
              totalCost: 0.42,
            },
          };
        }

        return originalCallStructured.call(
          llmClientService,
          prompt,
          options,
          source,
        );
      });

    const initialMessages = await prisma.db.message.findMany({
      where: { conversationId: taskConversation.id },
      orderBy: { createdAt: 'asc' },
    });
    const latestSystemMessage = initialMessages
      .filter((msg: Message) => msg.type === MessageType.System)
      .pop();

    if (!latestSystemMessage) {
      throw new Error('No system message available to respond to');
    }

    await sleep(2000);

    await messageService.addMessage(
      {
        projectId,
        conversationId: taskConversation.id,
        type: 'USER' as const,
        status: MessageStatus.Completed,
        userId: runner.userId,
        data: {
          message:
            'I would like to understand the available tasks you can generate for me.',
        },
        parentMessageId: latestSystemMessage.id,
      },
      runner.organizationId,
      'runner-rate-limit-user',
    );

    await waitForMessageCount(taskConversation.id, 4, MessageStatus.Completed);

    expect(attemptCount).toBeGreaterThan(1);

    const finalConversation = await prisma.db.conversation.findUnique({
      where: { id: taskConversation.id },
    });
    expect(finalConversation?.status).toBe('IN_PROGRESS');

    llmClientService.callStructured = originalCallStructured;
  }, 90000);

  it('generates tasks via direct button click (happy path)', async () => {
    const { prisma, module, messageService, testEnv } = runner.context;
    const conversationService =
      module.get<ConversationService>(ConversationService);

    // Step 1: Create project
    const projectId = uuidv4() as ProjectId;
    await prisma.db.project.create({
      data: {
        id: projectId,
        name: 'Task Generation Happy Path Test Project',
        description: 'Test complete task generation flow',
        organizationId: runner.organizationId,
        status: 'ACTIVE',
        createdBy: runner.userId,
      },
    });

    // Step 2: Create initiative and link to project
    const initiativeId = uuidv4() as InitiativeId;
    const initiative = await prisma.db.initiative.create({
      data: {
        id: initiativeId,
        name: 'Test Initiative for Task Generation',
        description:
          'Building a customer portal with authentication and user management',
        organizationId: runner.organizationId,
        status: WorkStatus.ACTIVE,
        priority: 'high',
        estimatedEffort: 'medium',
        createdBy: runner.userId,
      },
    });

    await prisma.db.projectInitiative.create({
      data: {
        projectId,
        initiativeId: initiative.id,
        organizationId: runner.organizationId,
      },
    });

    console.log('[test] Created project and initiative', {
      projectId,
      initiativeId,
    });

    // Step 3: Create conversation
    const workflowId = `task-gen-happy-path-${Date.now()}` as WorkflowId;
    const taskConversation = expectConversation(
      await conversationService.createConversation(
        {
          projectId,
          workflowId,
          initiatedBy: 'USER',
          triggerEvent: 'TASK_GENERATION_STARTED',
          status: ConversationStatus.Started,
          title: 'Task Generation - Happy Path Test',
          organizationId: runner.organizationId,
          workflowName: 'task-generation',
          workflowAboutId: initiative.id,
          workflowAboutType: 'initiative',
          context: {
            aboutId: initiative.id,
            aboutType: 'initiative',
          },
        },
        runner.organizationId,
      ),
    );

    // Step 4: Mock LLM for GENERATE node
    const llmClientService = module.get<LLMClientService>(LLMClientService);
    const originalCallStructured = llmClientService.callStructured;

    llmClientService.callStructured = jest
      .fn()
      .mockImplementation(async (prompt, options, source) => {
        const isGenerateCall =
          prompt.includes('task generation assistant') ||
          prompt.includes('Generate 3-8 tasks') ||
          prompt.includes('directly support the initiative');

        if (isGenerateCall) {
          console.log('[test] LLM mock: Returning task generation response');
          return {
            content: {
              tasks: [
                {
                  title: 'Implement User Authentication',
                  description:
                    'Create login and registration endpoints with JWT token support',
                  priority: 'high',
                  estimatedEffort: 'medium',
                  category: 'development',
                  influences: [],
                },
                {
                  title: 'Design Database Schema',
                  description: 'Define tables and relationships for user data',
                  priority: 'high',
                  estimatedEffort: 'small',
                  category: 'planning',
                  influences: [],
                },
              ],
              response:
                "I've generated 2 tasks aligned with your initiative objectives.",
            },
            usage: {
              promptTokens: 200,
              completionTokens: 150,
              totalTokens: 350,
            },
            costData: {
              model: 'claude-4-haiku-20250108',
              inputTokens: 200,
              outputTokens: 150,
              totalTokens: 350,
              inputCost: 0.2,
              outputCost: 0.6,
              totalCost: 0.8,
            },
          };
        }

        return originalCallStructured.call(
          llmClientService,
          prompt,
          options,
          source,
        );
      });

    // Step 5: Start workflow with initiative context
    await testEnv.client.workflow.start('conversationFlowWorkflow', {
      taskQueue: 'conversation-queue',
      workflowId,
      args: [
        {
          projectId,
          workflowId,
          organizationId: runner.organizationId,
          flowId: 'task-generation',
          userId: runner.userId,
          conversationId: taskConversation.id,
          initiatedBy: 'USER' as const,
          triggerEvent: 'TASK_GENERATION_STARTED',
          title: 'Task Generation - Happy Path Test',
          workflowName: 'task-generation',
          workflowAboutId: initiative.id,
          workflowAboutType: 'initiative' as const,
          additionalContext: {},
        },
      ],
    });

    console.log('[test] Workflow started with initiative context');

    // Step 6: Wait for WELCOME message
    await waitForMessageCount(taskConversation.id, 1);

    const initialMessages = await prisma.db.message.findMany({
      where: { conversationId: taskConversation.id },
      orderBy: { createdAt: 'asc' },
    });

    expect(initialMessages).toHaveLength(1);
    const welcomeMessage = initialMessages[0];
    expect(welcomeMessage.type).toBe(MessageType.System);
    expect(welcomeMessage.status).toBe(MessageStatus.Completed);

    console.log('[test] WELCOME message received');

    await sleep(1000);

    // Step 7: Send user message with magic string
    console.log('[test] Sending user message with magic string');

    await messageService.addMessage(
      {
        projectId,
        conversationId: taskConversation.id,
        type: 'USER' as const,
        status: MessageStatus.Completed,
        userId: runner.userId,
        data: {
          action: 'generate_tasks',
          comment: 'Generate tasks for my initiative',
        },
        parentMessageId: welcomeMessage.id,
      },
      runner.organizationId,
      'runner-happy-path-user',
    );

    // Step 8: Manually trigger outbox processing
    await runner.context.outboxPublisher['processOutboxEvents']();
    await sleep(500);

    console.log('[test] Outbox processed, waiting for GENERATE response');

    // Step 9: Wait for GENERATE response
    await waitForMessageCount(taskConversation.id, 3, MessageStatus.Completed);

    const messagesAfterGenerate = await prisma.db.message.findMany({
      where: { conversationId: taskConversation.id },
      orderBy: { createdAt: 'asc' },
    });

    const taskMessage = messagesAfterGenerate.find(
      (msg: Message) =>
        msg.type === MessageType.System &&
        (msg.data as { type?: string })?.type === 'TASKS' &&
        Array.isArray((msg.data as { tasks?: unknown[] })?.tasks),
    );

    expect(taskMessage).toBeDefined();
    const taskData = taskMessage?.data as {
      tasks?: Array<{
        title: string;
        description: string;
        priority: string;
        estimatedEffort: string;
        category: string;
      }>;
      response?: string;
      uiElements?: unknown[];
    };
    const tasks = taskData.tasks;
    expect(tasks).toBeDefined();
    if (!tasks) {
      throw new Error('Expected task data to include tasks');
    }
    console.log('[test] Task generation message found', {
      messageId: taskMessage?.id,
      taskCount: tasks.length,
    });

    // Step 10: Verify task data structure
    expect(tasks).toHaveLength(2);
    expect(taskData.response).toBeDefined();
    expect(taskData.response).toContain('generated');

    expect(tasks[0]).toMatchObject({
      title: expect.any(String),
      description: expect.any(String),
      priority: expect.stringMatching(/^(low|medium|high)$/),
      estimatedEffort: expect.stringMatching(/^(small|medium|large)$/),
      category: expect.any(String),
    });

    const firstTask = tasks[0];
    const secondTask = tasks[1];
    expect(firstTask).toBeDefined();
    expect(secondTask).toBeDefined();
    if (!firstTask || !secondTask) {
      throw new Error('Expected exactly two tasks to be generated');
    }

    expect(firstTask.title).toBe('Implement User Authentication');
    expect(firstTask.priority).toBe('high');
    expect(firstTask.estimatedEffort).toBe('medium');
    expect(firstTask.category).toBe('development');

    expect(secondTask.title).toBe('Design Database Schema');
    expect(secondTask.priority).toBe('high');
    expect(secondTask.estimatedEffort).toBe('small');
    expect(secondTask.category).toBe('planning');

    expect(taskData.uiElements).toBeDefined();

    console.log('[test] Task structure verified');

    // Step 11: Wait for END message
    await waitForMessageCount(taskConversation.id, 4, MessageStatus.Completed);

    const finalMessages = await prisma.db.message.findMany({
      where: { conversationId: taskConversation.id },
      orderBy: { createdAt: 'asc' },
    });

    const endMessage = finalMessages.find(
      (msg: Message) =>
        msg.type === MessageType.System &&
        typeof (msg.data as { response?: unknown })?.response === 'string' &&
        (msg.data as { response: string }).response.includes(
          'Task generation is complete',
        ),
    );

    expect(endMessage).toBeDefined();
    expect(endMessage?.status).toBe(MessageStatus.Completed);

    console.log('[test] END message confirmed');

    // Step 12: Verify flow completion
    const completedConversation = await prisma.db.conversation.findUnique({
      where: { id: taskConversation.id },
    });

    expect(completedConversation).toBeDefined();
    expect(completedConversation?.status).toBe('COMPLETED');

    console.log('[test] Flow completed successfully', {
      conversationId: taskConversation.id,
      status: completedConversation?.status,
      totalMessages: finalMessages.length,
    });

    // Cleanup
    llmClientService.callStructured = originalCallStructured;
  }, 60000);
});
