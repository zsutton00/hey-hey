import { Client, WorkflowHandle } from '@temporalio/client';
import { PrismaClient } from '@prisma/client';
import {
  WorkflowId,
  ProjectId,
  OrganizationId,
  RequestId,
  ConversationId,
  UserId,
} from '../../src/types';
import {
  SystemMessageData,
  SystemMessageResponseType,
} from '../../src/generated';
import { FlowUserMessage } from '../../src/types/flow-internal.types';
import { WorkflowSignals } from '../../src/utils/workflow-signals.util';
import { DomainEventPublisher } from '../../src/core/events/domain-event-publisher';
import { EVENT_TYPES } from '../../src/core/events/types/event.types';
import { IQueueService } from '../../src/core/queue/interfaces/queue.interface';

export interface TestContext {
  prisma: PrismaClient;
  temporalClient: Client;
  eventPublisher: DomainEventPublisher;
  queueService: IQueueService;
}

/**
 * Sleep helper for waiting in tests
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Start a conversation workflow and wait for initial setup
 */
export async function startConversationWorkflow(
  context: TestContext,
  options: {
    workflowId: WorkflowId;
    projectId: ProjectId;
    organizationId: OrganizationId;
    userId?: UserId;
    flowId?: string;
  },
): Promise<WorkflowHandle> {
  const { temporalClient } = context;
  const {
    workflowId,
    projectId,
    organizationId,
    userId,
    flowId = 'onboarding',
  } = options;

  // Import at runtime to avoid circular dependencies
  const { conversationFlowWorkflow } = await import(
    '../../src/workflows/conversation-flow.workflow'
  );

  const handle = await temporalClient.workflow.start(conversationFlowWorkflow, {
    taskQueue: 'conversation-flow',
    workflowId,
    args: [
      {
        projectId,
        workflowId,
        organizationId,
        flowId,
        userId,
        initiatedBy: 'SYSTEM' as const,
        triggerEvent: 'CONVERSATION_STARTED',
        title: 'Test Conversation',
        workflowName: 'test',
      },
    ],
  });

  // Wait for workflow to initialize
  await sleep(1000);

  return handle;
}

/**
 * Wait for a message with specific status
 */
export async function waitForMessage(
  prisma: PrismaClient,
  conversationId: string,
  status: string,
  maxWaitMs: number = 5000,
): Promise<any> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const message = await prisma.message.findFirst({
      where: {
        conversationId,
        status,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (message) {
      return message;
    }

    await sleep(100);
  }

  throw new Error(`Timeout waiting for message with status ${status}`);
}

/**
 * Get all events of a specific type
 */
export async function getEvents(
  eventPublisher: DomainEventPublisher,
  eventType: string,
  aggregateId?: string,
): Promise<any[]> {
  // This would need to be implemented based on your event store
  // For now, returning mock implementation
  return [];
}
