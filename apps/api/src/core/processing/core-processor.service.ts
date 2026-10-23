import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';

import {
  AgentCompleteEvent,
  AgentErrorEvent,
  AgentProgressEvent,
  AgentRequestEvent,
  ArtifactGenerationRequestedEvent,
  GitHubWebhookAcceptedEvent,
  isGitHubWebhookEvents,
  isAgentSessionCreatedEvent,
  isAgentSessionDeletedEvent,
  AgentSessionStatusChangedEvent,
  isSystemNotificationEvent,
  ReportCreatedEvent,
  SystemNotificationEvent,
  isMessageDeletedEvent,
  isAgentSessionStatusChangedEvent,
  isConversationCreatedEvent,
  isConversationDeletedEvent,
  isConversationStatusChangedEvent,
  isConversationUpdatedEvent,
  isProjectStatusChangedEvent,
  isProjectDeletedEvent,
  isProjectUpdatedEvent,
  FlowNodeCompleteEvent,
  isDesignDocArchivedEvent,
  isDesignDocCreatedEvent,
  isDesignDocRestoredEvent,
  isDesignDocStatusChangedEvent,
  isDesignDocUpdatedEvent,
  isInitiativeArchivedEvent,
  isInitiativeCreatedEvent,
  isInitiativeStatusChangedEvent,
  isInitiativeUpdatedEvent,
  isServiceArchivedEvent,
  isServiceCreatedEvent,
  isServiceUpdatedEvent,
  isTaskArchivedEvent,
  isTaskCreatedEvent,
  isTaskStatusChangedEvent,
  isTaskUpdatedEvent,
  isReportCreatedEvent,
  LlmCompleteEvent,
  LlmProgressEvent,
  LlmRequestEvent,
  MessageCreatedEvent,
  MessageUpdatedEvent,
  QueueEvent,
} from 'src/core/events/types/domain-events';
import { EntityType } from '@prisma/client';
import { EventEnvelope } from 'src/core/events/types/event-envelope';
import {
  FlowNodeQueueJob,
  NonInteractiveFlowNodeQueueJob,
} from 'src/services/interfaces/job-enqueuer.interface';
import { ConversationStatus } from 'src/generated/model/conversationStatus';
import { OrganizationId, PlanId } from 'src/types';
import { errorToLoggable } from 'src/utils/logging.util';
import { DomainEventPublisher } from '../events/domain-event-publisher';
import { EventRouter } from '../events/event-router';
import {
  EventContextManager,
  WithWorkflowContext,
} from '../events/observable-event.context';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../events/tokens';
import {
  EVENT_TYPES,
  JOB_CHANNELS,
  JOB_TYPES,
  QueueName,
  ServiceEventType,
} from '../events/types/event.types';
import { ContextAwareLogger } from '../logging/context-aware-logger.service';
import {
  AgentQueueJob,
  IQueueService,
  QueueJob,
} from '../queue/interfaces/queue.interface';
import { QUEUE_SERVICE_TOKEN } from '../queue/queue.module';
import { AgentProcessor } from './agent-processor.service';
import { ArtifactProcessor } from './artifact-processor.service';
import { EntityLifecycleProcessor } from './entity-lifecycle-processor.service';
import { FlowNodeProcessor } from './flow-node-processor.service';
import { LlmProcessor } from './llm-processor.service';
import { MessageProcessor } from './message-processor.service';
import { NonInteractiveFlowNodeProcessor } from './non-interactive-flow-node-processor.service';
import { NotificationGenerationProcessor } from './notification-generation-processor.service';
import { ArtifactGenerationJobData } from './types';
import { MentionRelationService } from 'src/services/mentions/mention-relation.service';
import { NotificationService } from 'src/services/notifications/notification.service';
import { AgentSessionService } from 'src/services/agent-session.service';
import { ReportService } from 'src/services/reports/report.service';
import { ProjectReportSessionOutcomeListener } from 'src/services/project-reports/project-report-session-outcome.listener';
import { SystemMessageData, UIElement } from 'src/generated';

/**
 * Job Processor handles the actual processing of jobs and related events.
 * This service should only be initialized in the main application context,
 * not in the worker context to avoid duplication.
 */

const CoreProcessorSet = new Set<CoreProcessor>();

@Injectable()
export class CoreProcessor implements OnModuleInit {
  private readonly logger: ContextAwareLogger =
    ContextAwareLogger.createServiceLogger(CoreProcessor.name);
  // Redis connection is managed by RedisService

  constructor(
    @Inject(QUEUE_SERVICE_TOKEN) private queueService: IQueueService,
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    _eventPublisher: DomainEventPublisher,
    private messageProcessor: MessageProcessor,
    private artifactProcessor: ArtifactProcessor,
    private llmProcessor: LlmProcessor,
    private agentProcessor: AgentProcessor,
    private flowNodeProcessor: FlowNodeProcessor,
    private entityLifecycleProcessor: EntityLifecycleProcessor,
    private notificationGenerationProcessor: NotificationGenerationProcessor,
    private mentionRelationService: MentionRelationService,
    private nonInteractiveFlowNodeProcessor: NonInteractiveFlowNodeProcessor,
    private agentSessionService: AgentSessionService,
    private reportService: ReportService,
    @Optional() private eventRouter?: EventRouter,
    @Optional() private notificationService?: NotificationService,
    @Optional()
    private projectReportSessionOutcome?: ProjectReportSessionOutcomeListener,
  ) {
    if (process.env.NODE_ENV !== 'test') {
      CoreProcessorSet.add(this);
      if (CoreProcessorSet.size > 1) {
        throw new Error(
          'Duplicate CoreProcessor instance detected. This service must be a singleton. Check module imports to prevent multiple instantiations.',
        );
      }
    }

    this.logger.log('CoreProcessor initialized', {
      count: CoreProcessorSet.size,
    });
  }

  async onModuleInit() {
    this.setupJobProcessors();
    await this.setupEventListeners();
    this.logger.log('Job Service initialized ');
  }

  private setupJobProcessors(): void {
    // Process artifact generation jobs (existing)
    this.queueService.addProcessor(
      JOB_CHANNELS.ARTIFACTS,
      JOB_TYPES.ARTIFACTS.GENERATE,
      async (job) => {
        await this.artifactProcessor.processArtifactGeneration(
          job as QueueJob<ArtifactGenerationJobData>,
        );
      },
    );

    // Flow node processor
    this.queueService.addProcessor(
      JOB_CHANNELS.FLOW_NODE,
      JOB_TYPES.FLOW_NODE.EXECUTE,
      async (job) => {
        this.logger.debug('Processing flow node job', job);
        await this.flowNodeProcessor.processFlowNode(job as FlowNodeQueueJob);
      },
    );

    // Non-interactive flow node processor
    this.queueService.addProcessor(
      JOB_CHANNELS.NON_INTERACTIVE_FLOW_NODE,
      JOB_TYPES.NON_INTERACTIVE_FLOW_NODE.EXECUTE,
      async (job) => {
        this.logger.debug('Processing non-interactive flow node job', job);
        await this.nonInteractiveFlowNodeProcessor.processNonInteractiveFlowNode(
          job as NonInteractiveFlowNodeQueueJob,
        );
      },
    );

    // Agent processor
    this.queueService.addProcessor(
      JOB_CHANNELS.AGENT,
      JOB_TYPES.AGENT.EXECUTE,
      async (job) => {
        this.logger.debug('Processing agent job', job);
        await this.agentProcessor.processAgentWorkflow(job as AgentQueueJob);
      },
    );

    this.logger.log(
      'Job processors configured with scalable LLM processing, agents, and flow nodes',
    );
  }
  // =============================================
  // Job Lifecycle Events & UI Integration
  // =============================================

  private async setupEventListeners(): Promise<void> {
    const eventRouter = this.eventRouter;
    if (!eventRouter) {
      // Fail fast – without EventRouter we would silently miss domain events
      throw new Error('JobService requires EventRouter but none was provided');
    }

    // Helper that wraps a handler in a child EventContext so that downstream
    // code can rely on `causationId` & friends without repeating boiler-plate.
    const withChildContext = <E extends EventEnvelope>(
      fn: (env: E) => Promise<void> | void,
    ) => {
      return async (env: E) => {
        const ctxMgr = EventContextManager.getInstance();
        const parentId = env.event.aggregateId;
        const childCtx = ctxMgr.createChildContext(parentId, {
          sourceService: 'JobService',
          sourceMethod: 'event-handler',
        });
        await ctxMgr.runWithContext(childCtx, async () => {
          try {
            await fn(env);
          } catch (err) {
            this.logger.error(
              `JobService event handler threw for ${env.event.type}`,
              err,
            );
          }
        });
      };
    };

    // Map<eventType, handler> – easy to extend without touching the control flow.
    const registrations: Array<
      [ServiceEventType, (env: EventEnvelope) => Promise<void> | void]
    > = [
      [
        EVENT_TYPES.QUEUE.JOB_CREATED,
        (env) => this.onQueueJobCreated(env.event as QueueEvent),
      ],

      [
        EVENT_TYPES.QUEUE.JOB_FAILED,
        (env) => this.onQueueJobFailed(env.event as QueueEvent),
      ],
      [
        EVENT_TYPES.LLM.REQUEST,
        (env) =>
          this.llmProcessor.handleLLMRequestEvent(env.event as LlmRequestEvent),
      ],
      [
        EVENT_TYPES.LLM.PROGRESS,
        (env) =>
          this.llmProcessor.updateSystemMessageWithProgress(
            env.event as LlmProgressEvent,
          ),
      ],
      [
        EVENT_TYPES.FLOW_NODE.COMPLETE,
        async (env) => {
          const event = env.event as FlowNodeCompleteEvent;
          // Handle LLM completion in LlmProcessor
          await this.messageProcessor.handleFlowNodeCompletedEvent(event);
        },
      ],
      [
        EVENT_TYPES.LLM.COMPLETE,
        async (env) => {
          const event = env.event as LlmCompleteEvent;
          // Handle LLM completion in LlmProcessor
          await this.llmProcessor.handleLLMCompletionEvent(event);
        },
      ],
      [
        EVENT_TYPES.AGENT.REQUEST,
        (env) =>
          this.agentProcessor.handleAgentRequestEvent(
            env.event as AgentRequestEvent,
          ),
      ],
      [
        EVENT_TYPES.AGENT.PROGRESS,
        (env) =>
          this.agentProcessor.handleAgentProgressEvent(
            env.event as AgentProgressEvent,
          ),
      ],
      [
        EVENT_TYPES.AGENT.COMPLETE,
        async (env) => {
          const event = env.event as AgentCompleteEvent;
          // Handle agent completion in AgentProcessor
          await this.agentProcessor.handleAgentCompletionEvent(event);
        },
      ],
      [
        EVENT_TYPES.AGENT.ERROR,
        async (env) => {
          const event = env.event as AgentErrorEvent;
          // Handle agent errors - just log for now, could add more specific handling later
          this.logger.error('Agent execution error', {
            requestId: event.payload.requestId,
            error: event.payload.error,
            nodeId: event.payload.flowConfig?.nodeId,
          });
        },
      ],
      [
        EVENT_TYPES.MESSAGE.CREATED,
        async (env) => {
          const event = env.event as MessageCreatedEvent;

          // Historical copies populate projections without executing replies,
          // creating extra artifacts or sending notifications.
          if (env.headers?.templateClone === true) {
            await this.entityLifecycleProcessor.handleMessageCreated({
              organizationId: event.payload.organizationId,
              messageId: event.aggregateId,
              type: event.payload.message.type,
              projectId: event.payload.projectId,
              shouldProcess: event.payload.message.shouldProcess,
            });
            return;
          }

          // Execute message processing first to establish workflow context
          // This ensures proper signal delivery before artifact processing
          try {
            await this.messageProcessor.handleMessageCreatedEvent(event);
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : errorToLoggable(error);
            this.logger.error(
              'MESSAGE_PROCESSOR failed, continuing with artifact processing',
              {
                messageId: event.aggregateId,
                error: errorMessage,
              },
            );
          }

          // Execute artifact processing after message processing
          // This prevents database conflicts and ensures proper transaction ordering
          try {
            await this.artifactProcessor.handleUserMessageCreated(event);
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : errorToLoggable(error);
            this.logger.error('ARTIFACT_PROCESSOR failed', {
              messageId: event.aggregateId,
              error: errorMessage,
            });
            // Re-throw artifact processing errors as they're critical for data integrity
            throw error;
          }

          try {
            await this.mentionRelationService.createRelationsForMessage(event);
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : errorToLoggable(error);
            this.logger.error('MENTION_RELATION_PROCESSOR failed', {
              messageId: event.aggregateId,
              error: errorMessage,
            });
          }

          const messageType = event.payload.message?.type;
          if (messageType === 'SYSTEM' || messageType === 'USER') {
            await this.entityLifecycleProcessor.handleMessageCreated({
              organizationId: event.payload.organizationId,
              messageId: event.aggregateId,
              type: messageType,
              projectId: event.payload.projectId,
              shouldProcess: event.payload.message?.shouldProcess,
            });
          } else {
            this.logger.warn(
              'MESSAGE.CREATED missing type; skipping registry upsert',
              { messageId: event.aggregateId },
            );
          }

          if (messageType === 'SYSTEM') {
            try {
              await this.notificationGenerationProcessor.handleSystemMessageCreatedEvent(
                event,
              );
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : errorToLoggable(error);
              this.logger.error(
                'NOTIFICATION_GENERATION_PROCESSOR failed for system message',
                {
                  messageId: event.aggregateId,
                  error: errorMessage,
                },
              );
            }

            // SESSION_MONITOR fans out independently of the
            // triggerNotification-gated SYSTEM_MESSAGE branch above —
            // the outcome carried on the message body IS the trigger.
            try {
              await this.notificationGenerationProcessor.handleSessionMonitorMessageEvent(
                event,
              );
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : errorToLoggable(error);
              this.logger.error(
                'NOTIFICATION_GENERATION_PROCESSOR failed for session monitor message',
                {
                  messageId: event.aggregateId,
                  error: errorMessage,
                },
              );
            }
          }
        },
      ],
      [
        EVENT_TYPES.MESSAGE.UPDATED,
        async (env) => {
          const event = env.event as MessageUpdatedEvent;

          this.logger.log('EVENT_TYPES.MESSAGE.UPDATED', {
            workflowId: event.payload.workflowId,
          });

          await this.messageProcessor.advanceContentUpdatedAtOnContentChange(
            event,
          );

          // Get the message type to determine which handler to use
          const messageType = await this.messageProcessor.getMessageType(
            event.aggregateId,
            event.payload.organizationId,
          );

          if (messageType === 'USER') {
            await this.messageProcessor.handleUserMessageUpdatedEvent(event);
          } else if (messageType === 'SYSTEM') {
            await this.messageProcessor.handleSystemMessageUpdatedEvent(event);
          }
        },
      ],
      [
        EVENT_TYPES.MESSAGE.DELETED,
        async (env) => {
          if (!isMessageDeletedEvent(env.event)) {
            return;
          }
          const event = env.event;
          await this.entityLifecycleProcessor.handleMessageDeleted({
            organizationId: event.payload.organizationId,
            messageId: event.aggregateId,
            deletedAt: event.payload.timestamp,
            projectId: event.payload.projectId,
          });
        },
      ],
      [
        EVENT_TYPES.CONVERSATION.CREATED,
        async (env) => {
          if (!isConversationCreatedEvent(env.event)) {
            return;
          }
          const event = env.event;
          const name =
            event.payload.conversationTitle ?? event.payload.workflowName;
          if (!name) {
            this.logger.warn(
              'CONVERSATION.CREATED missing conversationTitle/workflowName; skipping registry upsert',
              { conversationId: event.aggregateId },
            );
            return;
          }

          await this.entityLifecycleProcessor.handleConversationCreated({
            organizationId: event.payload.organizationId,
            conversationId: event.aggregateId,
            name,
          });
        },
      ],
      [
        EVENT_TYPES.CONVERSATION.UPDATED,
        async (env) => {
          if (!isConversationUpdatedEvent(env.event)) {
            return;
          }
          const event = env.event;
          const updatedName = event.payload.update?.title;
          if (!updatedName) {
            return;
          }

          await this.entityLifecycleProcessor.handleConversationUpdated({
            organizationId: event.payload.organizationId,
            conversationId: event.aggregateId,
            name: updatedName,
          });
        },
      ],
      [
        EVENT_TYPES.CONVERSATION.STATUS_CHANGED,
        async (env) => {
          if (!isConversationStatusChangedEvent(env.event)) {
            return;
          }
          const event = env.event;
          if (event.payload.newStatus !== ConversationStatus.Deleted) {
            return;
          }

          await this.entityLifecycleProcessor.handleConversationDeleted({
            organizationId: event.payload.organizationId,
            conversationId: event.aggregateId,
            deletedAt: event.payload.timestamp,
            projectId: event.payload.projectId,
          });
        },
      ],
      [
        EVENT_TYPES.CONVERSATION.DELETED,
        async (env) => {
          if (!isConversationDeletedEvent(env.event)) {
            return;
          }
          const event = env.event;
          await this.entityLifecycleProcessor.handleConversationDeleted({
            organizationId: event.payload.organizationId,
            conversationId: event.aggregateId,
            deletedAt: event.payload.timestamp,
            projectId: event.payload.projectId,
          });
        },
      ],
      [
        EVENT_TYPES.PROJECT.UPDATED,
        async (env) => {
          if (!isProjectUpdatedEvent(env.event)) {
            return;
          }
          const event = env.event;
          if (!event.payload.update) {
            this.logger.warn(
              'PROJECT.UPDATED missing update; skipping lifecycle handler',
              { projectId: event.aggregateId },
            );
            return;
          }

          await this.entityLifecycleProcessor.handleProjectUpdated({
            organizationId: event.payload.organizationId,
            projectId: event.aggregateId,
            update: event.payload.update,
          });
        },
      ],
      [
        EVENT_TYPES.PROJECT.STATUS_CHANGED,
        async (env) => {
          if (!isProjectStatusChangedEvent(env.event)) {
            return;
          }
          const event = env.event;
          if (!event.payload.status) {
            this.logger.warn(
              'PROJECT.STATUS_CHANGED missing status; skipping lifecycle handler',
              { projectId: event.aggregateId },
            );
            return;
          }

          await this.entityLifecycleProcessor.handleProjectStatusChanged({
            organizationId: event.payload.organizationId,
            projectId: event.aggregateId,
            status: event.payload.status,
          });
        },
      ],
      [
        EVENT_TYPES.PROJECT.DELETED,
        async (env) => {
          if (!isProjectDeletedEvent(env.event)) {
            return;
          }
          const event = env.event;
          await this.entityLifecycleProcessor.handleProjectDeleted({
            organizationId: event.payload.organizationId,
            projectId: event.aggregateId,
            deletedAt: event.payload.deletedAt,
          });
        },
      ],
      [
        EVENT_TYPES.ARTIFACT.GENERATION_REQUESTED,
        async (env) => {
          await this.artifactProcessor.handleArtifactGenerationRequestedEvent(
            env.event as ArtifactGenerationRequestedEvent,
          );
        },
      ],
      [
        EVENT_TYPES.TASK.CREATED,
        async (env) => {
          if (!isTaskCreatedEvent(env.event)) {
            return;
          }
          const payload = env.event.payload;
          const taskName = payload.task.name;
          if (!taskName) {
            this.logger.warn(
              'TASK.CREATED missing task name; skipping registry upsert',
              { taskId: env.event.aggregateId },
            );
            return;
          }
          await this.entityLifecycleProcessor.handleTaskCreated({
            organizationId: payload.organizationId,
            taskId: env.event.aggregateId,
            name: taskName,
            initiativeId: payload.initiativeId ?? null,
            projectId: payload.projectId,
          });
        },
      ],
      [
        EVENT_TYPES.TASK.UPDATED,
        async (env) => {
          if (!isTaskUpdatedEvent(env.event)) {
            return;
          }
          const event = env.event;
          const updatedName = event.payload.update?.name;
          await this.entityLifecycleProcessor.handleTaskUpdated({
            organizationId: event.payload.organizationId,
            taskId: event.aggregateId,
            name: updatedName,
            update: event.payload.update,
            previousData: event.payload.previousData,
            initiativeId: event.payload.initiativeId,
            projectId: event.payload.projectId,
          });
        },
      ],
      [
        EVENT_TYPES.TASK.ARCHIVED,
        async (env) => {
          if (!isTaskArchivedEvent(env.event)) {
            return;
          }
          const event = env.event;
          await this.entityLifecycleProcessor.handleTaskArchived({
            organizationId: event.payload.organizationId,
            taskId: event.aggregateId,
            archivedAt: event.payload.archivedAt,
            projectId: event.payload.projectId,
          });
          await this.reportService.deleteReportsAttachedToEntity({
            organizationId: event.payload.organizationId,
            entityId: event.aggregateId,
            entityType: EntityType.TASK,
            projectId: event.payload.projectId,
          });
        },
      ],
      [
        EVENT_TYPES.TASK.STATUS_CHANGED,
        async (env) => {
          if (!isTaskStatusChangedEvent(env.event)) {
            return;
          }
          const event = env.event;
          await this.entityLifecycleProcessor.handleTaskStatusChanged({
            organizationId: event.payload.organizationId,
            taskId: event.aggregateId,
            previousStatus: event.payload.previousStatus,
            newStatus: event.payload.newStatus,
            projectId: event.payload.projectId,
          });

          await this.notificationGenerationProcessor.handleTaskStatusChangedEvent(
            event,
          );
        },
      ],
      [
        EVENT_TYPES.AGENT_SESSION.CREATED,
        async (env) => {
          if (!isAgentSessionCreatedEvent(env.event)) {
            return;
          }
          await this.entityLifecycleProcessor.handleAgentSessionCreated(
            env.event,
          );
        },
      ],
      [
        EVENT_TYPES.AGENT_SESSION.STATUS_CHANGED,
        async (env) => {
          if (!isAgentSessionStatusChangedEvent(env.event)) {
            return;
          }
          const event = env.event;
          await this.entityLifecycleProcessor.handleAgentSessionRenamed({
            organizationId: event.payload.organizationId,
            agentSessionId: event.payload.agentSession.id,
            title: event.payload.agentSession.title,
          });
          await this.notificationGenerationProcessor.handleAgentSessionStatusChangedEvent(
            event as AgentSessionStatusChangedEvent,
          );
          if (event.payload.type === 'PROJECT_REPORT') {
            if (!this.projectReportSessionOutcome) {
              throw new Error(
                'Project report outcome listener is not configured',
              );
            }
            await this.projectReportSessionOutcome.handle(event);
          }
        },
      ],
      [
        EVENT_TYPES.AGENT_SESSION.DELETED,
        async (env) => {
          if (!isAgentSessionDeletedEvent(env.event)) {
            return;
          }
          const event = env.event;
          await this.entityLifecycleProcessor.handleAgentSessionDeleted({
            organizationId: event.payload.organizationId,
            agentSessionId: event.aggregateId,
            deletedAt: event.payload.timestamp,
            projectId: event.payload.projectId,
            title: event.payload.agentSession.title,
          });
          await this.reportService.deleteReportsAttachedToEntity({
            organizationId: event.payload.organizationId,
            entityId: event.aggregateId,
            entityType: EntityType.AGENT_SESSION,
            projectId: event.payload.projectId,
          });
        },
      ],
      [
        EVENT_TYPES.REPORT.CREATED,
        async (env) => {
          if (!isReportCreatedEvent(env.event)) {
            return;
          }
          await this.reportService.handleReportCreatedFileTouchIndex(
            env.event as ReportCreatedEvent,
          );
          await this.notificationGenerationProcessor.handleReportCreatedEvent(
            env.event as ReportCreatedEvent,
          );
        },
      ],
      [
        EVENT_TYPES.GITHUB_WEBHOOK.ACCEPTED,
        async (env) => {
          if (!isGitHubWebhookEvents(env.event)) {
            return;
          }
          await this.notificationGenerationProcessor.handleGitHubWebhookAcceptedEvent(
            env.event as GitHubWebhookAcceptedEvent,
          );
        },
      ],
      [
        EVENT_TYPES.SYSTEM.NOTIFICATION,
        async (env) => {
          if (!this.notificationService) {
            return;
          }
          if (!isSystemNotificationEvent(env.event)) {
            return;
          }
          await this.notificationService.handleSystemNotificationEvent(
            env.event as SystemNotificationEvent,
          );
        },
      ],
      [
        EVENT_TYPES.INITIATIVE.CREATED,
        async (env) => {
          if (!isInitiativeCreatedEvent(env.event)) {
            return;
          }
          const payload = env.event.payload;
          const name = payload.initiative.name;
          if (!name) {
            this.logger.warn(
              'INITIATIVE.CREATED missing name; skipping registry upsert',
              { initiativeId: env.event.aggregateId },
            );
            return;
          }
          await this.entityLifecycleProcessor.handleInitiativeCreated({
            organizationId: env.event.payload.organizationId,
            initiativeId: env.event.aggregateId,
            name,
          });
        },
      ],
      [
        EVENT_TYPES.INITIATIVE.UPDATED,
        async (env) => {
          if (!isInitiativeUpdatedEvent(env.event)) {
            return;
          }
          const event = env.event;
          const updatedName =
            event.payload.update?.name ??
            event.payload.changes?.find?.(
              (c: { field: string }) => c.field === 'name',
            )?.newValue;
          if (!updatedName) {
            return;
          }
          await this.entityLifecycleProcessor.handleInitiativeUpdated({
            organizationId: event.payload.organizationId,
            initiativeId: event.aggregateId,
            name: updatedName,
          });
        },
      ],
      [
        EVENT_TYPES.INITIATIVE.STATUS_CHANGED,
        async (env) => {
          if (!isInitiativeStatusChangedEvent(env.event)) {
            return;
          }
          const event = env.event;
          await this.entityLifecycleProcessor.handleInitiativeStatusChanged({
            organizationId: event.payload.organizationId,
            initiativeId: event.aggregateId,
            previousStatus: event.payload.previousStatus,
            newStatus: event.payload.newStatus,
            originatingProjectId: event.payload.originatingProjectId,
          });
        },
      ],
      [
        EVENT_TYPES.INITIATIVE.ARCHIVED,
        async (env) => {
          if (!isInitiativeArchivedEvent(env.event)) {
            return;
          }
          const event = env.event;
          await this.entityLifecycleProcessor.handleInitiativeArchived({
            organizationId: event.payload.organizationId,
            initiativeId: event.aggregateId,
            archivedAt: event.payload.archivedAt,
            projectId: event.payload.projectId,
          });
        },
      ],
      [
        EVENT_TYPES.DESIGN_DOC.CREATED,
        async (env) => {
          if (!isDesignDocCreatedEvent(env.event)) {
            return;
          }
          const event = env.event;
          const name = event.payload.designDoc.name;
          if (!name) {
            this.logger.warn(
              'DESIGN_DOC.CREATED missing name; skipping registry upsert',
              { designDocId: event.aggregateId },
            );
            return;
          }
          await this.entityLifecycleProcessor.handleDesignDocCreated({
            organizationId: event.payload.organizationId,
            designDocId: event.aggregateId,
            name,
          });
        },
      ],
      [
        EVENT_TYPES.DESIGN_DOC.UPDATED,
        async (env) => {
          if (!isDesignDocUpdatedEvent(env.event)) {
            return;
          }
          const event = env.event;
          const updatedName = event.payload.designDoc?.name;
          if (updatedName) {
            await this.entityLifecycleProcessor.handleDesignDocUpdated({
              organizationId: event.payload.organizationId,
              designDocId: event.aggregateId,
              name: updatedName,
            });
          } else {
            this.logger.warn(
              'DESIGN_DOC.UPDATED missing name; skipping registry upsert',
              { designDocId: event.aggregateId },
            );
          }
        },
      ],
      [
        EVENT_TYPES.DESIGN_DOC.STATUS_CHANGED,
        async (env) => {
          if (!isDesignDocStatusChangedEvent(env.event)) {
            return;
          }
          const event = env.event;
          await this.entityLifecycleProcessor.handleDesignDocStatusChanged({
            organizationId: event.payload.organizationId,
            designDocId: event.aggregateId,
            newStatus: event.payload.newStatus,
            originatingProjectId: event.payload.projectId,
          });
        },
      ],
      [
        EVENT_TYPES.DESIGN_DOC.ARCHIVED,
        async (env) => {
          if (!isDesignDocArchivedEvent(env.event)) {
            return;
          }
          const event = env.event;
          await this.entityLifecycleProcessor.handleDesignDocArchived({
            organizationId: event.payload.organizationId,
            designDocId: event.aggregateId,
            archivedAt: event.payload.timestamp,
            projectId: event.payload.projectId,
          });
        },
      ],
      [
        EVENT_TYPES.DESIGN_DOC.RESTORED,
        async (env) => {
          if (!isDesignDocRestoredEvent(env.event)) {
            return;
          }
          const event = env.event;
          const name = event.payload.designDoc?.name;
          await this.entityLifecycleProcessor.handleDesignDocRestored({
            organizationId: event.payload.organizationId,
            designDocId: event.aggregateId,
            name,
          });
        },
      ],
      [
        EVENT_TYPES.SERVICE.CREATED,
        async (env) => {
          if (!isServiceCreatedEvent(env.event)) {
            return;
          }
          const event = env.event;
          const name = event.payload.service.name;
          if (!name) {
            this.logger.warn(
              'SERVICE.CREATED missing name; skipping registry upsert',
              { serviceId: event.aggregateId },
            );
            return;
          }
          await this.entityLifecycleProcessor.handleServiceCreated({
            organizationId: event.payload.organizationId,
            serviceId: event.aggregateId,
            name,
          });
        },
      ],
      [
        EVENT_TYPES.SERVICE.UPDATED,
        async (env) => {
          if (!isServiceUpdatedEvent(env.event)) {
            return;
          }
          const event = env.event;
          const name = event.payload.service.name;
          if (!name) {
            this.logger.warn(
              'SERVICE.UPDATED missing name; skipping registry upsert',
              { serviceId: event.aggregateId },
            );
            return;
          }
          await this.entityLifecycleProcessor.handleServiceUpdated({
            organizationId: event.payload.organizationId,
            serviceId: event.aggregateId,
            name,
          });
        },
      ],
      [
        EVENT_TYPES.SERVICE.ARCHIVED,
        async (env) => {
          if (!isServiceArchivedEvent(env.event)) {
            return;
          }
          const event = env.event;
          await this.entityLifecycleProcessor.handleServiceArchived({
            organizationId: event.payload.organizationId,
            serviceId: event.aggregateId,
            name: event.payload.service.name,
            archivedAt: event.payload.service.archivedAt,
            projectId: event.payload.service.projectId,
          });
        },
      ],
    ];

    const subs = registrations.map(([type, handler]) =>
      eventRouter.on(type, withChildContext(handler)),
    );

    // Await all subscriptions – if any fail we crash the startup
    await Promise.all(subs);

    this.logger.log('Job event listeners configured (refactored)');
  }

  /* --------------------------------------------------------------------- */
  /*  Individual handler delegates – keep logic focused & testable          */
  /* --------------------------------------------------------------------- */

  private async onQueueJobCreated(event: QueueEvent): Promise<void> {
    // Just log for monitoring, no message creation
    this.logger.debug('Job created', {
      queueName: event.payload.queueName,
      jobType: event.payload.jobType,
      jobId: event.aggregateId,
    });
  }

  private async onQueueJobFailed(event: QueueEvent): Promise<void> {
    if (event.payload.queueName === JOB_CHANNELS.LLM) {
      await this.llmProcessor.updateSystemMessageFromJobFailure(event);
    }
  }
  /**
   * Get job by id
   */
  @WithWorkflowContext((...args) => {
    const [queueName, jobId] = args as [QueueName, string];
    return {
      sourceService: 'CoreProcessor',
      sourceMethod: 'getJob',
      context: {},
      metadata: {
        operationType: 'getJob',
        queueName,
        jobId,
      },
    };
  })
  async getJob(queueName: QueueName, jobId: string): Promise<QueueJob> {
    return this.queueService.getJob(queueName, jobId);
  }

  /**
   * Get jobs for organization
   */
  @WithWorkflowContext((...args) => {
    const [organizationId, queueName, status, limit] = args as [
      OrganizationId,
      QueueName,
      'waiting' | 'active' | 'completed' | 'failed',
      number,
    ];
    return {
      sourceService: 'CoreProcessor',
      sourceMethod: 'getJobs',
      context: {
        organizationId,
      },
      metadata: {
        operationType: 'getJobs',
        queueName,
        status,
        limit,
      },
    };
  })
  async getJobs(
    organizationId: OrganizationId,
    queueName: QueueName,
    status: 'waiting' | 'active' | 'completed' | 'failed',
    limit = 10,
  ): Promise<QueueJob[]> {
    return this.queueService.getJobs(queueName, organizationId, status, limit);
  }
}
