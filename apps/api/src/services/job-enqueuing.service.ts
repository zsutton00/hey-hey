import { ProjectAccessService } from '../auth/services/project-access.service';
import { ForbiddenException } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { ExecutionContext } from 'src/types/execution-context';
import { DomainEventPublisher } from '../core/events/domain-event-publisher';
import {
  EventContextManager,
  WithEventContext,
} from '../core/events/observable-event.context';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../core/events/tokens';
import {
  EVENT_TYPES,
  JOB_CHANNELS,
  JOB_TYPES,
  JobType,
  QueueName,
  QueueStats,
} from '../core/events/types/event.types';
import {
  IQueueService,
  QueueJob,
  QueueJobOptions,
} from '../core/queue/interfaces/queue.interface';
import { QUEUE_SERVICE_TOKEN } from '../core/queue/queue.module';
import { MessageId, OrganizationId } from '../types';
import {
  ConversationNode,
  FlowContext,
  FlowUserMessage,
} from '../types/flow-internal.types';
import { ContextAwareLogger } from 'src/core/logging/context-aware-logger.service';
import {
  AgentWorkflowJobData,
  ArtifactGenerationJobData,
  FlowNodeJobData,
  IJobEnqueuer,
  IntegrationJobData,
  IntegrationTestJobData,
} from './interfaces/job-enqueuer.interface';
import { PayloadType } from 'src/generated';

const enqueueingServiceSet = new Set();

/**
 * Lightweight job enqueuing service.
 * Only handles putting jobs in Redis queues - no processing or event handling.
 */
@Injectable()
export class JobEnqueueingService implements IJobEnqueuer {
  private readonly logger = ContextAwareLogger.createServiceLogger(
    JobEnqueueingService.name,
  );
  private readonly maxAttempts: number;

  constructor(
    private readonly projectAccess: ProjectAccessService,
    @Inject(QUEUE_SERVICE_TOKEN) private queueService: IQueueService,
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private eventPublisher: DomainEventPublisher,
  ) {
    enqueueingServiceSet.add(this);
    if (process.env.NODE_ENV !== 'test' && enqueueingServiceSet.size > 1) {
      throw new Error(
        `Duplicate JobEnqueueingService instance detected (count: ${enqueueingServiceSet.size}). ` +
          'This service must be a singleton. Check module imports to prevent multiple instantiations.',
      );
    }
    this.logger.log('Job Enqueuing Service initialized (lightweight)', {
      count: enqueueingServiceSet.size,
    });
    this.maxAttempts = parseInt(process.env.JOB_MAX_ATTEMPTS ?? '1', 10) || 1;
  }

  /**
   * Queue an artifact generation job
   */
  @WithEventContext('JobEnqueringService', 'queueArtifactGeneration')
  async queueArtifactGeneration(
    data: ArtifactGenerationJobData,
    context: ExecutionContext,
    options?: Partial<QueueJobOptions>,
  ): Promise<QueueJob> {
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    if (currentContext) {
      currentContext.organizationId = context.organizationId;
      currentContext.projectId = context.projectId;
      currentContext.workflowId = context.workflowId;
      currentContext.conversationId = context.conversationId;
      currentContext.messageId = context.messageId;
    }

    this.logger.log('Enqueuing artifact generation job', {
      projectId: context.projectId,
      organizationId: context.organizationId,
    });

    const jobOptions: QueueJobOptions = {
      ...context, // Spread all ExecutionContext properties
      priority: options?.priority || 1,
      maxAttempts: options?.maxAttempts || this.maxAttempts,
      ...options,
    };

    const job = await this.queueService.addJob(
      JOB_CHANNELS.ARTIFACTS,
      JOB_TYPES.ARTIFACTS.GENERATE,
      data,
      jobOptions,
    );

    // Publish job created event
    await this.publishJobCreatedEvent<ExecutionContext>({
      queueName: JOB_CHANNELS.ARTIFACTS,
      jobId: job.id,
      jobType: JOB_TYPES.ARTIFACTS.GENERATE,
      context,
    });

    return job;
  }

  /**
   * Queue an agent workflow job
   */
  @WithEventContext('JobEnqueringService', 'queueAgentWorkflow')
  async queueAgentWorkflow(
    data: AgentWorkflowJobData,
    context: ExecutionContext,
    options?: Partial<QueueJobOptions>,
  ): Promise<QueueJob> {
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    if (currentContext) {
      currentContext.organizationId = context.organizationId;
      currentContext.projectId = context.projectId;
      currentContext.workflowId = context.workflowId;
      currentContext.conversationId = context.conversationId;
      currentContext.messageId = context.messageId;
    }

    this.logger.log('Enqueuing agent workflow job', {
      agentId: data.agentId,
      nodeId: data.nodeId,
      projectId: context.projectId,
      organizationId: context.organizationId,
      requestId: context.requestId,
    });

    const jobOptions: QueueJobOptions = {
      ...context, // Spread all ExecutionContext properties
      priority: options?.priority || 2,
      maxAttempts: options?.maxAttempts || this.maxAttempts,
      ...options,
    };

    const job = await this.queueService.addJob(
      JOB_CHANNELS.AGENT,
      JOB_TYPES.AGENT.EXECUTE,
      data,
      jobOptions,
    );

    // Publish job created event
    await this.publishJobCreatedEvent<ExecutionContext>({
      queueName: JOB_CHANNELS.AGENT,
      jobId: job.id,
      jobType: JOB_TYPES.AGENT.EXECUTE,
      context,
    });

    return job;
  }

  /**
   * Get basic job information
   */
  async getJob(queueName: QueueName, jobId: string): Promise<QueueJob> {
    return this.queueService.getJob(queueName, jobId);
  }

  /**
   * Queue an integration sync job
   */
  @WithEventContext('JobEnqueringService', 'queueIntegrationSync')
  async queueIntegrationSync(
    data: IntegrationJobData,
    context: ExecutionContext,
    options?: Partial<QueueJobOptions>,
  ): Promise<QueueJob> {
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    if (currentContext) {
      currentContext.organizationId = context.organizationId;
      currentContext.projectId = context.projectId;
    }

    this.logger.log('Enqueuing integration sync job', {
      integrationId: data.integrationId,
      integrationType: data.integrationType,
      organizationId: context.organizationId,
    });

    const jobOptions: QueueJobOptions = {
      ...context,
      priority: options?.priority || 3,
      maxAttempts: options?.maxAttempts || this.maxAttempts,
      ...options,
    };

    const job = await this.queueService.addJob(
      JOB_CHANNELS.INTEGRATION,
      JOB_TYPES.INTEGRATION.SYNC,
      data,
      jobOptions,
    );

    await this.publishJobCreatedEvent<ExecutionContext>({
      queueName: JOB_CHANNELS.INTEGRATION,
      jobId: job.id,
      jobType: JOB_TYPES.INTEGRATION.SYNC,
      context,
    });

    return job;
  }

  /**
   * Queue an integration connection test job
   */
  @WithEventContext('JobEnqueringService', 'queueIntegrationTest')
  async queueIntegrationConnectionTest(
    data: IntegrationTestJobData,
    context: ExecutionContext,
    options?: Partial<QueueJobOptions>,
  ): Promise<QueueJob> {
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    if (currentContext) {
      currentContext.organizationId = context.organizationId;
      currentContext.projectId = context.projectId;
    }

    this.logger.log('Enqueuing integration connection test job', {
      integrationId: data.integrationId,
      organizationId: context.organizationId,
    });

    const jobOptions: QueueJobOptions = {
      ...context,
      priority: options?.priority || 4, // Higher priority for connection tests
      maxAttempts: options?.maxAttempts || this.maxAttempts,
      ...options,
    };

    const job = await this.queueService.addJob(
      JOB_CHANNELS.INTEGRATION,
      JOB_TYPES.INTEGRATION.TEST_CONNECTION,
      data,
      jobOptions,
    );

    await this.publishJobCreatedEvent<ExecutionContext>({
      queueName: JOB_CHANNELS.INTEGRATION,
      jobId: job.id,
      jobType: JOB_TYPES.INTEGRATION.TEST_CONNECTION,
      context,
    });

    return job;
  }

  /**
   * Queue a flow node execution job
   */
  async queueFlowNodeExecution(
    data: {
      node: ConversationNode;
      context: FlowContext;
      messageId: MessageId;
      userMessage?: FlowUserMessage;
    },
    executionContext: ExecutionContext,
    options: Partial<QueueJobOptions> = {},
  ): Promise<QueueJob> {
    const jobData: FlowNodeJobData = {
      flowId: data.context.flowId,
      nodeId: data.node.id,
      context: data.context,
      userMessage: data.userMessage,
      messageId: data.messageId,
    };

    const jobOptions: QueueJobOptions = {
      organizationId: executionContext.organizationId,
      projectId: executionContext.projectId,
      requestId: executionContext.requestId,
      workflowId: executionContext.workflowId,
      conversationId: executionContext.conversationId,
      userId: executionContext.userId,
      messageId: executionContext.messageId,
      userMessage: executionContext.userMessage,
      nodeId: data.node?.id,
      priority: 1,
      maxAttempts: 5,
      delay: 0,
      ...options,
    };

    const job = await this.queueService.addJob(
      JOB_CHANNELS.FLOW_NODE,
      JOB_TYPES.FLOW_NODE.EXECUTE,
      jobData,
      jobOptions,
    );

    await this.publishJobCreatedEvent<ExecutionContext>({
      queueName: JOB_CHANNELS.FLOW_NODE,
      jobId: job.id,
      jobType: JOB_TYPES.FLOW_NODE.EXECUTE,
      context: executionContext,
    });

    return job;
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(_organizationId: OrganizationId): Promise<{
    artifacts: QueueStats;
    llm: QueueStats;
    agent: QueueStats;
    integration: QueueStats;
    flowNode: QueueStats;
    nonInteractiveFlowNode: QueueStats;
  }> {
    // TODO: Implement queue stats when available in IQueueService
    return {
      artifacts: { waiting: 0, active: 0, completed: 0, failed: 0 },
      llm: { waiting: 0, active: 0, completed: 0, failed: 0 },
      agent: { waiting: 0, active: 0, completed: 0, failed: 0 },
      integration: { waiting: 0, active: 0, completed: 0, failed: 0 },
      flowNode: { waiting: 0, active: 0, completed: 0, failed: 0 },
      nonInteractiveFlowNode: {
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
      },
    };
  }

  /**
   * Queue a non-interactive flow node execution job
   */
  async queueNonInteractiveFlowNodeExecution(
    data: {
      flowId: string;
      nodeId: string;
      context: FlowContext;
      responseSchemaKey?: string;
      nodeInput?: Record<string, unknown>;
    },
    executionContext: ExecutionContext,
    options: Partial<QueueJobOptions> = {},
  ): Promise<QueueJob> {
    const jobData = {
      flowId: data.flowId,
      nodeId: data.nodeId,
      context: data.context,
      responseSchemaKey: data.responseSchemaKey,
      nodeInput: data.nodeInput,
    };

    const jobOptions: QueueJobOptions = {
      organizationId: executionContext.organizationId,
      projectId: executionContext.projectId,
      requestId: executionContext.requestId,
      workflowId: executionContext.workflowId,
      conversationId: executionContext.conversationId,
      userId: executionContext.userId,
      nodeId: data.nodeId,
      priority: 2,
      maxAttempts: 3,
      delay: 0,
      ...options,
    };

    const job = await this.queueService.addJob(
      JOB_CHANNELS.NON_INTERACTIVE_FLOW_NODE,
      JOB_TYPES.NON_INTERACTIVE_FLOW_NODE.EXECUTE,
      jobData,
      jobOptions,
    );

    await this.publishJobCreatedEvent<ExecutionContext>({
      queueName: JOB_CHANNELS.NON_INTERACTIVE_FLOW_NODE,
      jobId: job.id,
      jobType: JOB_TYPES.NON_INTERACTIVE_FLOW_NODE.EXECUTE,
      context: executionContext,
    });

    return job;
  }

  /**
   * Retry a failed job
   */
  async retryJob(
    queueName: QueueName,
    jobId: string,
    organizationId: OrganizationId,
    userId: string,
  ): Promise<void> {
    const job = await this.queueService.getJob(queueName, jobId);
    if (job.organizationId !== organizationId) throw new ForbiddenException();
    await this.projectAccess.assertProject(
      userId,
      organizationId,
      job.projectId,
    );
    await this.queueService.retryJob(queueName, jobId);
    this.logger.log(`Retried job ${jobId} in queue ${queueName}`);
  }

  /**
   * Publish job created event
   */
  private async publishJobCreatedEvent<T extends ExecutionContext>({
    queueName,
    jobId,
    jobType,
    error,
    context,
  }: {
    queueName: QueueName;
    jobId: string;
    jobType: JobType;
    error?: string;
    context: T;
  }): Promise<void> {
    this.logger.debug(`publishing job created event for job ${jobId}`);
    await this.eventPublisher.publish({
      type: EVENT_TYPES.QUEUE.JOB_CREATED,
      aggregateId: jobId,
      payload: {
        payloadType: PayloadType.QueueJob,
        type: EVENT_TYPES.QUEUE.JOB_CREATED,
        queueName,
        jobType,
        status: 'waiting' as const,
        id: jobId,
        error,
        ...context,
      },
    });
  }
}
