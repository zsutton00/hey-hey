import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FlowExecutionStatus } from '@prisma/client';
import { InputJsonObject } from '@prisma/client/runtime/library';
import {
  addToServiceChain,
  enrichEventContext,
  trackProcessingTime,
} from '../../core/events/context-utils';
import { WithEventContext } from '../../core/events/observable-event.context';
import { InjectTemporalClient } from '../../prisma/temporal.module';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ConversationId,
  FlowExecutionId,
  MessageId,
  OrganizationId,
  ProjectId,
  RequestId,
  UserId,
  WorkflowId,
} from '../../types';
import {
  AgentHandoffNodeBase,
  ExternalAgentNodeBase,
  FlowContext,
  MutableContextHandle,
  NodeType,
} from '../../types/flow-internal.types';
import { ContextAwareLogger } from '../../core/logging/context-aware-logger.service';
import { SerializableWorkflowState } from '../../workflows/conversation-workflow-state';
import { WorkflowSignals } from 'src/utils/workflow-signals.util';
import {
  PromptTypeResponseDto,
  SystemMessageData,
  WorkflowName,
} from 'src/generated';
import { LocalPromptType } from 'src/generated/local';

type WorkflowState = PromptTypeResponseDto.WorkflowStateEnum;
const WorkflowState = PromptTypeResponseDto.WorkflowStateEnum;
import { Client } from '@temporalio/client';
import { ConversationService } from '../conversation.service';
import { ConversationWorkflowService } from './conversation-workflow.service';
import { WorkflowTypeRegistryService } from './workflow-type-registry.service';
import { hasUiElements } from 'src/utils/type-checks';
import { getWorkflowStatus } from '../../workflows/conversation-flow.workflow';
import { NodeExecutionService } from './node-execution.service';
import { PendingTriggerService } from './pending-trigger.service';

export interface CreateFlowExecutionDto {
  userId: UserId;
  flowId: string;
  organizationId: OrganizationId;
  projectId: ProjectId;
  conversationId?: ConversationId;
  entityType?: string;
  entityId?: string;
  currentNode?: string;
  totalNodes?: number;
  flowState?: SerializableWorkflowState;
  metadata?: Record<string, unknown>;
  resumable?: boolean;
}

export interface UpdateFlowStateDto {
  currentNode?: string;
  completedNodes?: number;
  flowState: SerializableWorkflowState;
  status?: FlowExecutionStatus;
  errorMessage?: string;
  errorCode?: string;
}

export interface SavedExecutionStateDto {
  id: string;
  flowId: string;
  status: FlowExecutionStatus;
  currentNode: string | null;
  flowState: SerializableWorkflowState | null;
  resumable: boolean;
  startedAt: Date;
  completedAt: Date | null;
}

@Injectable()
export class FlowExecutionService {
  private readonly logger = ContextAwareLogger.createServiceLogger(
    FlowExecutionService.name,
  );
  private readonly RESTART_GRACE_MINUTES: number;

  constructor(
    private readonly prisma: PrismaService,
    @InjectTemporalClient() private temporalClient: Client,
    @Inject(forwardRef(() => ConversationService))
    private readonly conversationService: ConversationService,
    @Inject(forwardRef(() => ConversationWorkflowService))
    private readonly conversationWorkflowService: ConversationWorkflowService,
    private readonly workflowTypeRegistry: WorkflowTypeRegistryService,
    private readonly config: ConfigService,
    private readonly nodeExecutionService: NodeExecutionService,
    private readonly pendingTriggerService: PendingTriggerService,
  ) {
    this.RESTART_GRACE_MINUTES =
      Number(this.config.get('WORKFLOW_RESTART_GRACE_MINUTES')) || 0;
  }

  /**
   * Create a new flow execution record
   */
  @WithEventContext('FlowExecutionService')
  async createFlowExecution(
    data: CreateFlowExecutionDto,
  ): Promise<{ id: FlowExecutionId }> {
    // Enrich context with flow execution creation metadata
    const creationStartTime = Date.now();
    enrichEventContext({
      flowId: data.flowId,
      entityType: data.entityType,
      entityId: data.entityId,
      creationStartTime,
      operationType: 'create',
    });

    // Add this service to the service call chain for tracing
    addToServiceChain('FlowExecutionService');

    this.logger.log('Creating flow execution', {
      flowId: data.flowId,
      conversationId: data.conversationId,
      entityType: data.entityType,
      entityId: data.entityId,
      userId: data.userId,
      organizationId: data.organizationId,
      projectId: data.projectId,
    });

    // Validate all foreign key relationships
    if (data.conversationId) {
      const conversation = await this.prisma.db.conversation.findUnique({
        where: { id: data.conversationId },
        select: { id: true },
      });

      if (!conversation) {
        throw new Error(
          `Conversation ${data.conversationId} not found when creating FlowExecution`,
        );
      }
    }

    // Validate user exists
    const user = await this.prisma.db.user.findUnique({
      where: { id: data.userId },
      select: { id: true },
    });

    if (!user) {
      throw new Error(
        `User ${data.userId} not found when creating FlowExecution`,
      );
    }

    // Validate organization exists
    const organization = await this.prisma.db.organization.findUnique({
      where: { id: data.organizationId },
      select: { id: true },
    });

    if (!organization) {
      throw new Error(
        `Organization ${data.organizationId} not found when creating FlowExecution`,
      );
    }

    // Validate project exists
    const project = await this.prisma.db.project.findUnique({
      where: { id: data.projectId },
      select: { id: true },
    });

    if (!project) {
      throw new Error(
        `Project ${data.projectId} not found when creating FlowExecution`,
      );
    }

    const execution = await this.prisma.db.flowExecution.create({
      data: {
        userId: data.userId,
        flowId: data.flowId,
        organizationId: data.organizationId,
        projectId: data.projectId,
        conversationId: data.conversationId || null,
        entityType: data.entityType || null,
        entityId: data.entityId || null,
        currentNode: data.currentNode,
        totalNodes: data.totalNodes,
        flowState: (data.flowState
          ? data.flowState
          : null) as unknown as InputJsonObject,
        ...(data.metadata
          ? { metadata: data.metadata as unknown as InputJsonObject }
          : {}),
        resumable: data.resumable ?? true,
        status: FlowExecutionStatus.STARTED,
      },
    });

    this.logger.log('Flow execution created', {
      executionId: execution.id,
      flowId: data.flowId,
    });

    // Track creation completion time and enrich context with results
    trackProcessingTime('creation', creationStartTime);
    enrichEventContext({
      executionId: execution.id,
      flowExecutionStatus: 'STARTED',
    });

    return { id: execution.id as FlowExecutionId };
  }

  /**
   * Update flow execution state
   */
  @WithEventContext('FlowExecutionService')
  async updateFlowState(
    executionId: string,
    organizationId: OrganizationId,
    data: UpdateFlowStateDto,
  ): Promise<void> {
    // Enrich context with flow state update metadata
    enrichEventContext({
      executionId,
      currentNode: data.currentNode,
      flowExecutionStatus: data.status || 'updating',
      operationType: 'update',
      hasError: !!(data.errorMessage || data.errorCode),
    });

    // Add this service to the service call chain for tracing
    addToServiceChain('FlowExecutionService');

    this.logger.debug('Updating flow state', {
      executionId,
      currentNode: data.currentNode,
      status: data.status,
    });

    await this.prisma.db.flowExecution.update({
      where: {
        id: executionId,
        organizationId, // Security: ensure org access
      },
      data: {
        version: { increment: 1 },
        ...(data.currentNode && { currentNode: data.currentNode }),
        ...(data.completedNodes !== undefined && {
          completedNodes: data.completedNodes,
        }),
        ...(data.flowState && { flowState: data.flowState }),
        ...(data.status && { status: data.status }),
        ...(data.errorMessage && { errorMessage: data.errorMessage }),
        ...(data.errorCode && { errorCode: data.errorCode }),
        ...(data.status === FlowExecutionStatus.COMPLETED && {
          completedAt: new Date(),
        }),
        ...(data.status === FlowExecutionStatus.PAUSED && {
          resumable: true,
        }),
      },
    });
  }

  /**
   * Find flow execution by ID
   */
  async findById(
    executionId: string,
    organizationId: OrganizationId,
  ): Promise<SavedExecutionStateDto | null> {
    const execution = await this.prisma.db.flowExecution.findFirst({
      where: {
        id: executionId,
        organizationId,
      },
    });

    if (!execution) {
      return null;
    }

    return {
      id: execution.id,
      flowId: execution.flowId,
      status: execution.status,
      currentNode: execution.currentNode,
      flowState: execution.flowState as unknown as SerializableWorkflowState,
      resumable: execution.resumable,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
    };
  }

  /**
   * Find flow execution by conversation ID
   */
  async findByConversation(
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ): Promise<SavedExecutionStateDto | null> {
    const execution = await this.prisma.db.flowExecution.findFirst({
      where: {
        conversationId,
        organizationId, // Security: ensure org access
      },
      orderBy: {
        startedAt: 'desc', // Get most recent execution
      },
    });

    if (!execution) {
      return null;
    }

    return {
      id: execution.id,
      flowId: execution.flowId,
      status: execution.status,
      currentNode: execution.currentNode,
      flowState: execution.flowState as unknown as SerializableWorkflowState,
      resumable: execution.resumable,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
    };
  }

  /**
   * Find latest resumable flow execution by entity
   */
  async findLatestResumableByEntity(
    entityType: string,
    entityId: string,
    organizationId: OrganizationId,
  ): Promise<{
    id: string;
    flowId: string;
    conversationId: string | null;
    status: FlowExecutionStatus;
    currentNode: string | null;
    flowState: FlowContext | null;
    startedAt: Date;
  } | null> {
    const execution = await this.prisma.db.flowExecution.findFirst({
      where: {
        entityType,
        entityId,
        organizationId, // Security: ensure org access
        resumable: true,
        status: {
          in: [FlowExecutionStatus.STARTED, FlowExecutionStatus.IN_PROGRESS],
        },
      },
      orderBy: {
        startedAt: 'desc', // Get most recent resumable execution
      },
    });

    if (!execution) {
      return null;
    }

    return {
      id: execution.id,
      flowId: execution.flowId,
      conversationId: execution.conversationId,
      status: execution.status,
      currentNode: execution.currentNode,
      flowState: execution.flowState as unknown as FlowContext,
      startedAt: execution.startedAt,
    };
  }

  /**
   * Mark flow execution as completed
   */
  async markCompleted(
    executionId: string,
    organizationId: OrganizationId,
    finalState?: FlowContext,
  ): Promise<void> {
    this.logger.log('Marking flow execution as completed', { executionId });

    await this.prisma.db.flowExecution.update({
      where: {
        id: executionId,
        organizationId, // Security: ensure org access
      },
      data: {
        version: { increment: 1 },
        status: FlowExecutionStatus.COMPLETED,
        completedAt: new Date(),
        ...(finalState && { flowState: finalState }),
      },
    });
  }

  /**
   * Mark flow execution as paused (workflow timed out waiting for user input).
   * The execution retains its saved flowState so it can be resumed later.
   */
  async markPaused(
    executionId: string,
    organizationId: OrganizationId,
  ): Promise<void> {
    this.logger.log('Marking flow execution as paused', { executionId });

    await this.prisma.db.flowExecution.update({
      where: {
        id: executionId,
        organizationId,
      },
      data: {
        version: { increment: 1 },
        status: FlowExecutionStatus.PAUSED,
        resumable: true,
      },
    });
  }

  /**
   * Find the latest resumable flow execution for a conversation.
   *
   * Matches both PAUSED (workflow timed out into pauseFlow with state saved)
   * and COMPLETED+resumable (Temporal workflow was wound down to save
   * resources after a half-hour pause-and-finish, but the conversation is
   * still drivable from the saved flow state). Both cases resume the same
   * way: claim the row, start a fresh Temporal workflow with isResuming, and
   * signal it with the user message.
   */
  async findPausedByConversation(
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ): Promise<SavedExecutionStateDto | null> {
    this.logger.log(
      '[findPausedByConversation] Searching for resumable execution',
      {
        conversationId,
        organizationId,
      },
    );

    const execution = await this.prisma.db.flowExecution.findFirst({
      where: {
        conversationId,
        organizationId,
        status: {
          in: [FlowExecutionStatus.PAUSED, FlowExecutionStatus.COMPLETED],
        },
        resumable: true,
      },
      orderBy: {
        startedAt: 'desc',
      },
    });

    if (!execution) {
      // Log what executions DO exist for this conversation to help diagnose
      const existingExecutions = await this.prisma.db.flowExecution.findMany({
        where: { conversationId, organizationId },
        select: { id: true, status: true, resumable: true, startedAt: true },
        orderBy: { startedAt: 'desc' },
        take: 3,
      });
      this.logger.warn(
        '[findPausedByConversation] No resumable execution found',
        {
          conversationId,
          organizationId,
          existingExecutions: existingExecutions.map((e) => ({
            id: e.id,
            status: e.status,
            resumable: e.resumable,
          })),
        },
      );
      return null;
    }

    this.logger.log('[findPausedByConversation] Found resumable execution', {
      executionId: execution.id,
      conversationId,
      status: execution.status,
      currentNode: execution.currentNode,
      hasFlowState: !!execution.flowState,
    });

    return {
      id: execution.id,
      flowId: execution.flowId,
      status: execution.status,
      currentNode: execution.currentNode,
      flowState: execution.flowState as unknown as SerializableWorkflowState,
      resumable: execution.resumable,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
    };
  }

  /**
   * Find the latest active+resumable flow execution for a conversation.
   *
   * "Active" here means the workflow can still be driven forward — either
   * running in Temporal (STARTED/IN_PROGRESS, blocked on a `condition()`),
   * persistently paused (PAUSED, e.g. after a user-wait timeout triggered
   * `pauseFlow`), or wound down to save resources after a long pause
   * (COMPLETED+resumable). All four states represent "a caller can still
   * drive this execution forward" — for COMPLETED+resumable, the signal-
   * path catches the inevitable `WorkflowNotFoundError` and falls through
   * to `attemptResumeFromPaused`, which spins up a fresh Temporal workflow
   * from the saved flow state.
   *
   * Use this for signal-bridging guards (e.g. EXTERNAL_AGENT completion)
   * where the caller needs to verify that a workflow exists on the
   * expected node before signaling. Use `findPausedByConversation` only
   * when specifically the timeout→resume case matters.
   */
  async findActiveByConversation(
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ): Promise<SavedExecutionStateDto | null> {
    this.logger.log(
      '[findActiveByConversation] Searching for active execution',
      {
        conversationId,
        organizationId,
      },
    );

    const execution = await this.prisma.db.flowExecution.findFirst({
      where: {
        conversationId,
        organizationId,
        resumable: true,
        status: {
          in: [
            FlowExecutionStatus.STARTED,
            FlowExecutionStatus.IN_PROGRESS,
            FlowExecutionStatus.PAUSED,
            FlowExecutionStatus.COMPLETED,
          ],
        },
      },
      orderBy: {
        startedAt: 'desc',
      },
    });

    if (!execution) {
      const existingExecutions = await this.prisma.db.flowExecution.findMany({
        where: { conversationId, organizationId },
        select: { id: true, status: true, resumable: true, startedAt: true },
        orderBy: { startedAt: 'desc' },
        take: 3,
      });
      this.logger.warn(
        '[findActiveByConversation] No active+resumable execution found',
        {
          conversationId,
          organizationId,
          existingExecutions: existingExecutions.map((e) => ({
            id: e.id,
            status: e.status,
            resumable: e.resumable,
          })),
        },
      );
      return null;
    }

    this.logger.log('[findActiveByConversation] Found active execution', {
      executionId: execution.id,
      conversationId,
      status: execution.status,
      currentNode: execution.currentNode,
      hasFlowState: !!execution.flowState,
    });

    return {
      id: execution.id,
      flowId: execution.flowId,
      status: execution.status,
      currentNode: execution.currentNode,
      flowState: execution.flowState as unknown as SerializableWorkflowState,
      resumable: execution.resumable,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
    };
  }

  /**
   * Atomically claim a resumable execution for resumption.
   * Uses optimistic locking: only transitions {PAUSED, COMPLETED} →
   * IN_PROGRESS if the execution is still in one of those terminal-but-
   * resumable states. COMPLETED+resumable arises when a long-paused
   * workflow was wound down to save Temporal resources; resuming it spins
   * up a fresh workflow from the saved flow state. Returns the execution
   * if claimed, null if another caller won the race or the execution
   * moved out of a resumable state.
   */
  async tryClaimPausedExecution(
    executionId: string,
    organizationId: OrganizationId,
  ): Promise<SavedExecutionStateDto | null> {
    try {
      const execution = await this.prisma.db.flowExecution.update({
        where: {
          id: executionId,
          organizationId,
          status: {
            in: [FlowExecutionStatus.PAUSED, FlowExecutionStatus.COMPLETED],
          },
        },
        data: {
          version: { increment: 1 },
          status: FlowExecutionStatus.IN_PROGRESS,
        },
      });

      return {
        id: execution.id,
        flowId: execution.flowId,
        status: execution.status,
        currentNode: execution.currentNode,
        flowState: execution.flowState as unknown as SerializableWorkflowState,
        resumable: execution.resumable,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
      };
    } catch {
      // Update failed — execution was not in a resumable state (another
      // caller won, or it transitioned to FAILED/CANCELLED).
      this.logger.debug(
        'tryClaimPausedExecution: execution not in a resumable state, claim lost',
        { executionId },
      );
      return null;
    }
  }

  /**
   * Mark flow execution as failed
   */
  async markFailed(
    executionId: string,
    organizationId: OrganizationId,
    errorMessage: string,
    errorCode?: string,
  ): Promise<void> {
    this.logger.error('Marking flow execution as failed', {
      executionId,
      errorMessage,
      errorCode,
    });

    await this.prisma.db.flowExecution.update({
      where: {
        id: executionId,
        organizationId, // Security: ensure org access
      },
      data: {
        version: { increment: 1 },
        status: FlowExecutionStatus.FAILED,
        errorMessage,
        errorCode,
        resumable: false, // Failed executions are not resumable
      },
    });
  }

  async sendNodeResponseToWorkflow(
    requestId: RequestId,
    workflowId: WorkflowId,
    systemMessageData: SystemMessageData,
    nextNodeId: string | null, // can be null if error
    errorHolding: boolean | undefined,
    tracker: MutableContextHandle<FlowContext>,
  ): Promise<void> {
    this.logger.log('[sendNodeResponseToWorkflow] starting', {
      requestId,
      workflowId,
      nextNodeId,
      errorHolding,
    });
    try {
      const workflowHandle = this.temporalClient.workflow.getHandle(workflowId);

      // Use dynamic signal name with workflowId to ensure proper isolation
      const signalName = WorkflowSignals.getLLMResponseSignalName(workflowId);

      // Debug what we're sending
      this.logger.debug('[sendNodeResponseToWorkflow] Preparing signal', {
        workflowId,
        signalName,
        requestId,
        responseDataType: typeof systemMessageData,
        responseDataKeys: systemMessageData
          ? Object.keys(systemMessageData)
          : [],
        hasDetectedIntent: systemMessageData
          ? 'detectedIntent' in systemMessageData
          : false,
        nextNodeId,
        systemMessageDataSample: JSON.stringify(systemMessageData).substring(
          0,
          200,
        ),
      });

      await workflowHandle.signal(signalName, {
        requestId,
        responseData: systemMessageData,
        nextNodeId,
        errorHolding,
        contextUpdates: tracker.getPatch(),
      });

      this.logger.log('[sendNodeResponseToWorkflow] Signal sent successfully', {
        workflowId,
        signalName,
        requestId,
        nextNodeId,
        payloadKeys: Object.keys({
          requestId,
          responseData: systemMessageData,
          nextNodeId,
        }),
      });
    } catch (error) {
      const errorName = (error as Error).name ?? 'unknown';
      const errorMessage = (error as Error).message ?? String(error);
      const errorConstructor = error?.constructor?.name ?? 'unknown';

      this.logger.warn('[sendNodeResponseToWorkflow] Signal failed', {
        requestId,
        workflowId,
        errorName,
        errorConstructor,
        errorMessage,
        nextNodeId,
      });

      const isWorkflowGone =
        errorName === 'WorkflowNotFoundError' ||
        errorMessage.includes('workflow execution already completed') ||
        errorMessage.includes('workflow not found');

      if (isWorkflowGone) {
        this.logger.log(
          '[sendNodeResponseToWorkflow] Workflow gone - attempting restart',
          {
            requestId,
            workflowId,
            errorName,
            errorConstructor,
          },
        );

        await this.restartMissingWorkflow(
          workflowId,
          systemMessageData,
          nextNodeId,
          tracker,
        );
        return;
      }

      this.logger.error(
        '[sendNodeResponseToWorkflow] Unexpected signal error',
        {
          error: errorMessage,
          errorName,
          errorConstructor,
          requestId,
          workflowId,
          nextNodeId,
        },
      );
      throw error;
    }
  }

  private async restartMissingWorkflow(
    workflowId: WorkflowId,
    systemMessageData: SystemMessageData,
    nextNodeId: string | null,
    tracker: MutableContextHandle<FlowContext>,
  ): Promise<void> {
    const context = tracker.getContext();
    const conversationId = context.core?.conversationId;
    const organizationId = context.core?.organizationId;

    this.logger.log('[restartMissingWorkflow] starting', {
      workflowId,
      conversationId,
      organizationId,
      nextNodeId,
      sessionStartTime: context.core?.session?.startTime,
    });

    if (!conversationId || !organizationId) {
      this.logger.warn(
        '[restartMissingWorkflow] Skipping - missing conversationId or organizationId',
        {
          workflowId,
          conversationId,
          organizationId,
        },
      );
      return;
    }

    const conversation = await this.conversationService.getConversation(
      conversationId,
      organizationId,
    );

    if (!conversation) {
      this.logger.warn(
        '[restartMissingWorkflow] Skipping - conversation not found',
        {
          workflowId,
          conversationId,
          organizationId,
        },
      );
      return;
    }

    const withinGrace = this.isWithinRestartGraceWindow(
      context.core?.session?.startTime,
    );
    if (conversation.workflowId !== workflowId && !withinGrace) {
      this.logger.warn(
        '[restartMissingWorkflow] Skipping restart - stale workflow response',
        {
          conversationId,
          workflowId,
          currentWorkflowId: conversation.workflowId,
          withinGrace,
          sessionStartTime: context.core?.session?.startTime,
          graceMinutes: this.RESTART_GRACE_MINUTES,
        },
      );
      return;
    }

    if (!conversation.workflowName) {
      this.logger.warn(
        '[restartMissingWorkflow] Skipping - conversation missing workflowName',
        {
          workflowId,
          conversationId,
          organizationId,
          conversationStatus: conversation.status,
        },
      );
      return;
    }

    const validatedWorkflowName =
      this.workflowTypeRegistry.validateWorkflowName(conversation.workflowName);

    const workflowResult =
      await this.conversationWorkflowService.startWorkflowForExistingConversation(
        conversationId,
        validatedWorkflowName,
        organizationId,
      );

    if (!workflowResult?.workflowId) {
      throw new Error(
        `Failed to start replacement workflow for conversation ${conversationId}`,
      );
    }

    const targetNodeId = this.getRestartTargetNodeId(
      systemMessageData,
      nextNodeId,
    );
    const systemMessageComplete = hasUiElements(systemMessageData);

    this.logger.log('[restartMissingWorkflow] Started replacement workflow', {
      previousWorkflowId: workflowId,
      newWorkflowId: workflowResult.workflowId,
      conversationId,
      targetNodeId,
      systemMessageComplete,
    });

    const skipSignalName = WorkflowSignals.getSkipToNodeSignalName(
      workflowResult.workflowId,
    );
    const restartHandle = this.temporalClient.workflow.getHandle(
      workflowResult.workflowId,
    );

    await restartHandle.signal(skipSignalName, {
      nodeId: targetNodeId,
      systemMessageComplete,
    });
  }

  private getRestartTargetNodeId(
    systemMessageData: SystemMessageData,
    nextNodeId: string | null,
  ): string {
    if (hasUiElements(systemMessageData)) {
      const nodeId = systemMessageData.nodeId;
      if (!nodeId) {
        throw new Error('Missing nodeId for UI system message during restart');
      }
      return nodeId;
    }

    if (!nextNodeId) {
      throw new Error('Missing nextNodeId for restart without UI elements');
    }

    return nextNodeId;
  }

  private isWithinRestartGraceWindow(startTime?: Date | string): boolean {
    if (!this.RESTART_GRACE_MINUTES || !startTime) {
      return false;
    }

    const parsedStart =
      startTime instanceof Date ? startTime : new Date(startTime);

    if (Number.isNaN(parsedStart.getTime())) {
      return false;
    }

    const ageMs = Date.now() - parsedStart.getTime();
    return ageMs <= this.RESTART_GRACE_MINUTES * 60_000;
  }

  /**
   * Get flow execution statistics for analytics
   */
  async getExecutionStats(
    organizationId: OrganizationId,
    flowId?: string,
    entityType?: string,
  ): Promise<{
    total: number;
    completed: number;
    failed: number;
    inProgress: number;
    paused: number;
    resumable: number;
  }> {
    const where = {
      organizationId,
      ...(flowId && { flowId }),
      ...(entityType && { entityType }),
    };

    const [total, completed, failed, inProgress, paused, resumable] =
      await Promise.all([
        this.prisma.db.flowExecution.count({ where }),
        this.prisma.db.flowExecution.count({
          where: { ...where, status: FlowExecutionStatus.COMPLETED },
        }),
        this.prisma.db.flowExecution.count({
          where: { ...where, status: FlowExecutionStatus.FAILED },
        }),
        this.prisma.db.flowExecution.count({
          where: {
            ...where,
            status: {
              in: [
                FlowExecutionStatus.STARTED,
                FlowExecutionStatus.IN_PROGRESS,
              ],
            },
          },
        }),
        this.prisma.db.flowExecution.count({
          where: { ...where, status: FlowExecutionStatus.PAUSED },
        }),
        this.prisma.db.flowExecution.count({
          where: { ...where, resumable: true },
        }),
      ]);

    return {
      total,
      completed,
      failed,
      inProgress,
      paused,
      resumable,
    };
  }

  async resolveConversationPromptType(input: {
    conversationId: ConversationId;
    workflowId: WorkflowId | null;
    workflowName: WorkflowName | null;
    organizationId: OrganizationId;
  }): Promise<{
    workflowState: WorkflowState;
    promptType: LocalPromptType | null;
    nodeId: string | null;
    triggerMessageId: MessageId | null;
  }> {
    const { conversationId, workflowId, workflowName, organizationId } = input;

    if (!workflowId && !workflowName) {
      this.logger.debug(
        `Conversation ${conversationId} has no workflow; returning workflowState=terminal with null promptType`,
      );
      return {
        workflowState: WorkflowState.Terminal,
        promptType: null,
        nodeId: null,
        triggerMessageId: null,
      };
    }

    const flow = workflowName
      ? this.nodeExecutionService.getFlow(workflowName)
      : undefined;
    if (!flow) {
      this.logger.debug(
        `Conversation ${conversationId} workflowName=${workflowName} has no registered flow template; returning workflowState=terminal with null promptType`,
      );
      return {
        workflowState: WorkflowState.Terminal,
        promptType: null,
        nodeId: null,
        triggerMessageId: null,
      };
    }

    if (!workflowId) {
      this.logger.debug(
        `Conversation ${conversationId} has no workflowId; returning workflowState=terminal terminalPromptType=${flow.terminalPromptType}`,
      );
      return {
        workflowState: WorkflowState.Terminal,
        promptType: flow.terminalPromptType,
        nodeId: null,
        triggerMessageId: null,
      };
    }

    try {
      const handle = this.temporalClient.workflow.getHandle(workflowId);
      const status = await handle.query(getWorkflowStatus);

      if (status.isComplete) {
        this.logger.debug(
          `Workflow ${workflowId} is complete; returning workflowState=terminal terminalPromptType=${flow.terminalPromptType}`,
        );
        return {
          workflowState: WorkflowState.Terminal,
          promptType: flow.terminalPromptType,
          nodeId: null,
          triggerMessageId: null,
        };
      }

      const nodeEntry = status.currentNodeId
        ? this.nodeExecutionService.getNode(flow.id, status.currentNodeId)
        : undefined;

      if (nodeEntry?.node instanceof AgentHandoffNodeBase) {
        this.logger.debug(
          `Workflow ${workflowId} is on handoff node=${status.currentNodeId}; the conversation now belongs to the CLI handler, returning workflowState=terminal terminalPromptType=${flow.terminalPromptType}`,
        );
        return {
          workflowState: WorkflowState.Terminal,
          promptType: flow.terminalPromptType,
          nodeId: null,
          triggerMessageId: null,
        };
      }

      if (nodeEntry?.node.type === NodeType.EXTERNAL_AGENT) {
        const promptType = (nodeEntry.node as ExternalAgentNodeBase).promptType;
        const { triggerMessageId } =
          await this.pendingTriggerService.resolvePendingTriggerForNode(
            conversationId,
            status.currentNodeId as string,
          );
        this.logger.debug(
          `Workflow ${workflowId} on EXTERNAL_AGENT node=${status.currentNodeId}; returning workflowState=agent-pending promptType=${promptType} triggerMessageId=${triggerMessageId ?? 'null'}`,
        );
        return {
          workflowState: WorkflowState.AgentPending,
          promptType,
          nodeId: status.currentNodeId,
          triggerMessageId,
        };
      }

      this.logger.debug(
        `Workflow ${workflowId} on non-agent node=${status.currentNodeId ?? 'null'}; returning workflowState=live-non-agent terminalPromptType=${flow.terminalPromptType}`,
      );
      return {
        workflowState: WorkflowState.LiveNonAgent,
        promptType: flow.terminalPromptType,
        nodeId: null,
        triggerMessageId: null,
      };
    } catch (error) {
      const errorName = error instanceof Error ? error.name : '';
      const errorMessage =
        error instanceof Error ? error.message.toLowerCase() : '';
      const isWorkflowGone =
        errorName === 'WorkflowNotFoundError' ||
        errorMessage.includes('workflow execution already completed') ||
        errorMessage.includes('workflow not found');

      if (isWorkflowGone) {
        this.logger.debug(
          `Workflow ${workflowId} is gone (${errorName || 'unknown error'}); checking for paused execution before falling back to terminal state`,
        );

        const pausedExecution = await this.findPausedByConversation(
          conversationId,
          organizationId,
        );

        if (!pausedExecution) {
          this.logger.debug(
            `Workflow ${workflowId} is gone and no paused execution found for conversation=${conversationId}; returning workflowState=terminal terminalPromptType=${flow.terminalPromptType}`,
          );
          return {
            workflowState: WorkflowState.Terminal,
            promptType: flow.terminalPromptType,
            nodeId: null,
            triggerMessageId: null,
          };
        }

        const pendingTransitionNextNodeId =
          pausedExecution.flowState?.context?.pendingTransition?.nextNodeId ??
          null;
        const resolvedNodeId =
          pendingTransitionNextNodeId ?? pausedExecution.currentNode;

        const nodeEntry = resolvedNodeId
          ? this.nodeExecutionService.getNode(flow.id, resolvedNodeId)
          : undefined;

        if (nodeEntry?.node instanceof AgentHandoffNodeBase) {
          this.logger.debug(
            `Workflow ${workflowId} is gone and its saved execution=${pausedExecution.id} ended on handoff node=${resolvedNodeId}; the conversation now belongs to the CLI handler, returning workflowState=terminal terminalPromptType=${flow.terminalPromptType}`,
          );
          return {
            workflowState: WorkflowState.Terminal,
            promptType: flow.terminalPromptType,
            nodeId: null,
            triggerMessageId: null,
          };
        }

        if (nodeEntry?.node.type === NodeType.EXTERNAL_AGENT) {
          const promptType = (nodeEntry.node as ExternalAgentNodeBase)
            .promptType;
          const { triggerMessageId } =
            await this.pendingTriggerService.resolvePendingTriggerForNode(
              conversationId,
              resolvedNodeId as string,
            );
          this.logger.debug(
            `Workflow ${workflowId} is gone but paused execution=${pausedExecution.id} found; currentNode=${pausedExecution.currentNode ?? 'null'} pendingTransitionNextNodeId=${pendingTransitionNextNodeId ?? 'none'} resolvedNodeId=${resolvedNodeId} resolvedNodeType=EXTERNAL_AGENT; returning workflowState=agent-pending promptType=${promptType} triggerMessageId=${triggerMessageId ?? 'null'}`,
          );
          return {
            workflowState: WorkflowState.AgentPending,
            promptType,
            nodeId: resolvedNodeId,
            triggerMessageId,
          };
        }

        this.logger.debug(
          `Workflow ${workflowId} is gone and paused execution=${pausedExecution.id} resolved to non-agent node (currentNode=${pausedExecution.currentNode ?? 'null'} pendingTransitionNextNodeId=${pendingTransitionNextNodeId ?? 'none'} resolvedNodeId=${resolvedNodeId ?? 'null'} resolvedNodeType=${nodeEntry?.node.type ?? 'unknown'}); returning workflowState=live-non-agent terminalPromptType=${flow.terminalPromptType}`,
        );
        return {
          workflowState: WorkflowState.LiveNonAgent,
          promptType: flow.terminalPromptType,
          nodeId: null,
          triggerMessageId: null,
        };
      }

      throw error;
    }
  }
}
