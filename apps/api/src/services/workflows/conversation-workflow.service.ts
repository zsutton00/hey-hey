import {
  forwardRef,
  Inject,
  Injectable,
  INestApplicationContext,
} from '@nestjs/common';
import { FlowExecutionStatus, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { SYSTEM_USER } from 'src/constants';
import { ContextAwareLogger } from 'src/core/logging/context-aware-logger.service';
import { errorToLoggable } from 'src/utils/logging.util';
import { MessageResponseUtil } from 'src/utils/message-response.util';
import { convertNodeResultToSystemMessage } from 'src/utils/node-result-to-system-message.util';
import { workflowAboutTypeToEntityType } from 'src/utils/workflow-about-type.util';
import { hasUiElements } from 'src/utils/type-checks';
import { ConversationWorkflowError } from '../../core/exceptions/workflow.exceptions';
import {
  ConversationResponseDto,
  ConversationStatus,
  CreateConversationDto,
  WorkflowName,
} from '../../generated';
import {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowAboutType,
  WorkflowId,
} from '../../types';
import {
  FlowContext,
  FlowTemplate,
  NodeType,
} from '../../types/flow-internal.types';
import { mergeRepositoryGroundingAdditionalContext } from '../../flows/nodes/onboarding/repository-grounding.contract';
import { mergeWorkTrackerImportAdditionalContext } from '../../flows/nodes/work-tracker-import/work-tracker-import.contract';
import { createMutableContextHandle } from '../../utils/mutable-context';
import {
  SerializableWorkflowState,
  WorkflowStep,
  WORKFLOW_STEP_TO_PHASE,
} from '../../workflows/conversation-workflow-state';
import { ConversationService } from '../conversation.service';
import { MessageService } from '../message.service';
import { FlowExecutionService } from './flow-execution.service';
import { NodeExecutionService } from './node-execution.service';
import { WorkflowRouterService } from './workflow-router.service';
import {
  WorkflowStartResult,
  WorkflowTypeRegistryService,
} from './workflow-type-registry.service';

export interface ConversationWithWorkflowResult {
  conversation: ConversationResponseDto;
  workflowStarted: boolean;
  workflowId?: string;
  workflowError?: string;
}

@Injectable()
export class ConversationWorkflowService {
  private readonly logger: ContextAwareLogger =
    ContextAwareLogger.createServiceLogger(ConversationWorkflowService.name);
  constructor(
    @Inject(forwardRef(() => ConversationService))
    private readonly conversationService: ConversationService,
    private readonly workflowTypeRegistry: WorkflowTypeRegistryService,
    private readonly workflowRouterService: WorkflowRouterService,
    @Inject(forwardRef(() => FlowExecutionService))
    private readonly flowExecutionService: FlowExecutionService,
    private readonly nodeExecutionService: NodeExecutionService,
    @Inject(forwardRef(() => MessageService))
    private readonly messageService: MessageService,
    @Inject('APP_CONTEXT') private readonly appContext: INestApplicationContext,
  ) {}

  async createConversation(
    createDto: CreateConversationDto,
    organizationId: OrganizationId,
    options?: {
      userId?: UserId;
      onCreatedInTx?: (
        tx: Prisma.TransactionClient,
        conversationId: ConversationId,
      ) => Promise<void>;
    },
  ): Promise<ConversationWithWorkflowResult> {
    this.logger.debug('[createConversation] starting...', {
      projectId: createDto.projectId,
    });

    const workflowName = (
      createDto as Partial<Pick<CreateConversationDto, 'workflowName'>>
    ).workflowName;
    const hasWorkflowName =
      typeof workflowName === 'string' && workflowName.length > 0;
    const validatedWorkflowName = hasWorkflowName
      ? this.workflowTypeRegistry.validateWorkflowName(workflowName)
      : undefined;

    if (validatedWorkflowName === WorkflowName.AgentSession) {
      this.validateAgentSessionCreateRequest(createDto);
    }

    const workflowId = hasWorkflowName
      ? ((createDto.workflowId ?? uuidv4()) as WorkflowId)
      : createDto.workflowId;

    const deferAutostart =
      validatedWorkflowName !== undefined &&
      this.workflowTypeRegistry.shouldDeferAutostart(validatedWorkflowName);

    const dtoForInsert = hasWorkflowName
      ? {
          ...createDto,
          workflowId,
          ...(deferAutostart ? { status: ConversationStatus.NotStarted } : {}),
        }
      : createDto;

    const userHook = options?.onCreatedInTx;
    const conversation = userHook
      ? await this.conversationService.createConversation(
          dtoForInsert,
          organizationId,
          {
            createdBy: options?.userId,
            onCreatedInTx: async (tx, conv) => {
              await userHook(tx, conv.id as ConversationId);
            },
          },
        )
      : await this.conversationService.createConversation(
          dtoForInsert,
          organizationId,
          { createdBy: options?.userId },
        );
    if (!conversation) {
      throw new ConversationWorkflowError(
        'Failed to create conversation before starting workflow',
        {
          workflowAboutType: createDto.workflowAboutType,
        },
      );
    }

    if (!hasWorkflowName) {
      return {
        conversation,
        workflowStarted: false,
      };
    }

    if (!conversation.workflowAboutId || !conversation.workflowAboutType) {
      throw new ConversationWorkflowError(
        `Conversation request missing workflowAbout field(s) ${JSON.stringify({
          workflowAboutId: conversation.workflowAboutId,
          workflowAboutType: conversation.workflowAboutType,
        })}`,
      );
    }

    if (
      validatedWorkflowName &&
      this.workflowTypeRegistry.isNonTemporalBackedWorkflow(
        validatedWorkflowName,
      )
    ) {
      return {
        conversation,
        workflowStarted: false,
        workflowId: conversation.workflowId,
      };
    }

    if (!validatedWorkflowName) {
      throw new ConversationWorkflowError('Workflow name is required');
    }
    if (!workflowId) {
      throw new ConversationWorkflowError(
        'Workflow ID is required to start workflow',
        { workflowName: validatedWorkflowName },
      );
    }

    if (deferAutostart) {
      this.logger.debug(
        '[createConversation] autostart deferred for workflow; conversation parked at NOT_STARTED',
        {
          workflowName: validatedWorkflowName,
          conversationId: conversation.id,
        },
      );
      return {
        conversation,
        workflowStarted: false,
        workflowId: conversation.workflowId,
      };
    }

    return this.startWorkflowForJustCreatedConversation({
      conversation,
      createDto,
      organizationId,
      validatedWorkflowName,
      workflowId,
      userId: options?.userId,
    });
  }

  private async startWorkflowForJustCreatedConversation(params: {
    conversation: ConversationResponseDto;
    createDto: CreateConversationDto;
    organizationId: OrganizationId;
    validatedWorkflowName: WorkflowName;
    workflowId: WorkflowId;
    userId?: UserId;
  }): Promise<ConversationWithWorkflowResult> {
    const {
      conversation,
      createDto,
      organizationId,
      validatedWorkflowName,
      userId,
    } = params;

    // Inline auto-start: the row was just inserted in this same call, so no
    // concurrent /start can race us (no other caller has the conversationId
    // yet). Skip the NOT_STARTED claim — the row was created with the schema
    // default (STARTED), not NOT_STARTED, and the claim would silently fail
    // and short-circuit the workflow start. The deferred /start path uses
    // the claim; this one does not.
    if (
      conversation.status === ConversationStatus.Completed ||
      conversation.status === ConversationStatus.Failed ||
      conversation.status === ConversationStatus.Deleted
    ) {
      throw new ConversationWorkflowError(
        `Cannot auto-start workflow for conversation ${conversation.id} in terminal status '${conversation.status}'`,
        { conversationId: conversation.id, status: conversation.status },
      );
    }

    const callerAdditionalContext =
      typeof createDto.context === 'object' && createDto.context !== null
        ? Object.fromEntries(Object.entries(createDto.context))
        : undefined;
    const additionalContext =
      validatedWorkflowName === WorkflowName.Onboarding &&
      callerAdditionalContext?.repositoryGrounding === undefined
        ? {
            ...(callerAdditionalContext ?? {}),
            repositoryGroundingIntentRequired: true,
          }
        : callerAdditionalContext;

    return this.runWorkflowStart({
      conversation,
      organizationId,
      validatedWorkflowName,
      userId,
      additionalContext,
    });
  }

  /**
   * Deferred-start entry point. Used by the controller's
   * `POST /conversations/:id/start` handler against a conversation that was
   * birthed at status NOT_STARTED (currently only the PlanFromDesignDoc
   * workflow takes this path; see {@link WorkflowTypeRegistryService.shouldDeferAutostart}).
   *
   * Gates entry on an atomic claim — `claimConversationForStart` flips
   * NOT_STARTED -> IN_PROGRESS in a single conditional update so that
   * concurrent /start callers (e.g. React StrictMode double-firing) cannot
   * both proceed into Temporal. The winner runs the shared
   * {@link runWorkflowStart} sequence; losers return as a no-op so the
   * controller can respond idempotently.
   *
   * The inline auto-start path (immediately after createConversation) does
   * NOT come through here — it calls {@link runWorkflowStart} directly,
   * because no concurrent /start can race a row whose id has not yet
   * escaped the create call. See
   * {@link startWorkflowForJustCreatedConversation}.
   */
  async startConversationWorkflow(
    conversationId: ConversationId,
    organizationId: OrganizationId,
    userId?: UserId,
    additionalContext?: Record<string, unknown>,
  ): Promise<ConversationWithWorkflowResult> {
    this.logger.debug('[startConversationWorkflow] entry', {
      conversationId,
      organizationId,
      userId: userId ?? null,
    });

    const conversation = await this.conversationService.findOne(
      conversationId,
      organizationId,
    );
    if (!conversation) {
      throw new ConversationWorkflowError(
        `Conversation ${conversationId} not found in organization ${organizationId}`,
      );
    }

    if (!conversation.workflowName) {
      throw new ConversationWorkflowError('Workflow name is required');
    }
    const validatedWorkflowName =
      this.workflowTypeRegistry.validateWorkflowName(conversation.workflowName);

    if (
      this.workflowTypeRegistry.isNonTemporalBackedWorkflow(
        validatedWorkflowName,
      )
    ) {
      this.logger.debug(
        '[startConversationWorkflow] workflow is non-Temporal-backed; skipping start',
        { workflowName: validatedWorkflowName, conversationId },
      );
      return {
        conversation,
        workflowStarted: false,
        workflowId: conversation.workflowId,
      };
    }

    // Atomic claim: only one concurrent caller flips NOT_STARTED -> IN_PROGRESS.
    // Losers return as a no-op so the controller's idempotency contract holds
    // under concurrency (e.g. React StrictMode firing /start twice).
    const claim = await this.conversationService.claimConversationForStart(
      conversationId,
      organizationId,
    );
    if (!claim.claimed) {
      this.logger.debug(
        '[startConversationWorkflow] claim lost; another caller already started this workflow',
        {
          conversationId,
          currentStatus: claim.conversation?.status,
        },
      );
      return {
        conversation: claim.conversation ?? conversation,
        workflowStarted: false,
        workflowId: claim.conversation?.workflowId ?? conversation.workflowId,
      };
    }

    // Re-read of the claimed row so downstream code sees IN_PROGRESS, not
    // the stale NOT_STARTED snapshot we loaded above.
    const claimedConversation = claim.conversation ?? conversation;

    return this.runWorkflowStart({
      conversation: claimedConversation,
      organizationId,
      validatedWorkflowName,
      userId,
      additionalContext,
    });
  }

  /**
   * Shared post-claim/post-create workflow start sequence: pre-execute the
   * opener (which seeds the SYSTEM message, creates the FlowExecution row,
   * and flips status to InProgress), kick off Temporal via the registry,
   * and write the resolved workflowId back to the conversation row. Called
   * from both entry points — the deferred /start path
   * ({@link startConversationWorkflow}, which gates entry on an atomic
   * NOT_STARTED claim) and the inline auto-start path
   * ({@link startWorkflowForJustCreatedConversation}, which skips the claim
   * because no concurrent /start can race a row that was just inserted in
   * the same call).
   */
  private async runWorkflowStart(params: {
    conversation: ConversationResponseDto;
    organizationId: OrganizationId;
    validatedWorkflowName: WorkflowName;
    userId?: UserId;
    additionalContext?: Record<string, unknown>;
  }): Promise<ConversationWithWorkflowResult> {
    const {
      conversation,
      organizationId,
      validatedWorkflowName,
      userId,
      additionalContext,
    } = params;
    const conversationId = conversation.id as ConversationId;
    const { workflowAboutId, workflowAboutType, workflowId } = conversation;
    if (!workflowAboutId || !workflowAboutType) {
      throw new ConversationWorkflowError(
        `Conversation ${conversation.id} missing workflowAbout field(s) after creation`,
      );
    }
    if (!workflowId) {
      throw new ConversationWorkflowError(
        'Workflow ID is required to start workflow',
        { workflowName: validatedWorkflowName },
      );
    }

    try {
      this.logger.debug('[runWorkflowStart] starting workflow', {
        validatedWorkflowName,
        conversationId,
        projectId: conversation.projectId,
      });

      await this.preExecuteOpenerIfAvailable({
        workflowName: validatedWorkflowName,
        conversation,
        organizationId,
        workflowId: workflowId as WorkflowId,
        userId,
        additionalContext,
      });

      const workflowResult =
        await this.workflowTypeRegistry.startWorkflowByType(
          validatedWorkflowName,
          conversationId,
          conversation.projectId,
          organizationId,
          // Thread the caller's userId so the workflow is USER-initiated when
          // start-run dispatch is owner-driven. Falls back to SYSTEM-initiated
          // for inline auto-start (no caller user in scope) and other
          // server-driven entry points.
          userId,
          conversation.title, // Pass the conversation title
          workflowAboutType as WorkflowAboutType,
          workflowAboutId,
          workflowId as WorkflowId,
          additionalContext as never,
        );

      const updatedConversation =
        await this.conversationService.updateConversationWorkflowId(
          conversationId,
          workflowResult.workflowId,
          organizationId,
        );
      if (!updatedConversation) {
        throw new ConversationWorkflowError(
          `Failed to update conversation ${conversation.id} with workflow ${workflowResult.workflowId}`,
          {
            conversationId: conversation.id,
            workflowId: workflowResult.workflowId,
          },
        );
      }

      this.logger.debug('[runWorkflowStart] exit', {
        conversationId,
        workflowId: workflowResult.workflowId,
      });

      return {
        conversation: updatedConversation,
        workflowStarted: true,
        workflowId: workflowResult.workflowId,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : errorToLoggable(error);
      this.logger.error('[runWorkflowStart] error starting workflow', {
        errorMessage,
        conversationId,
        projectId: conversation.projectId,
      });

      throw new ConversationWorkflowError(
        `Failed to start workflow for conversation ${conversation.id}: ${errorMessage}`,
        {
          conversationId: conversation.id,
          workflowAboutType: conversation.workflowAboutType,
          originalError: errorMessage,
        },
      );
    }
  }

  /**
   * Start a Temporal workflow against a conversation that has already
   * been inserted (e.g. by the proposal-approval flow inside its own
   * tx). Mirrors {@link startWorkflowForJustCreatedConversation} but
   * skips the conversation-row insert that the standard
   * `createConversation` path performs. Callers must ensure the
   * conversation exists and that any pre-tx invariants
   * (`workflowAboutId`/`workflowAboutType`) are satisfied.
   */
  async startWorkflowOnExistingConversation(params: {
    conversationId: ConversationId;
    projectId: ProjectId;
    organizationId: OrganizationId;
    workflowName: WorkflowName;
    workflowId: WorkflowId;
    workflowAboutType: WorkflowAboutType;
    workflowAboutId: string;
    title?: string;
    additionalContext?: Record<string, unknown>;
  }): Promise<{ workflowId: string }> {
    const {
      conversationId,
      projectId,
      organizationId,
      workflowName,
      workflowId,
      workflowAboutType,
      workflowAboutId,
      title,
      additionalContext,
    } = params;

    if (this.workflowTypeRegistry.isNonTemporalBackedWorkflow(workflowName)) {
      this.logger.debug(
        '[startWorkflowOnExistingConversation] workflow is non-Temporal-backed; skipping start',
        { workflowName, conversationId },
      );
      return { workflowId };
    }

    const workflowResult = await this.workflowTypeRegistry.startWorkflowByType(
      workflowName,
      conversationId,
      projectId,
      organizationId,
      undefined,
      title,
      workflowAboutType,
      workflowAboutId,
      workflowId,
      additionalContext as never,
    );

    const updated = await this.conversationService.updateConversationWorkflowId(
      conversationId,
      workflowResult.workflowId,
      organizationId,
    );
    if (!updated) {
      throw new ConversationWorkflowError(
        `Failed to update conversation ${conversationId} with workflow ${workflowResult.workflowId}`,
        {
          conversationId,
          workflowId: workflowResult.workflowId,
        },
      );
    }

    return { workflowId: workflowResult.workflowId };
  }

  private validateAgentSessionCreateRequest(
    createDto: CreateConversationDto,
  ): void {
    if (!createDto.workflowAboutId) {
      throw new ConversationWorkflowError(
        'agent-session conversations require workflowAboutId',
      );
    }

    if (createDto.workflowAboutType !== 'agent-session') {
      throw new ConversationWorkflowError(
        `agent-session conversations require workflowAboutType=agent-session (received: ${String(
          createDto.workflowAboutType,
        )})`,
      );
    }
  }

  private async preExecuteOpenerIfAvailable({
    workflowName,
    conversation,
    organizationId,
    workflowId,
    userId,
    additionalContext,
  }: {
    workflowName: WorkflowName;
    conversation: ConversationResponseDto;
    organizationId: OrganizationId;
    workflowId: WorkflowId;
    userId?: UserId;
    additionalContext?: Record<string, unknown>;
  }): Promise<void> {
    const flow = this.nodeExecutionService.getFlow(workflowName);
    if (!flow) {
      throw new ConversationWorkflowError(
        `Workflow template '${workflowName}' not found`,
        { workflowName },
      );
    }

    const openerData = this.nodeExecutionService.getNode(
      flow.id,
      flow.startNode,
    );
    if (!openerData?.node || !openerData.routing) {
      throw new ConversationWorkflowError(
        `Opener node '${flow.startNode}' not found for workflow '${workflowName}'`,
        { workflowName, nodeId: flow.startNode },
      );
    }

    if (openerData.node.type !== NodeType.OPENER) {
      return;
    }

    const initialContext = await this.buildInitialFlowContext(
      flow,
      conversation,
      workflowId,
      organizationId,
      userId,
      additionalContext,
    );

    const tracker = createMutableContextHandle(initialContext);
    const { result, nextNodeId } = await this.nodeExecutionService.executeNode(
      openerData.node.id,
      tracker,
      openerData.routing,
    );

    if (!nextNodeId) {
      throw new ConversationWorkflowError(
        `Opener node '${openerData.node.id}' missing nextNodeId`,
        { workflowName, nodeId: openerData.node.id },
      );
    }

    const systemMessageData = convertNodeResultToSystemMessage(
      result,
      openerData.node.type,
      openerData.node.id,
    );

    if (!hasUiElements(systemMessageData)) {
      this.logger.debug(
        '[preExecuteOpenerIfAvailable] Opener produced no UI elements; skipping pre-execution',
        {
          workflowName,
          nodeId: openerData.node.id,
        },
      );
      return;
    }

    const messageStatus =
      MessageResponseUtil.determineMessageStatus(systemMessageData);

    const message = await this.messageService.addMessage(
      {
        conversationId: conversation.id,
        projectId: conversation.projectId,
        type: 'SYSTEM',
        status: messageStatus,
        data: systemMessageData,
      },
      organizationId,
      'preExecuteOpener',
    );

    tracker.mutate((draft) => {
      draft.lastSystemMessageId = message.id as MessageId;
      if (!draft.flowPath.pathTaken.includes(openerData.node.id)) {
        draft.flowPath.pathTaken.push(openerData.node.id);
      }
      draft.currentNodeExecution = {
        nodeId: openerData.node.id,
        questionsGenerated: false,
      };
      draft.pendingTransition = {
        nextNodeId,
        reason: 'opener_complete',
      };
    });

    const updatedContext = tracker.getContext();

    const serializableState: SerializableWorkflowState = {
      step: WorkflowStep.WAITING_FOR_USER_INPUT,
      phase: WORKFLOW_STEP_TO_PHASE[WorkflowStep.WAITING_FOR_USER_INPUT],
      nodeConfig: {
        id: openerData.node.id,
        type: openerData.node.type,
        supportsPhases: false,
      },
      iterations: 0,
      context: updatedContext,
      currentNodeId: openerData.node.id,
      // The opener has just completed and the workflow is parked at
      // WAITING_FOR_USER_INPUT for the same node. The opener's system
      // message id is the trigger id the resumed run will look for in
      // userMessagesByExecution when the user replies.
      currentNodeExecutionId: updatedContext.lastSystemMessageId,
      lastSystemMessageId: updatedContext.lastSystemMessageId,
      lastUserMessageId: undefined,
      hasPendingLLMResponse: false,
      timestamp: new Date().toISOString(),
      version: 1,
    };

    const systemUserId = 'system' as UserId;

    const execution = await this.flowExecutionService.createFlowExecution({
      userId: systemUserId,
      flowId: flow.id,
      organizationId,
      projectId: conversation.projectId,
      conversationId: conversation.id,
      entityType: workflowAboutTypeToEntityType(
        conversation.workflowAboutType as WorkflowAboutType,
      ),
      entityId: conversation.workflowAboutId || undefined,
      currentNode: openerData.node.id,
      totalNodes: Object.keys(flow.nodes).length,
      flowState: serializableState,
      resumable: true,
    });

    await this.flowExecutionService.updateFlowState(
      execution.id,
      organizationId,
      {
        currentNode: openerData.node.id,
        completedNodes: updatedContext.flowPath.pathTaken.length,
        flowState: serializableState,
        status: FlowExecutionStatus.IN_PROGRESS,
      },
    );

    await this.conversationService.updateConversationInternal(
      conversation.id,
      organizationId,
      {
        status: ConversationStatus.InProgress,
      },
      SYSTEM_USER,
    );
  }

  private async buildInitialFlowContext(
    flow: FlowTemplate<FlowContext>,
    conversation: ConversationResponseDto,
    workflowId: WorkflowId,
    organizationId: OrganizationId,
    userId?: UserId,
    additionalContext?: Record<string, unknown>,
  ): Promise<FlowContext> {
    if (!conversation.workflowAboutId || !conversation.workflowAboutType) {
      throw new ConversationWorkflowError(
        `Conversation ${conversation.id} missing workflowAbout field(s) ${JSON.stringify(
          {
            workflowAboutId: conversation.workflowAboutId,
            workflowAboutType: conversation.workflowAboutType,
          },
        )}`,
      );
    }

    const contextUserId = userId ?? (SYSTEM_USER as UserId);

    const baseContext: FlowContext = {
      core: {
        workflowId,
        projectId: conversation.projectId,
        organizationId,
        conversationId: conversation.id,
        workflowAboutType: conversation.workflowAboutType as WorkflowAboutType,
        workflowAboutId: conversation.workflowAboutId,
        user: {
          id: contextUserId,
          role: 'member',
        },
        session: {
          startTime: new Date(),
          interactionCount: 0,
        },
      },
      flowId: flow.id,
      lastSystemMessageId: undefined,
      flowPath: {
        pathTaken: [],
        previousNode: undefined,
        previousTransition: undefined,
      },
    };

    let context: FlowContext;
    if (flow.initialContextTransform) {
      context = (await flow.initialContextTransform(
        baseContext,
        conversation.workflowAboutId,
        conversation.workflowAboutType as WorkflowAboutType,
        this.appContext,
      )) as FlowContext;
    } else {
      context = baseContext;
    }

    if (flow.id === WorkflowName.RepositoryImport) {
      return mergeRepositoryGroundingAdditionalContext(
        context,
        additionalContext,
      );
    }
    if (flow.id === WorkflowName.WorkTrackerImport) {
      return mergeWorkTrackerImportAdditionalContext(
        context,
        additionalContext,
      );
    }
    return { ...context, ...(additionalContext ?? {}) };
  }

  async retryWorkflowForExistingConversation(
    conversationId: ConversationId,
    organizationId: OrganizationId,
    nodeId: string,
  ): Promise<void> {
    const conversation = await this.conversationService.findOne(
      conversationId,
      organizationId,
    );
    if (!conversation) {
      throw new ConversationWorkflowError(
        `Conversation ${conversationId} not found in organization ${organizationId}`,
      );
    }

    if (
      conversation.workflowName &&
      this.workflowTypeRegistry.isNonTemporalBackedWorkflow(
        conversation.workflowName,
      )
    ) {
      throw new ConversationWorkflowError(
        `Workflow retry is not supported for non-Temporal workflow '${conversation.workflowName}'`,
      );
    }

    if (!conversation.workflowId) {
      throw new ConversationWorkflowError(
        `Conversation ${conversationId} has no workflow to restart`,
      );
    }
    const isActive = await this.workflowRouterService.isWorkflowRunning(
      conversation.workflowId,
    );
    if (!isActive) {
      throw new ConversationWorkflowError(
        `Conversation ${conversationId} has no active workflow to restart`,
        {
          workflowId: conversation.workflowId,
        },
      );
    }

    try {
      await this.workflowRouterService.restartWorkflow(
        conversation.workflowId,
        nodeId,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(errorToLoggable(error));

      throw new ConversationWorkflowError(
        `Failed to restart workflow ${conversation.workflowId} for conversation ${conversationId}: ${errorMessage}`,
        {
          conversationId,
          originalError: errorMessage,
        },
      );
    }
  }

  async startWorkflowForExistingConversation(
    conversationId: ConversationId,
    workflowType: string,
    organizationId: OrganizationId,
  ): Promise<WorkflowStartResult> {
    const conversation = await this.conversationService.findOne(
      conversationId,
      organizationId,
    );
    if (!conversation) {
      throw new ConversationWorkflowError(
        `Conversation ${conversationId} not found in organization ${organizationId}`,
      );
    }

    if (!conversation.workflowAboutId || !conversation.workflowAboutType) {
      throw new ConversationWorkflowError(
        `Conversation ${conversationId} missing workflowAbout field(s) ${JSON.stringify(
          {
            workflowAboutId: conversation.workflowAboutId,
            workflowAboutType: conversation.workflowAboutType,
          },
        )}`,
      );
    }

    if (conversation.workflowId) {
      const isActive = await this.workflowRouterService.isWorkflowRunning(
        conversation.workflowId,
      );
      if (isActive) {
        throw new ConversationWorkflowError(
          `Conversation ${conversationId} already has an active workflow: ${conversation.workflowId}`,
          { existingWorkflowId: conversation.workflowId },
        );
      }

      this.logger.warn(
        `Conversation ${conversationId} has inactive workflow ${conversation.workflowId}; starting new workflow`,
      );
    }

    const validatedWorkflowType =
      this.workflowTypeRegistry.validateWorkflowName(workflowType);

    if (
      this.workflowTypeRegistry.isNonTemporalBackedWorkflow(
        validatedWorkflowType,
      )
    ) {
      throw new ConversationWorkflowError(
        `Workflow start is not supported for non-Temporal workflow '${validatedWorkflowType}'`,
      );
    }

    try {
      const workflowResult =
        await this.workflowTypeRegistry.startWorkflowByType(
          validatedWorkflowType,
          conversationId,
          conversation.projectId,
          organizationId,
          undefined, // No specific userId available from conversation response
          conversation.title, // Pass the conversation title
          conversation.workflowAboutType as WorkflowAboutType,
          conversation.workflowAboutId,
        );

      await this.conversationService.updateConversationWorkflowId(
        conversationId,
        workflowResult.workflowId,
        organizationId,
      );

      return workflowResult;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      throw new ConversationWorkflowError(
        `Failed to start workflow ${workflowType} for conversation ${conversationId}: ${errorMessage}`,
        {
          conversationId,
          workflowType,
          originalError: errorMessage,
        },
      );
    }
  }

  getSupportedWorkflowTypes(): string[] {
    return this.workflowTypeRegistry.getAllSupportedWorkflowTypes();
  }

  getWorkflowTypeInfo(workflowType: string) {
    if (!this.workflowTypeRegistry.isWorkflowTypeSupported(workflowType)) {
      return null;
    }

    return this.workflowTypeRegistry.getWorkflowConfig(
      workflowType as WorkflowName,
    );
  }

  getAllSupportedWorkflowConfigs() {
    return this.workflowTypeRegistry.getSupportedWorkflowConfigs();
  }
}
