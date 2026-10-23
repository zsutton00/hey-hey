// Activities for the new conversational flow system
// Note: Don't import log from @temporalio/workflow in activities - that's for workflows only
import { NotFoundException } from '@nestjs/common';
import {
  CategorySummarizationRun,
  SubfacetConsolidationRun,
  SubfacetSummarizationRun,
  SubfacetStatus,
  SummaryCategory,
} from '@prisma/client';
import { SYSTEM_USER } from 'src/constants';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { MessageStatus } from '../constants/message-status.constants';
import { withEventContext } from '../core/events/context-utils';
import {
  ConversationStatus,
  CreateConversationDto,
  CreateWorkTrackerImportConversationContext,
  CreateSystemMessage,
  InitiationType,
  MessageResponseDto,
  SystemMessageData,
  SystemMessageResponseType,
  WorkflowName,
} from '../generated';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../services/conversation.service';
import { InitiativeService } from '../services/initiatives/initiative.service';
import { MessageService } from '../services/message.service';
import { TopologyAuditService } from '../services/audit/topology-audit.service';
import { SubfacetService } from '../services/entity-summary/subfacet.service';
import { SummarizationService } from '../services/summarization/summarization.service';
import { SummarizationJobInput } from '../services/summarization/summarization.types';
import { CreateSuggestedTaskWorkflowInput } from './create-suggested-task.types';
import { CreateSuggestedDesignDocWorkflowInput } from './create-suggested-design-doc.types';
import { TaskDependencyInferenceWorkflowInput } from './task-dependency-inference.types';
import { PLAN_GENERATION_NODES } from '../flows/constants/node-ids';
import {
  buildOnboardingConversationContext,
  hasRepositoryGroundingTypedAnswers,
  mergeRepositoryGroundingAdditionalContext,
} from '../flows/nodes/onboarding/repository-grounding.contract';
import { mergeWorkTrackerImportAdditionalContext } from '../flows/nodes/work-tracker-import/work-tracker-import.contract';
import {
  FlowExecutionService,
  SavedExecutionStateDto,
} from '../services/workflows/flow-execution.service';
import { NodeExecutionService } from '../services/workflows/node-execution.service';
import { AgentOperationWorkflowAnswerService } from '../services/agent-operation/agent-operation-workflow-answer.service';
import {
  ConversationId,
  FlowExecutionId,
  MessageId,
  OrganizationId,
  PlanId,
  ProjectId,
  RequestId,
  TaskId,
  UserId,
  WorkflowAboutType,
  WorkflowId,
} from '../types';
import {
  ExternalAgentValidationError,
  FlowContext,
  FlowUserMessage,
  INode,
  InitiativeRefinementFlowContext,
  isCompletionCandidateMessage,
  isExternalAgentNode,
  isOpenerNode,
  isTypedNodeResult,
  NodeResult,
  NodeRoutingConfig,
  NodeType,
  OpenerNodeBase,
  SuggestedDesignDocFlowContext,
  SuggestedTaskFlowContext,
  TaskDependencyInferenceFlowContext,
  validateExternalAgentCompletion,
} from '../types/flow-internal.types';
import {
  getAppContextForWorker,
  workflowAboutTypeToEntityType,
} from '../utils';
import { createMutableContextHandle } from '../utils/mutable-context';
import { TemporalWinstonLogger } from './temporal-winston-logger';
import {
  buildDefaultConversationTitle,
  isDefaultConversationTitle,
} from '../utils/conversation-title';
import {
  flowContextToSerializableState,
  isSerializableWorkflowState,
  LLMResponsePayload,
  SerializableWorkflowState,
  WorkflowState,
  WorkflowStep,
  WriteableFlowContext,
} from './conversation-workflow-state';

const productionActivityLogger = new TemporalWinstonLogger();

// Helper function to create a scoped logger for activities. Production activity
// logs use the same stdout envelope as worker startup; tests retain readable
// console output without requiring a Temporal runtime.
function getLogger(context: string = 'TemporalActivity') {
  const isTestEnv =
    process.env.NODE_ENV === 'test' ||
    process.env.JEST_WORKER_ID !== undefined ||
    process.env.DATABASE_URL?.includes('test.db');

  return {
    debug: (message: string, meta?: Record<string, unknown>) => {
      // Always use console in test environments for better visibility
      if (isTestEnv) {
        console.log(`[DEBUG][${context}] ${message}`, meta || {});
      } else {
        productionActivityLogger.debug(`[${context}] ${message}`, {
          component: context,
          ...meta,
        });
      }
    },
    log: (message: string, meta?: Record<string, unknown>) => {
      if (isTestEnv) {
        console.log(`[INFO][${context}] ${message}`, meta || {});
      } else {
        productionActivityLogger.info(`[${context}] ${message}`, {
          component: context,
          ...meta,
        });
      }
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
      if (isTestEnv) {
        console.warn(`[WARN][${context}] ${message}`, meta || {});
      } else {
        productionActivityLogger.warn(`[${context}] ${message}`, {
          component: context,
          ...meta,
        });
      }
    },
    error: (message: string, error?: unknown) => {
      // Handle error objects properly for Temporal logger
      const errorMeta =
        error instanceof Error
          ? { error: error.message, stack: error.stack }
          : { error };
      if (isTestEnv) {
        console.error(`[ERROR][${context}] ${message}`, errorMeta);
      } else {
        productionActivityLogger.error(`[${context}] ${message}`, {
          component: context,
          ...errorMeta,
        });
      }
    },
  };
}

function toContextRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(value));
}

function buildCreateConversationDtoForFlow(params: {
  workflowId: WorkflowId;
  projectId: ProjectId;
  organizationId: OrganizationId;
  flowId: WorkflowName;
  initiatedBy: InitiationType;
  triggerEvent: string;
  title: string;
  workflowAboutId?: string;
  workflowAboutType?: WorkflowAboutType;
  status: ConversationStatus;
  additionalContext?: Record<string, unknown>;
}): CreateConversationDto {
  const base = {
    workflowId: params.workflowId,
    projectId: params.projectId,
    organizationId: params.organizationId,
    initiatedBy: params.initiatedBy,
    triggerEvent: params.triggerEvent,
    title: params.title,
    workflowAboutType: params.workflowAboutType,
    workflowAboutId: params.workflowAboutId,
    status: params.status,
  };

  const contextRecord = toContextRecord(params.additionalContext);

  switch (params.flowId) {
    case 'task-generation': {
      const aboutId =
        typeof contextRecord?.aboutId === 'string'
          ? contextRecord.aboutId
          : params.workflowAboutId;
      const aboutType =
        contextRecord?.aboutType === 'task' ||
        contextRecord?.aboutType === 'initiative'
          ? contextRecord.aboutType
          : params.workflowAboutType;

      if (!aboutId || (aboutType !== 'task' && aboutType !== 'initiative')) {
        throw new Error(
          'task-generation requires context.aboutId and context.aboutType (initiative|task)',
        );
      }

      return {
        ...base,
        workflowName: 'task-generation',
        context: {
          aboutId,
          aboutType,
        },
      };
    }
    case 'entity-conversation':
      return {
        ...base,
        workflowName: 'entity-conversation',
        context: {
          ...(typeof contextRecord?.entityId === 'string'
            ? { entityId: contextRecord.entityId }
            : {}),
          ...(typeof contextRecord?.entityType === 'string'
            ? { entityType: contextRecord.entityType }
            : {}),
        },
      };
    case 'adr':
      return { ...base, workflowName: 'adr', context: contextRecord ?? {} };
    case 'brainstorm-refinement':
      return {
        ...base,
        workflowName: 'brainstorm-refinement',
        context: contextRecord ?? {},
      };
    case 'decision-refinement':
      return {
        ...base,
        workflowName: 'decision-refinement',
        context: contextRecord ?? {},
      };
    case 'initiative-refinement':
      return {
        ...base,
        workflowName: 'initiative-refinement',
        context: contextRecord ?? {},
      };
    case 'onboarding':
      return {
        ...base,
        workflowName: 'onboarding',
        context: {},
      };
    case 'repository-import':
      return {
        ...base,
        workflowName: 'repository-import',
        context: buildOnboardingConversationContext(contextRecord),
      };
    case 'work-tracker-import':
      return {
        ...base,
        workflowName: 'work-tracker-import',
        context: (contextRecord ?? {
          entryMode: 'existing_project',
        }) as unknown as CreateWorkTrackerImportConversationContext,
      };
    case 'plan-from-design-doc':
      return {
        ...base,
        workflowName: 'plan-from-design-doc',
        context: contextRecord ?? {},
      } as unknown as CreateConversationDto;
    case 'project-conversation':
      return {
        ...base,
        workflowName: 'project-conversation',
        context: contextRecord ?? {},
      };
    case 'agent-session': {
      const aboutId = params.workflowAboutId;
      if (!aboutId) {
        throw new Error('agent-session requires workflowAboutId');
      }

      if (params.workflowAboutType !== 'agent-session') {
        throw new Error(
          'agent-session requires workflowAboutType=agent-session',
        );
      }

      return {
        ...base,
        workflowName: 'agent-session' as unknown as 'adr',
        workflowAboutId: aboutId,
        workflowAboutType: 'agent-session',
        context: {},
      } as CreateConversationDto;
    }
    case 'rfc':
      return { ...base, workflowName: 'rfc', context: contextRecord ?? {} };
    case 'task-prioritization':
      return {
        ...base,
        workflowName: 'task-prioritization',
        context: contextRecord ?? {},
      };
    case 'task-refinement':
      return {
        ...base,
        workflowName: 'task-refinement',
        context: contextRecord ?? {},
      };
    case 'daily-session': {
      const aboutId = params.workflowAboutId;
      if (!aboutId) {
        throw new Error('daily-session requires workflowAboutId (userId)');
      }
      return {
        ...base,
        workflowName: 'daily-session',
        workflowAboutId: aboutId,
        workflowAboutType: 'user' as const,
        context: contextRecord ?? {},
      };
    }
    case 'feature-sync': {
      // TODO: drop cast once OpenAPI emits a CreateFeatureSyncConversationDto
      // (same gap as the agent-session / agent-* branches below).
      return {
        ...base,
        workflowName: 'feature-sync' as unknown as 'adr',
        context: contextRecord ?? {},
      } as CreateConversationDto;
    }
    case 'feature-tree-conversation': {
      return {
        ...base,
        workflowName: 'feature-tree-conversation' as const,
        context: contextRecord ?? {},
      };
    }
    case 'session-monitor': {
      const aboutId = params.workflowAboutId;
      if (!aboutId) {
        throw new Error('session-monitor requires workflowAboutId');
      }
      return {
        ...base,
        workflowName: 'session-monitor' as unknown as 'adr',
        workflowAboutId: aboutId,
        workflowAboutType: params.workflowAboutType,
        context: {},
      } as CreateConversationDto;
    }
    case 'task-monitor': {
      const aboutId = params.workflowAboutId;
      if (!aboutId) {
        throw new Error('task-monitor requires workflowAboutId');
      }
      return {
        ...base,
        workflowName: 'task-monitor' as unknown as 'adr',
        workflowAboutId: aboutId,
        workflowAboutType: params.workflowAboutType,
        context: {},
      } as CreateConversationDto;
    }
    case 'agent-task-refining':
    case 'agent-entity-conversation':
    case 'goal-pm':
    case 'open-items-triage':
    case 'agent-project-conversation':
    case 'agent-design-doc-refining':
    case 'agent-search':
    case 'agent-proposal-refining': {
      const aboutId = params.workflowAboutId;
      if (!aboutId) {
        throw new Error(`${params.flowId} requires workflowAboutId`);
      }
      return {
        ...base,
        workflowName: params.flowId as unknown as 'adr',
        workflowAboutId: aboutId,
        workflowAboutType: params.workflowAboutType,
        context: {},
      } as CreateConversationDto;
    }
    default: {
      const exhaustive: never = params.flowId;
      throw new Error(
        `Unsupported workflow for conversation dto: ${exhaustive}`,
      );
    }
  }
}

// Wrapped with context reconstruction for comprehensive flow tracing
export const initializeConversationFlow = withEventContext(
  'initializeConversationFlow',
  async function ({
    projectId,
    organizationId,
    workflowId,
    flowId,
    userId,
    conversationId,
    initiatedBy,
    workflowAboutId,
    workflowAboutType,
    additionalContext,
  }: {
    projectId: ProjectId;
    organizationId: OrganizationId;
    workflowId: WorkflowId;
    flowId: WorkflowName;
    userId?: UserId;
    conversationId?: ConversationId;
    initiatedBy?: 'SYSTEM' | 'USER';
    workflowAboutId: string | undefined;
    workflowAboutType: WorkflowAboutType | undefined;
    additionalContext?: Record<string, unknown>;
  }): Promise<{
    context: FlowContext;
    startNode: string;
    hasOpener: boolean;
    executionId: FlowExecutionId;
    isResuming: boolean;
    savedWorkflowState?: SerializableWorkflowState;
  }> {
    const logger = getLogger('InitializeConversationFlow');
    logger.debug('[initializeConversationFlow] Starting with params', {
      projectId,
      organizationId,
      workflowId,
      flowId,
      userId,
      conversationId,
      initiatedBy,
      workflowAboutId,
      workflowAboutType,
    });

    // Allow undefined userId for system-initiated workflows, but require it for user-initiated ones
    if (!userId && initiatedBy === 'USER') {
      throw new Error('userId is required for user-initiated workflows');
    }

    const appContext = await getAppContextForWorker();

    const prismaService = appContext.get(PrismaService);
    const conversationService = appContext.get(ConversationService);
    const flowEngine = appContext.get(NodeExecutionService);
    const flowExecutionService = appContext.get(FlowExecutionService);
    logger.debug('[initializeConversationFlow] Service availability check', {
      prismaService: !!prismaService,
      conversationService: !!conversationService,
      flowEngine: !!flowEngine,
      flowExecutionService: !!flowExecutionService,
    });

    // Get flow to access its metadata
    const flow = flowEngine.getFlow(flowId);

    if (!flow) {
      throw new Error(`Could not find flow ${flowId}`);
    }

    const flowTitle = flow?.name || `${flowId} Flow`;

    // Create or load conversation for this flow
    let conversation;
    let existingExecution: SavedExecutionStateDto | null = null;

    if (conversationId) {
      // Resume existing conversation
      logger.debug(
        '[initializeConversationFlow] Loading existing conversation',
        {
          conversationId,
        },
      );

      try {
        conversation = await conversationService.getConversation(
          conversationId,
          organizationId,
        );

        if (!conversation) {
          throw new Error(`Conversation ${conversationId} not found`);
        }

        // Check for existing flow execution to resume from
        existingExecution = await flowExecutionService.findByConversation(
          conversationId,
          organizationId,
        );

        logger.debug(
          '[initializeConversationFlow] Successfully loaded existing conversation',
          {
            conversationId: conversation.id,
            workflowId: conversation.workflowId,
            conversationTitle: conversation.title,
            conversationStatus: conversation.status,
            hasExistingExecution: !!existingExecution,
            executionStatus: existingExecution?.status,
          },
        );
      } catch (error) {
        logger.error(
          '[initializeConversationFlow] Failed to load existing conversation',
          {
            conversationId,
            error: (error as Error).message,
          },
        );
        throw error;
      }
    } else {
      // Create new conversation for this flow
      const conversationDto = buildCreateConversationDtoForFlow({
        workflowId,
        projectId,
        organizationId,
        flowId,
        initiatedBy: InitiationType.System,
        triggerEvent: `flow_started_${flowId}`,
        title: flowTitle,
        workflowAboutType,
        workflowAboutId,
        status: ConversationStatus.Started,
        additionalContext,
      });

      logger.debug(
        '[initializeConversationFlow] Creating new conversation with DTO',
        {
          conversationDto,
        },
      );

      try {
        conversation = await conversationService.createConversation(
          conversationDto,
          organizationId,
        );

        if (conversation) {
          logger.debug(
            '[initializeConversationFlow] Successfully created conversation',
            {
              conversationId: conversation.id,
              conversationTitle: conversation.title,
              conversationStatus: conversation.status,
            },
          );
        }
      } catch (error) {
        logger.error(
          '[initializeConversationFlow] Error creating conversation',
          {
            error: (error as Error).message,
            stack: (error as Error).stack,
            conversationDto,
            organizationId,
          },
        );
        throw error;
      }
    }

    if (!conversation || !conversation.id) {
      logger.error(
        '[initializeConversationFlow] Failed to create conversation',
      );
      throw new Error(`Failed to create conversation for flow: ${flowId}`);
    }

    // Initialize or restore flow context
    let context: FlowContext;
    let startNode: string;
    let executionId: FlowExecutionId;

    if (
      existingExecution &&
      existingExecution.flowState &&
      existingExecution.resumable
    ) {
      // Detect if this execution was pre-created by startWorkflowByType for
      // THIS workflow. If so, it's not a genuine resume — the execution's
      // saved context will have the same workflowId as the current workflow.
      // A genuinely paused execution will have the OLD workflow's ID.
      const savedWorkflowId = isSerializableWorkflowState(
        existingExecution.flowState,
      )
        ? existingExecution.flowState.context?.core?.workflowId
        : (existingExecution.flowState as FlowContext)?.core?.workflowId;

      const isOwnExecution =
        savedWorkflowId != null && savedWorkflowId === workflowId;
      if (isOwnExecution) {
        logger.log(
          '[initializeConversationFlow] Execution was pre-created for this workflow — skipping resume',
          {
            executionId: existingExecution.id,
            workflowId,
            savedWorkflowId,
            status: existingExecution.status,
          },
        );
        // Fall through to fresh initialization below
        existingExecution = null;
      }
    }

    if (
      existingExecution &&
      existingExecution.flowState &&
      existingExecution.resumable
    ) {
      // Check if this is a resumable incomplete workflow
      const isIncomplete = existingExecution.status === 'IN_PROGRESS';

      // Handle legacy FlowContext format - convert to SerializableWorkflowState
      let savedState: SerializableWorkflowState;

      if (isSerializableWorkflowState(existingExecution.flowState)) {
        savedState = existingExecution.flowState;
      } else {
        // Legacy format - convert FlowContext to SerializableWorkflowState
        logger.debug(
          '[initializeConversationFlow] Converting legacy FlowContext to SerializableWorkflowState',
          {
            executionId: existingExecution.id,
            currentNode: existingExecution.currentNode,
          },
        );

        savedState = flowContextToSerializableState(
          existingExecution.flowState,
          existingExecution.currentNode || flow.startNode,
          undefined,
        );
      }

      if (isIncomplete) {
        // Resume incomplete workflow - return saved state
        logger.debug(
          '[initializeConversationFlow] Resuming incomplete workflow',
          {
            executionId: existingExecution.id,
            savedStep: savedState.step,
            savedPhase: savedState.phase,
            currentNode: existingExecution.currentNode,
            status: existingExecution.status,
          },
        );

        savedState = {
          ...savedState,
          context: savedState.context,
        };
        savedState.context.core.workflowId = workflowId;

        // Update the execution to mark it as resumed
        await flowExecutionService.updateFlowState(
          existingExecution.id as FlowExecutionId,
          organizationId,
          {
            flowState: savedState,
            status: 'IN_PROGRESS',
          },
        );

        const resumeNodeId = existingExecution.currentNode || flow.startNode;
        const resumeNodeData = flowEngine.getNode(flowId, resumeNodeId);

        return {
          context: savedState.context,
          startNode: resumeNodeId,
          hasOpener: resumeNodeData?.node.type === NodeType.OPENER,
          executionId: existingExecution.id as FlowExecutionId,
          isResuming: true,
          savedWorkflowState: savedState,
        };
      } else {
        // Completed workflow - start fresh but with existing conversation context
        logger.debug(
          '[initializeConversationFlow] Starting new workflow on completed conversation',
          {
            existingExecutionId: existingExecution.id,
            previousStatus: existingExecution.status,
            wasLegacyFormat: !isSerializableWorkflowState(
              existingExecution.flowState,
            ),
          },
        );

        // Use context from converted savedState (already handled legacy conversion above)
        context = savedState.context;
        startNode = flow.startNode; // Start from beginning for new workflow

        // Clear stale routing/path state from the previous execution
        const mutableContext = context as WriteableFlowContext;
        mutableContext.core.workflowId = workflowId;
        mutableContext.pendingTransition = undefined;
        if (mutableContext.flowPath) {
          mutableContext.flowPath.pathTaken = [];
          mutableContext.flowPath.previousNode = undefined;
          mutableContext.flowPath.previousTransition = undefined;
        }

        // Refresh lastSystemMessageId from the database — the conversation
        // has existing messages and the new opener needs to thread correctly.
        // The old value may be stale if messages were added after the
        // execution completed.
        const messageService = appContext.get(MessageService);
        const lastSystemMessage = await messageService.getLastSystemMessage(
          conversation.id,
          organizationId,
        );
        mutableContext.lastSystemMessageId =
          (lastSystemMessage?.id as MessageId) || undefined;

        logger.debug(
          '[initializeConversationFlow] Refreshed lastSystemMessageId for completed conversation restart',
          {
            previousLastSystemMessageId: savedState.context.lastSystemMessageId,
            newLastSystemMessageId: mutableContext.lastSystemMessageId,
          },
        );

        context = mutableContext;

        if (flowId === WorkflowName.RepositoryImport) {
          context = mergeRepositoryGroundingAdditionalContext(
            context,
            additionalContext,
          );
        }
        if (flowId === WorkflowName.WorkTrackerImport) {
          context = mergeWorkTrackerImportAdditionalContext(
            context,
            additionalContext,
          );
        }

        // Reset conversation status so message processing pipeline picks up new messages
        await conversationService.updateConversationInternal(
          conversation.id,
          organizationId,
          { status: ConversationStatus.InProgress },
        );

        // Create NEW execution for the new workflow run
        const execution = await flowExecutionService.createFlowExecution({
          userId: userId || SYSTEM_USER,
          flowId,
          organizationId,
          projectId,
          conversationId: conversation.id,
          entityType: workflowAboutTypeToEntityType(
            conversation.workflowAboutType as WorkflowAboutType,
          ),
          entityId: conversation.workflowAboutId,
          currentNode: startNode,
          totalNodes: Object.keys(flow.nodes).length,
          flowState: flowContextToSerializableState(
            context,
            startNode,
            savedState.lastUserMessageId,
          ),
          resumable: true,
        });

        executionId = execution.id;

        logger.debug(
          '[initializeConversationFlow] Created new execution for continued conversation',
          {
            newExecutionId: executionId,
            previousExecutionId: existingExecution.id,
            flowId,
            startNode,
          },
        );
      }
    } else {
      if (!workflowAboutId || !workflowAboutType) {
        throw new Error(
          '[initializeConversationFlow] workflowAboutId and workflowAboutType are required for new conversations',
        );
      }

      // Create new flow context
      const baseContext: FlowContext = {
        core: {
          workflowId,
          projectId: projectId,
          organizationId: organizationId,
          conversationId: conversation.id,
          workflowAboutType,
          workflowAboutId,
          user: {
            id: userId ?? SYSTEM_USER,
            role: 'member',
          },
          session: {
            startTime: new Date(),
            interactionCount: 0,
          },
        },
        flowId,
        lastSystemMessageId: undefined, // Initialize as undefined
        flowPath: {
          pathTaken: [], // Will be populated with first node
          previousNode: undefined,
          previousTransition: undefined,
        },
      };

      // Apply flow-specific initial context transformation if defined
      if (flow.initialContextTransform) {
        logger.debug(
          '[initializeConversationFlow] Applying initial context transform',
          {
            flowId,
            workflowAboutId,
            workflowAboutType,
          },
        );

        const appContext = await getAppContextForWorker();
        context = await flow.initialContextTransform(
          baseContext,
          workflowAboutId,
          workflowAboutType,
          appContext,
        );

        logger.debug(
          '[initializeConversationFlow] Initial context transform complete',
          {
            transformedContext: context,
          },
        );
      } else {
        context = baseContext;
      }

      if (flowId === WorkflowName.RepositoryImport) {
        context = mergeRepositoryGroundingAdditionalContext(
          context,
          additionalContext,
        );
      }
      if (flowId === WorkflowName.WorkTrackerImport) {
        context = mergeWorkTrackerImportAdditionalContext(
          context,
          additionalContext,
        );
      }

      startNode = flow.startNode;

      // Extract entity information from conversation for tracking
      const entityType = workflowAboutTypeToEntityType(
        conversation.workflowAboutType as WorkflowAboutType,
      );
      const entityId = conversation.workflowAboutId;

      // Create new flow execution record
      const execution = await flowExecutionService.createFlowExecution({
        userId: userId || SYSTEM_USER,
        flowId,
        organizationId,
        projectId,
        conversationId: conversation.id,
        entityType,
        entityId,
        currentNode: startNode,
        totalNodes: Object.keys(flow.nodes).length,
        flowState: flowContextToSerializableState(
          context,
          startNode,
          undefined,
        ),
        resumable: true,
      });

      executionId = execution.id;

      logger.debug('[initializeConversationFlow] Created new flow execution', {
        executionId,
        flowId,
        startNode,
        entityType,
        entityId,
      });
    }
    // Get the node instance to check its type
    const startNodeData = flowEngine.getNode(flowId, startNode);

    logger.debug('[initializeConversationFlow] Returning', {
      context,
      startNode,
      hasOpener: startNodeData?.node.type === NodeType.OPENER,
      nodeType: startNodeData?.node.type,
    });

    return {
      context,
      startNode,
      hasOpener: startNodeData?.node.type === NodeType.OPENER,
      executionId,
      isResuming: false,
      savedWorkflowState: undefined,
    };
  },
);

// Wrapped with context reconstruction for flow node execution tracing
export const executeFlowNode = withEventContext(
  'executeFlowNode',
  async function ({
    flowId,
    nodeId,
    context,
    userMessage,
    lastUserMessageId,
  }: {
    flowId: string;
    nodeId: string;
    context: WriteableFlowContext;
    userMessage: FlowUserMessage | undefined;
    lastUserMessageId: MessageId | undefined;
  }): Promise<{
    requestId: RequestId;
    updatedContext: FlowContext;
    immediateResponse?: LLMResponsePayload;
  }> {
    const logger = getLogger('ExecuteFlowNode');
    logger.debug('[executeFlowNode] Starting node execution', {
      flowId,
      nodeId,
      context,
      userMessage,
    });

    const appContext = await getAppContextForWorker();
    const flowEngine = appContext.get(NodeExecutionService);

    const flow = flowEngine.getFlow(flowId);
    if (!flow) {
      throw new Error(`Flow ${flowId} not found`);
    }

    const nodeData = flowEngine.getNode(flowId, nodeId);
    if (!nodeData?.node) {
      const availableNodes = Object.keys(flow.nodes ?? {});
      throw new Error(
        `Node ${nodeId} not found in flow ${flowId}. Available nodes: ${availableNodes.join(', ')}`,
      );
    }
    const { node } = nodeData;

    logger.debug('[executeFlowNode] Executing flow node', {
      flowId,
      nodeId: node.id,
      nodeType: node.type,
    });

    // Generate a unique request ID for this node execution
    const requestId = uuidv4() as RequestId;

    // Determine message creation strategy
    let parentMessageId: MessageId | undefined;
    let useAppendMessage = true; // Default to append for sequential conversation flow
    let parentChoiceReason:
      | 'synthetic_control'
      | 'real_user_message'
      | 'append_no_user_message';

    if (userMessage?.id) {
      // Check if this is a synthetic control message
      const isSyntheticMessage =
        userMessage.userId === 'system' && userMessage.data?.type === 'CONTROL';

      if (isSyntheticMessage) {
        // Synthetic control messages should not be used as parent messages
        // since they may not exist in the database
        parentMessageId = undefined;
        useAppendMessage = true;
        parentChoiceReason = 'synthetic_control';
      } else {
        // When responding to a real user message, use explicit parent for precise threading
        parentMessageId = userMessage.id;
        useAppendMessage = false;
        parentChoiceReason = 'real_user_message';
      }
    } else {
      parentChoiceReason = 'append_no_user_message';
    }

    logger.debug('[executeFlowNode] Message creation strategy', {
      nodeId: node.id,
      nodeType: node.type,
      useAppendMessage,
      parentMessageId,
      hasUserMessage: !!userMessage,
      userMessageId: userMessage?.id,
      lastUserMessageId,
    });

    // Structured parent-choice event — one per node start. Captures the
    // branch the prior-system-vs-user-message resolution took so a fork on a
    // shared `beforeMessageId` upstream can be traced back to which node
    // execution picked which parent.
    logger.log('[executeFlowNode] Parent-choice resolved', {
      event: 'workflow.execute_flow_node.parent_choice',
      currentNodeId: node.id,
      nodeType: node.type,
      previousLastSystemMessageId: context.lastSystemMessageId ?? null,
      userMessageId: userMessage?.id ?? null,
      chosenParent: parentMessageId ?? null,
      reason: parentChoiceReason,
      useAppendMessage,
    });

    // Use FlowEngineService to orchestrate message creation and job queuing.
    // For EXTERNAL_AGENT nodes, startFlowNode skips the job (job === undefined)
    // and returns an immediateResponse that mirrors the LLMResponsePayload the
    // worker would have signaled; the workflow caller pre-populates
    // state.pendingLLMResponse from it so the existing wait loop resolves.
    const { job, message, immediateResponse } = await flowEngine.startFlowNode({
      node,
      context,
      conversationId: context.core.conversationId,
      workflowId: context.core.workflowId,
      projectId: context.core.projectId,
      organizationId: context.core.organizationId,
      requestId,
      userMessageId: lastUserMessageId,
      parentMessageId,
      options: {
        appendMessage: useAppendMessage,
      },
    });

    // Update the context with the new system message ID for future parentMessageId linking
    const previousLastSystemMessageId = context.lastSystemMessageId;
    context.lastSystemMessageId = message.id;

    logger.debug(
      '[executeFlowNode] Updated context with new system message ID',
      {
        previousLastSystemMessageId,
        newSystemMessageId: context.lastSystemMessageId,
        messageId: message.id,
        nodeId: node.id,
        nodeType: node.type,
      },
    );

    logger.debug('[executeFlowNode] Started flow node execution with message', {
      jobId: job?.id ?? null,
      hasImmediateResponse: !!immediateResponse,
      message,
      requestId,
      nodeId: node.id,
      nodeType: node.type,
      conversationId: context.core.conversationId,
    });

    return { requestId, updatedContext: context, immediateResponse };
  },
);

/**
 * Phase 1: Generate content for two-phase nodes without determining next node routing
 * - LLM_QUESTIONS nodes: Generate questions for user input
 * - GENERATE nodes: Generate content for user review
 */
export async function generateNodeContent({
  flowId,
  nodeId,
  context,
  userMessage,
  lastUserMessageId,
}: {
  flowId: string;
  nodeId: string;
  context: WriteableFlowContext;
  userMessage?: FlowUserMessage;
  lastUserMessageId?: MessageId;
}): Promise<{
  requestId: RequestId;
  updatedContext: FlowContext;
  immediateResponse?: LLMResponsePayload;
}> {
  const logger = getLogger('generateNodeContent');
  logger.debug('[generateNodeContent] Starting question generation', {
    flowId,
    nodeId,
    contextKeys: Object.keys(context),
    hasUserMessage: !!userMessage,
  });

  const appContext = await getAppContextForWorker();
  const flowEngine = appContext.get(NodeExecutionService);

  // Get node configuration
  const nodeData = flowEngine.getNode(flowId, nodeId);
  if (!nodeData?.node) {
    const flow = flowEngine.getFlow(flowId);
    const availableNodes = flow ? Object.keys(flow.nodes ?? {}) : [];
    throw new Error(
      `Node ${nodeId} not found in flow ${flowId}. Available nodes: ${availableNodes.join(', ')}`,
    );
  }
  const { node } = nodeData;

  // Check if this is a two-phase node (LLM_QUESTIONS or GENERATE type)
  if (node.type !== NodeType.LLM_QUESTIONS && node.type !== NodeType.GENERATE) {
    logger.warn(
      '[generateNodeContent] Node is not a LLM_QUESTIONS or GENERATE type, using regular execution',
      {
        nodeId,
        nodeType: node.type,
      },
    );
    // Fall back to regular execution for non-two-phase nodes
    return executeFlowNode({
      flowId,
      nodeId,
      context,
      userMessage,
      lastUserMessageId,
    });
  }

  const requestId = uuidv4() as RequestId;

  // Determine parent message ID
  let parentMessageId: MessageId | undefined;
  if (userMessage?.id) {
    // When responding to a user message, the system response should have the user message as parent
    parentMessageId = userMessage.id;
  }

  const effectiveParentMessageId =
    parentMessageId || context.lastSystemMessageId;

  logger.debug('[generateNodeContent] Parent message ID resolution', {
    userMessageParentId: parentMessageId,
    contextLastSystemMessageId: context.lastSystemMessageId,
    effectiveParentMessageId,
    nodeId,
    nodeType: node.type,
    hasUserMessage: !!userMessage,
    userMessageId: userMessage?.id,
  });

  // Use FlowEngineService to orchestrate message creation and job queuing.
  // For EXTERNAL_AGENT nodes, job is undefined and immediateResponse carries
  // the LLMResponsePayload-shaped trigger result.
  const { job, message, immediateResponse } = await flowEngine.startFlowNode({
    node,
    context,
    conversationId: context.core.conversationId,
    workflowId: context.core.workflowId,
    projectId: context.core.projectId,
    organizationId: context.core.organizationId,
    requestId,
    userMessageId: lastUserMessageId,
    parentMessageId: effectiveParentMessageId,
  });

  // Update the context with the new system message ID for future parentMessageId linking
  const previousLastSystemMessageId = context.lastSystemMessageId;
  context.lastSystemMessageId = message.id;

  logger.debug(
    '[generateNodeContent] Updated context with new system message ID',
    {
      previousLastSystemMessageId,
      newSystemMessageId: context.lastSystemMessageId,
      messageId: message.id,
      nodeId: node.id,
      nodeType: node.type,
    },
  );

  logger.debug('[generateNodeContent] Started question generation job', {
    jobId: job?.id ?? null,
    hasImmediateResponse: !!immediateResponse,
    requestId,
    nodeId,
    nodeType: node.type,
    conversationId: context.core.conversationId,
  });

  return { requestId, updatedContext: context, immediateResponse };
}

export async function nodeNeedsTwoPhaseExecution({
  flowId,
  nodeId,
}: {
  flowId: string;
  nodeId: string;
}): Promise<boolean> {
  const logger = getLogger('NodeNeedsTwoPhaseExecution');
  logger.debug(
    '[nodeNeedsTwoPhaseExecution] Checking if node supports two-phase execution',
    {
      flowId,
      nodeId,
    },
  );

  const appContext = await getAppContextForWorker();
  const flowEngine = appContext.get(NodeExecutionService);

  // Get node configuration
  const nodeData = flowEngine.getNode(flowId, nodeId);
  if (!nodeData?.node) {
    const flow = flowEngine.getFlow(flowId);
    const availableNodes = flow ? Object.keys(flow.nodes ?? {}) : [];
    throw new Error(
      `Node ${nodeId} not found in flow ${flowId}. Available nodes: ${availableNodes.join(', ')}`,
    );
  }
  const { node } = nodeData;

  // LLM_QUESTIONS, GENERATE, FINALIZE, and CLASSIFICATION nodes are inherently two-phase:
  // LLM_QUESTIONS: generate questions → process responses
  // GENERATE: generate content → process user interaction
  // FINALIZE: show completion summary → wait for user confirmation → complete workflow
  // CLASSIFICATION: analyze user message → route based on classification
  const needsTwoPhase = node.twoPhase;

  logger.debug(
    '[nodeNeedsTwoPhaseExecution] Two-phase execution check result',
    {
      nodeId,
      needsTwoPhase,
      nodeType: node.type,
      hasPostProcess: !!node.determineRouting,
    },
  );

  return needsTwoPhase;
}

/**
 * Runs node-level user response side effects without routing.
 * Used when workflow control flow already has a predetermined transition.
 */
export async function processNodeUserResponseHook({
  flowId,
  nodeId,
  context,
  userMessage,
}: {
  flowId: string;
  nodeId: string;
  context: FlowContext;
  userMessage: FlowUserMessage;
}): Promise<{ updatedContext: FlowContext }> {
  const logger = getLogger('ProcessNodeUserResponseHook');

  const appContext = await getAppContextForWorker();
  const flowEngine = appContext.get(NodeExecutionService);

  const nodeData = flowEngine.getNode(flowId, nodeId);
  if (!nodeData?.node) {
    const flow = flowEngine.getFlow(flowId);
    const availableNodes = flow ? Object.keys(flow.nodes ?? {}) : [];
    throw new Error(
      `Node ${nodeId} not found in flow ${flowId}. Available nodes: ${availableNodes.join(', ')}`,
    );
  }

  const { node } = nodeData;
  logger.debug(
    '[processNodeUserResponseHook] Processing side-effect hook for user response',
    {
      flowId,
      nodeId,
      hasProcessUserResponse: !!node.processUserResponse,
      hasUserMessage: !!userMessage,
    },
  );

  if (!node.processUserResponse) {
    return { updatedContext: context };
  }

  const tracker = createMutableContextHandle(context);
  await node.processUserResponse(tracker, userMessage);
  return { updatedContext: tracker.getContext() };
}

/**
 * Returns a resolved nextNodeId when the current node is an EXTERNAL_AGENT
 * and the incoming message is a valid completion candidate — either an
 * agent-authored completion row or an action-bearing user button click
 * (Approve / Continue Refining). Authorship is not the discriminator; the
 * action map (`validateExternalAgentCompletion`) enforces the real contract.
 * Returns `undefined` to fall through to normal routing (non-EXTERNAL_AGENT
 * node or a CONTROL message).
 *
 * Throws ExternalAgentValidationError on unknown/missing action or payloads
 * that fail the node's declared schema, so the engine stays paused on the
 * current node and the external agent can retry.
 *
 * Isolating this in a helper keeps the `isExternalAgentNode` type
 * narrowing scoped here and prevents it from stripping optional members
 * off `node` in the rest of processNodeResponse.
 */
async function resolveExternalAgentRouting(params: {
  node: INode;
  nodeId: string;
  userMessage: FlowUserMessage;
  routing: NodeRoutingConfig;
  context: FlowContext;
  logger: ReturnType<typeof getLogger>;
}): Promise<{ nextNodeId: string; parkOnUserResponse: boolean } | undefined> {
  const { node, nodeId, userMessage, routing, context, logger } = params;
  if (
    !isExternalAgentNode(node) ||
    !isCompletionCandidateMessage(userMessage)
  ) {
    return undefined;
  }

  const userData = userMessage.data;
  const typedRepositoryGroundingAction =
    userData &&
    typeof userData === 'object' &&
    !Array.isArray(userData) &&
    hasRepositoryGroundingTypedAnswers(userData as Record<string, unknown>);

  if (node.acceptsUserMessages === true && typedRepositoryGroundingAction) {
    if (node.determineRoutingFromUserMessage) {
      const nextNodeId = await node.determineRoutingFromUserMessage(
        context,
        userMessage,
      );
      logger.debug(
        `[processNodeResponse] EXTERNAL_AGENT typed user action node=${nodeId} nextNodeId=${nextNodeId}`,
      );
      return { nextNodeId, parkOnUserResponse: false };
    }
    return { nextNodeId: nodeId, parkOnUserResponse: false };
  }

  // Free-text reply self-loop: when a node opts into free-text replies via
  // `acceptsUserMessages: true` (review surfaces — feature-sync,
  // plan-from-design-doc, refine-stage), an actionless completion-candidate
  // USER message reaching it is a legitimate completion shape, not a
  // validation failure. The node's `processUserResponse` already stashed the
  // reply onto context for the next `buildTriggerMessage` to consume. Skip
  // the validator entirely and self-loop the node — see the inverse-rule
  // requirement on the CLI Run Input Dispatch feature.
  if (
    node.acceptsUserMessages === true &&
    (userMessage.data as { action?: unknown } | undefined)?.action == null
  ) {
    logger.debug(
      `[processNodeResponse] EXTERNAL_AGENT free-text reply self-loop node=${nodeId}`,
    );
    return { nextNodeId: nodeId, parkOnUserResponse: false };
  }

  try {
    const { action } = validateExternalAgentCompletion({
      nodeId,
      actions: node.actions,
      message: userMessage,
    });

    if (node.determineRoutingFromAgentCompletion) {
      const overrideNextNodeId = await node.determineRoutingFromAgentCompletion(
        context,
        action,
      );
      if (overrideNextNodeId) {
        logger.debug(
          `[processNodeResponse] EXTERNAL_AGENT hook-routed node=${nodeId} action=${action} nextNodeId=${overrideNextNodeId}`,
        );
        return { nextNodeId: overrideNextNodeId, parkOnUserResponse: false };
      }
    }

    const perActionTransition = routing.transitions?.[action];
    const defaultTransition = routing.transitions?.default;
    const resolvedTransition = perActionTransition ?? defaultTransition;
    const resolvedNextNodeId = resolvedTransition?.nextNodeId;
    if (!resolvedNextNodeId) {
      throw new Error(
        `[processNodeResponse] EXTERNAL_AGENT node=${nodeId} has no transition for action=${action} and no default transition`,
      );
    }

    logger.debug(
      `[processNodeResponse] EXTERNAL_AGENT routed node=${nodeId} action=${action} nextNodeId=${resolvedNextNodeId} matchedPerAction=${!!perActionTransition} parkOnUserResponse=${!!resolvedTransition?.parkOnUserResponse}`,
    );
    return {
      nextNodeId: resolvedNextNodeId,
      parkOnUserResponse: !!resolvedTransition?.parkOnUserResponse,
    };
  } catch (error) {
    if (error instanceof ExternalAgentValidationError) {
      logger.warn(
        `[processNodeResponse] EXTERNAL_AGENT validation rejected node=${nodeId} action=${error.action ?? '(none)'} reason=${error.reason}`,
        { issues: error.issues },
      );
    }
    throw error;
  }
}

/**
 * Phase 2: Process user response and determine next node routing
 * Used after user responds to questions from generateNodeContent
 */
export async function processNodeResponse({
  flowId,
  nodeId,
  context,
  userMessage,
}: {
  flowId: string;
  nodeId: string;
  context: FlowContext;
  userMessage: FlowUserMessage;
}): Promise<{
  nextNodeId: string;
  updatedContext: FlowContext;
  parkOnUserResponse?: boolean;
}> {
  const logger = getLogger('ProcessNodeResponse');

  const appContext = await getAppContextForWorker();
  const flowEngine = appContext.get(NodeExecutionService);

  // Get node configuration
  const nodeData = flowEngine.getNode(flowId, nodeId);
  if (!nodeData?.node || !nodeData.routing) {
    const flow = flowEngine.getFlow(flowId);
    const availableNodes = flow ? Object.keys(flow.nodes ?? {}) : [];
    throw new Error(
      `Node ${nodeId} configuration missing in flow ${flowId}. Available nodes: ${availableNodes.join(', ')}`,
    );
  }
  const { node, routing } = nodeData;
  const resolveWorkflowAnswerOutcome = async (
    nextNodeId: string,
    parkOnUserResponse = false,
  ): Promise<void> => {
    const operationId = userMessage.workflowAnswerOperationId;
    if (!operationId) return;
    const nextNode = flowEngine.getNode(flowId, nextNodeId)?.node;
    if (!parkOnUserResponse && nextNode && isExternalAgentNode(nextNode)) {
      return;
    }
    const workflowAnswerService = appContext.get(
      AgentOperationWorkflowAnswerService,
      { strict: false },
    );
    await workflowAnswerService.succeedWithoutTrigger(operationId, {
      resolution: 'NO_TRIGGER',
      nextNodeId,
      parked: parkOnUserResponse,
    });
  };
  logger.debug('[processNodeResponse] Processing user response for routing', {
    flowId,
    nodeId,
    userMessage,
  });

  const tracker = createMutableContextHandle(context);
  if (node.processUserResponse) {
    await node.processUserResponse(tracker, userMessage);
  }
  const updatedContext = tracker.getContext();

  // Start with default routing
  let nextNodeId = routing.nextNode;

  if (!nextNodeId) {
    if (routing.transitions?.default) {
      nextNodeId = routing.transitions.default.nextNodeId;
    }
  }

  // EXTERNAL_AGENT: agent-authored completion messages carry a structured
  // `action` discriminator whose payload must validate against the node's
  // declared `actions` schemas. Malformed or unknown actions surface an
  // ExternalAgentValidationError so the node stays paused and the CLI can
  // retry with a well-formed message.
  const externalAgentRouting = await resolveExternalAgentRouting({
    node,
    nodeId,
    userMessage,
    routing,
    context: updatedContext,
    logger,
  });
  if (externalAgentRouting) {
    await resolveWorkflowAnswerOutcome(
      externalAgentRouting.nextNodeId,
      externalAgentRouting.parkOnUserResponse,
    );
    return {
      nextNodeId: externalAgentRouting.nextNodeId,
      updatedContext,
      parkOnUserResponse: externalAgentRouting.parkOnUserResponse,
    };
  }

  // 1. First try determineRoutingFromUserMessage logic (existing hard-coded routing)
  if (node.determineRoutingFromUserMessage) {
    logger.debug(
      `[processNodeResponse] determineRoutingFromUserMessage node=${nodeId} hasUserMessage=${!!userMessage} }`,
    );

    try {
      const nextNodeIdFromRouting = await node.determineRoutingFromUserMessage(
        updatedContext,
        userMessage,
      );
      logger.debug(
        `[processNodeResponse] determineRoutingFromUserMessage result node=${nodeId} result=${nextNodeIdFromRouting}`,
      );

      if (nextNodeIdFromRouting) {
        await resolveWorkflowAnswerOutcome(nextNodeIdFromRouting);
        nextNodeId = nextNodeIdFromRouting;
        logger.debug(
          `[processNodeResponse] determineRoutingFromUserMessage override node=${nodeId} originalNext=${routing.nextNode} overrideNext=${nextNodeId}`,
        );
        // Return early if determineRoutingFromUserMessage provided routing
        return { nextNodeId: nextNodeIdFromRouting, updatedContext };
      }
    } catch (error) {
      logger.error(
        `[processNodeResponse] determineRoutingFromUserMessage failed node=${nodeId} errorType=${(error as Error).constructor.name}`,
        { error },
      );
      // Continue with default routing on determineRoutingFromUserMessage error
    }
  }

  logger.debug(
    `[processNodeResponse] routing decision completed node=${nodeId} nextNodeId=${nextNodeId} defaultRoute=${routing.nextNode}`,
  );

  if (!nextNodeId) {
    throw new Error(
      `[processNodeResponse] No nextNodeId resolved for node=${nodeId} flow=${flowId}`,
    );
  }

  await resolveWorkflowAnswerOutcome(nextNodeId);

  return { nextNodeId, updatedContext };
}

export async function createSystemMessage({
  conversationId,
  organizationId,
  nodeResult,
  nodeId,
  flowId,
  context,
  parentMessageId,
}: {
  conversationId: ConversationId;
  organizationId: OrganizationId;
  nodeResult: NodeResult;
  nodeId: string;
  flowId: string;
  context: WriteableFlowContext;
  parentMessageId?: MessageId;
}): Promise<void> {
  const logger = getLogger('CreateSystemMessage');
  logger.debug('Creating system message', {
    conversationId,
    organizationId,
    nodeResult,
    nodeId,
    flowId,
    context,
  });

  const appContext = await getAppContextForWorker();
  const messageService = appContext.get(MessageService);
  const conversationService = appContext.get(ConversationService);
  const flowEngine = appContext.get(NodeExecutionService);

  // Get conversation to extract required fields
  const conversation = await conversationService.getConversation(
    conversationId,
    organizationId,
  );
  if (!conversation) {
    throw new Error(`Conversation ${conversationId} not found`);
  }
  if (!conversation.workflowId) {
    throw new Error(
      `Conversation ${conversationId} is missing workflowId for system message creation`,
    );
  }
  const workflowId = conversation.workflowId;

  // Get the flow and node to access title
  const nodeData = flowEngine.getNode(flowId, nodeId);
  const nodeTitle = nodeData?.node?.title || nodeId;

  // Create system message with flow data
  // Map NodeType to SystemMessageResponseType and add type field to data
  let systemMessageType: SystemMessageResponseType;

  if (isTypedNodeResult(nodeResult)) {
    switch (nodeResult.type) {
      case NodeType.OPENER:
      case NodeType.QUESTIONS:
      case NodeType.LLM_QUESTIONS:
        // All question types render the same in UI - distinction is only backend concern
        systemMessageType = SystemMessageResponseType.Questions;
        break;
      case NodeType.ANALYZE:
        systemMessageType = SystemMessageResponseType.Analysis;
        break;
      case NodeType.NOOP:
        systemMessageType = SystemMessageResponseType.Noop;
        break;
      case NodeType.GENERATE:
        systemMessageType = SystemMessageResponseType.Initiatives;
        break;
      case NodeType.CLASSIFICATION:
        systemMessageType = SystemMessageResponseType.Analysis;
        break;
      case NodeType.ERROR:
        systemMessageType = SystemMessageResponseType.Error;
        break;
      case NodeType.ROUTING:
        systemMessageType = SystemMessageResponseType.Routing;
        break;
      default:
        systemMessageType = SystemMessageResponseType.Questions;
    }
  } else {
    // Fallback for non-typed results
    systemMessageType = SystemMessageResponseType.Questions;
  }

  // Pre-generate the SYSTEM message id so any `triggersAgent` body can be
  // stamped with `triggerMessageId` matching the row it will land on. This
  // is the persistence seam the Trigger Payload Context design doc calls
  // out: stamp at create time, then `TriggerEmitter` validates the persisted
  // body has `triggerMessageId === messageId` before signing. Producer
  // nodes return `UnstampedAgentTrigger`; this is the one place that knows
  // the row id, so this is where the id gets fused in.
  const pregeneratedMessageId = uuidv4() as MessageId;

  const systemMessageBase = {
    id: pregeneratedMessageId,
    workflowId,
    projectId: conversation.projectId,
    type: 'SYSTEM' as const,
    userId: 'system',
    data: (() => {
      const baseData = {
        detectedIntent: '',
        intentConfidence: 0,
        type: systemMessageType as SystemMessageData['type'],
        response: nodeResult.message,
        nodeId,
        flowId,
        title: typeof nodeTitle === 'string' ? nodeTitle : 'title',
      };

      if (
        systemMessageType === SystemMessageResponseType.Error ||
        systemMessageType === SystemMessageResponseType.Noop
      ) {
        return baseData as SystemMessageData;
      }

      const uiElements = Array.isArray(nodeResult.uiElements)
        ? nodeResult.uiElements
        : undefined;
      const actions = nodeResult.actions;
      const triggersAgent = nodeResult.triggersAgent
        ? ({
            ...nodeResult.triggersAgent,
            triggerMessageId: pregeneratedMessageId,
          } as SystemMessageData['triggersAgent'])
        : undefined;

      return {
        ...baseData,
        ...(uiElements ? { uiElements } : {}),
        ...(actions ? { actions } : {}),
        ...(triggersAgent ? { triggersAgent } : {}),
      } as SystemMessageData;
    })(),
    status: MessageStatus.Open,
  };
  const systemMessageDataForLog =
    systemMessageBase.data as SystemMessageData & {
      triggersAgent?: {
        promptType?: unknown;
        nodeId?: unknown;
        triggerMessageId?: unknown;
      };
      uiElements?: Array<{ type?: unknown }>;
      response?: unknown;
    };
  const triggerForLog = systemMessageDataForLog.triggersAgent;
  const uiElementsForLog = Array.isArray(systemMessageDataForLog.uiElements)
    ? systemMessageDataForLog.uiElements
    : [];
  productionActivityLogger.debug(
    '[createSystemMessage] Persisting SYSTEM message diagnostic',
    {
      event: 'workflow.create_system_message.diagnostic',
      conversationId,
      workflowId,
      flowId,
      nodeId,
      messageId: pregeneratedMessageId,
      parentMessageId,
      status: systemMessageBase.status,
      responseType: systemMessageDataForLog.type,
      responseLength:
        typeof systemMessageDataForLog.response === 'string'
          ? systemMessageDataForLog.response.length
          : undefined,
      uiElementTypes: uiElementsForLog.map((element) => element?.type),
      hasTriggersAgent: !!triggerForLog,
      triggerPromptType: triggerForLog?.promptType,
      triggerNodeId: triggerForLog?.nodeId,
      triggerMessageId: triggerForLog?.triggerMessageId,
    },
  );

  let createdMessage: MessageResponseDto;
  if (parentMessageId) {
    // Use explicit parent when provided
    const messageWithParent = {
      ...systemMessageBase,
      conversationId,
      parentMessageId,
    };
    createdMessage = await messageService.addMessage(
      messageWithParent,
      context.core.organizationId,
      `createSystemMessage-${nodeId}`,
    );
  } else {
    // Use auto-append for sequential conversation flow
    createdMessage = await messageService.appendMessageToConversation(
      conversationId,
      systemMessageBase,
      context.core.organizationId,
      `createSystemMessage-${nodeId}`,
    );
  }

  // Update the context with the new system message ID for future parentMessageId linking
  const previousLastSystemMessageId = context.lastSystemMessageId;
  context.lastSystemMessageId = createdMessage.id as MessageId;

  logger.debug('[createSystemMessage] System message created successfully', {
    messageType: systemMessageBase.type,
    nodeId,
    flowId,
    messageId: createdMessage.id,
    parentMessageId: parentMessageId || null,
    previousLastSystemMessageId,
    newLastSystemMessageId: context.lastSystemMessageId,
  });
}

export async function saveFlowState({
  workflowState,
  executionId,
}: {
  workflowState: WorkflowState;
  executionId: FlowExecutionId;
}): Promise<void> {
  const logger = getLogger('SaveFlowState');
  logger.debug('[saveFlowState] Saving flow state', {
    currentNodeId: workflowState.currentNodeId,
    step: workflowState.step,
    phase: workflowState.phase,
    iterations: workflowState.iterations,
    executionId,
  });

  const appContext = await getAppContextForWorker();
  const conversationService = appContext.get(ConversationService);
  const flowExecutionService = appContext.get(FlowExecutionService);

  // Create serializable state with complete workflow orchestration data
  const serializableState: SerializableWorkflowState = {
    step: workflowState.step,
    phase: workflowState.phase,
    nodeConfig: workflowState.nodeConfig,
    iterations: workflowState.iterations,
    context: workflowState.context,
    currentNodeId: workflowState.currentNodeId,
    currentNodeExecutionId: workflowState.currentNodeExecutionId,
    hasPendingLLMResponse: !!workflowState.pendingLLMResponse,
    lastSystemMessageId: workflowState.context.lastSystemMessageId,
    lastUserMessageId: workflowState.lastUserMessageId,
    errorHolding: workflowState.errorHolding
      ? {
          isActive: workflowState.errorHolding.isActive,
          errorMessage: workflowState.errorHolding.errorMessage,
          errorCode: workflowState.errorHolding.errorCode,
          nodeId: workflowState.errorHolding.nodeId,
        }
      : undefined,
    timestamp: new Date().toISOString(),
    version: 1,
  };

  // Update flow execution with complete state
  await flowExecutionService.updateFlowState(
    executionId,
    workflowState.organizationId,
    {
      currentNode: workflowState.currentNodeId,
      flowState: serializableState, // Save complete state, not just context
      status: 'IN_PROGRESS',
      completedNodes: workflowState.context.flowPath.pathTaken.length,
    },
  );

  const isWaitingOnUser =
    workflowState.step === WorkflowStep.WAITING_FOR_USER_INPUT;

  const conversationStatus = isWaitingOnUser
    ? ConversationStatus.InProgress
    : ConversationStatus.GeneratingResponse;

  const defaultTitle = buildDefaultConversationTitle(workflowState.flowId);
  const conversation = await conversationService.findOne(
    workflowState.conversationId,
    workflowState.organizationId,
  );
  const shouldUpdateTitle =
    !conversation?.title ||
    isDefaultConversationTitle(conversation.title, workflowState.flowId);

  // Update conversation status
  await conversationService.updateConversationInternal(
    workflowState.conversationId,
    workflowState.organizationId,
    {
      status: conversationStatus,
      ...(shouldUpdateTitle ? { title: defaultTitle } : {}),
    },
  );

  logger.debug('[saveFlowState] Flow state saved successfully', {
    executionId,
    currentNodeId: workflowState.currentNodeId,
    step: workflowState.step,
    phase: workflowState.phase,
  });
}

/**
 * Pause a workflow: saves current state and marks execution as PAUSED.
 * Called when the user-wait timeout fires. The workflow will exit cleanly
 * and can be resumed later when the user sends a new message.
 */
export async function pauseFlow({
  workflowState,
  executionId,
}: {
  workflowState: WorkflowState;
  executionId: FlowExecutionId;
}): Promise<void> {
  const logger = getLogger('PauseFlow');
  logger.log('[pauseFlow] Pausing workflow for later resumption', {
    executionId,
    currentNodeId: workflowState.currentNodeId,
    step: workflowState.step,
    iterations: workflowState.iterations,
    workflowId: workflowState.workflowId,
  });

  const appContext = await getAppContextForWorker();
  const conversationService = appContext.get(ConversationService);
  const flowExecutionService = appContext.get(FlowExecutionService);

  // Save full state before pausing
  const serializableState: SerializableWorkflowState = {
    step: workflowState.step,
    phase: workflowState.phase,
    nodeConfig: workflowState.nodeConfig,
    iterations: workflowState.iterations,
    context: workflowState.context,
    currentNodeId: workflowState.currentNodeId,
    currentNodeExecutionId: workflowState.currentNodeExecutionId,
    hasPendingLLMResponse: !!workflowState.pendingLLMResponse,
    lastSystemMessageId: workflowState.context.lastSystemMessageId,
    lastUserMessageId: workflowState.lastUserMessageId,
    errorHolding: workflowState.errorHolding
      ? {
          isActive: workflowState.errorHolding.isActive,
          errorMessage: workflowState.errorHolding.errorMessage,
          errorCode: workflowState.errorHolding.errorCode,
          nodeId: workflowState.errorHolding.nodeId,
        }
      : undefined,
    timestamp: new Date().toISOString(),
    version: 1,
  };

  // Single atomic write: save state + mark PAUSED in one update
  await flowExecutionService.updateFlowState(
    executionId,
    workflowState.organizationId,
    {
      currentNode: workflowState.currentNodeId,
      flowState: serializableState,
      status: 'PAUSED',
      completedNodes: workflowState.context.flowPath.pathTaken.length,
    },
  );

  // Set conversation status to IN_PROGRESS (not failed/completed)
  await conversationService.updateConversationInternal(
    workflowState.conversationId,
    workflowState.organizationId,
    {
      status: ConversationStatus.InProgress,
    },
  );

  logger.log('[pauseFlow] Workflow paused successfully', {
    executionId,
    currentNodeId: workflowState.currentNodeId,
    iterations: workflowState.iterations,
  });
}

export async function createErrorSystemMessage({
  conversationId,
  organizationId,
  flowId,
  context,
  errorType,
  errorMessage,
  nodeId,
  temporary = true,
  parentMessageId,
}: {
  conversationId: ConversationId;
  organizationId: OrganizationId;
  flowId: string;
  context: FlowContext;
  errorType: 'opener_error' | 'timeout' | 'processing_error';
  errorMessage: string;
  nodeId: string;
  temporary?: boolean;
  parentMessageId?: MessageId;
}): Promise<void> {
  const logger = getLogger('CreateErrorSystemMessage');
  logger.debug('[createErrorSystemMessage] Creating error system message', {
    conversationId,
    organizationId,
    errorType,
    errorMessage,
    nodeId,
    temporary,
  });

  const errorMessages = {
    opener_error:
      'I encountered an issue starting our conversation. Please try again later.',
    timeout:
      "I haven't heard from you in a while. I'll be here when you're ready to continue. Just send me a message to pick up where we left off.",
    processing_error:
      'I encountered an issue processing your request. Let me try to help you in a different way.',
  };

  const nodeResult: NodeResult = {
    type: NodeType.ERROR,
    message: errorMessages[errorType] || errorMessage,
    data: {
      detectedIntent: '',
      intentConfidence: 0,
      errorType,
      context: errorMessage,
      temporary,
    },
  };

  await createSystemMessage({
    conversationId,
    organizationId,
    nodeResult,
    nodeId,
    flowId,
    context,
    parentMessageId,
  });

  logger.debug(
    '[createErrorSystemMessage] Error system message created successfully',
    {
      errorType,
      nodeId,
    },
  );
}

export async function getNodeInfo({
  flowId,
  nodeId,
}: {
  flowId: string;
  nodeId: string;
}): Promise<{
  nodeType: NodeType;
}> {
  const logger = getLogger('GetNodeInfo');
  logger.debug('[getNodeInfo] Getting node info', {
    flowId,
    nodeId,
  });

  const appContext = await getAppContextForWorker();
  const flowEngine = appContext.get(NodeExecutionService);

  const flow = flowEngine.getFlow(flowId);
  if (!flow) {
    throw new Error(`Flow ${flowId} not found`);
  }

  const nodeData = flowEngine.getNode(flowId, nodeId);
  if (!nodeData?.node) {
    const availableNodes = Object.keys(flow.nodes ?? {});
    logger.error('[getNodeInfo] Node not found in flow', {
      flowId,
      nodeId,
      availableNodes,
    });
    throw new Error(
      `Node ${nodeId} not found in flow ${flowId}. Available nodes: ${availableNodes.join(', ')}`,
    );
  }
  const { node } = nodeData;

  logger.debug('[getNodeInfo] Found node', {
    nodeId,
    nodeType: node.type,
  });

  return {
    nodeType: node.type,
  };
}

const isInitiativeRefinementFlowContext = (
  fc: FlowContext,
): fc is InitiativeRefinementFlowContext =>
  fc.flowId === 'initiative-refinement' && 'initiativeId' in fc;

export async function getLastSystemMessage({
  conversationId,
  organizationId,
}: {
  conversationId: ConversationId;
  organizationId: OrganizationId;
}): Promise<MessageResponseDto | null> {
  const logger = getLogger('getLastSystemMessage');

  logger.debug('[getLastSystemMessage] Getting last system message', {
    conversationId,
    organizationId,
  });

  const appContext = await getAppContextForWorker();
  const messageService = appContext.get(MessageService);

  try {
    const lastSystemMessage = await messageService.getLastSystemMessage(
      conversationId,
      organizationId,
    );

    logger.debug('[getLastSystemMessage] Found last system message', {
      conversationId,
      messageId: lastSystemMessage?.id,
      messageCreatedAt: lastSystemMessage?.createdAt,
    });

    return lastSystemMessage;
  } catch (error) {
    logger.error(
      '[getLastSystemMessage] Failed to get last system message',
      error,
    );
    throw error;
  }
}

export async function completeFlow({
  context,
  flowId,
  executionId,
}: {
  context: FlowContext;
  finalNodeId: string;
  flowId: string;
  totalIterations: number;
  executionId: FlowExecutionId;
}): Promise<void> {
  const logger = getLogger('CompleteFlow');
  logger.debug('[completeFlow] Completing flow', {
    context,
    flowId,
    executionId,
  });

  const appContext = await getAppContextForWorker();
  const conversationService = appContext.get(ConversationService);
  const flowExecutionService = appContext.get(FlowExecutionService);

  // For initiative refinement flows, validate initiative status before completing
  if (isInitiativeRefinementFlowContext(context)) {
    const refinementContext = context;
    if (refinementContext.initiativeId) {
      try {
        const initiativeService = appContext.get(InitiativeService);

        const initiative = await initiativeService.findOne(
          refinementContext.initiativeId,
          context.core.organizationId,
        );

        if (!initiative) {
          logger.warn(
            '[completeFlow] Initiative not found, marking as failed',
            {
              initiativeId: refinementContext.initiativeId,
              organizationId: context.core.organizationId,
            },
          );

          // Mark as failed since initiative doesn't exist
          await flowExecutionService.markFailed(
            executionId,
            context.core.organizationId,
            'Initiative not found',
            'INITIATIVE_NOT_FOUND',
          );

          await conversationService.updateConversationInternal(
            context.core.conversationId,
            context.core.organizationId,
            {
              status: ConversationStatus.Deleted,
            },
          );
          return;
        }

        // Check if initiative is in a valid completion state
        if (initiative.status !== 'ACTIVE') {
          logger.warn(
            '[completeFlow] Initiative not in ACTIVE status, marking as recoverable',
            {
              initiativeId: refinementContext.initiativeId,
              currentStatus: initiative.status,
              flowId,
            },
          );

          // Mark as recoverable since user can continue refinement
          await flowExecutionService.markFailed(
            executionId,
            context.core.organizationId,
            `Initiative status is ${initiative.status}, not ACTIVE`,
            'INVALID_INITIATIVE_STATUS',
          );

          await conversationService.updateConversationInternal(
            context.core.conversationId,
            context.core.organizationId,
            {
              status: ConversationStatus.Recoverable,
            },
          );
          return;
        }

        logger.debug('[completeFlow] Initiative validation passed', {
          initiativeId: refinementContext.initiativeId,
          status: initiative.status,
        });
      } catch (error) {
        logger.error('[completeFlow] Error validating initiative status', {
          error: error instanceof Error ? error.message : error,
          initiativeId: refinementContext.initiativeId,
        });

        // Mark as recoverable on validation errors
        await flowExecutionService.markFailed(
          executionId,
          context.core.organizationId,
          'Failed to validate initiative status',
          'INITIATIVE_VALIDATION_ERROR',
        );

        await conversationService.updateConversationInternal(
          context.core.conversationId,
          context.core.organizationId,
          {
            status: ConversationStatus.Recoverable,
          },
        );
        return;
      }
    }
  }

  // Check if this specific execution was already marked PAUSED (timeout path).
  // If so, skip marking as completed — the paused state should be preserved
  // so the resumption trigger can detect it.
  const currentExecution = await flowExecutionService.findById(
    executionId,
    context.core.organizationId,
  );

  if (currentExecution?.status === 'PAUSED') {
    logger.log(
      '[completeFlow] Execution is PAUSED - skipping completion mark',
      {
        flowId,
        executionId,
      },
    );
    return;
  }

  logger.debug('[completeFlow] Marking complete', {
    flowId,
    executionId,
  });

  // Mark flow execution as completed
  await flowExecutionService.markCompleted(
    executionId,
    context.core.organizationId,
    context,
  );

  // Execute onComplete callback if defined on the flow
  try {
    const flowEngineService = appContext.get(NodeExecutionService);
    const flow = flowEngineService.getFlow(flowId);

    if (flow?.onComplete) {
      logger.debug('[completeFlow] Executing onComplete callback', {
        flowId,
        executionId,
      });

      await flow.onComplete(context, appContext);

      logger.debug('[completeFlow] onComplete callback executed successfully', {
        flowId,
        executionId,
      });
    }
  } catch (error) {
    logger.error('[completeFlow] Error executing onComplete callback', {
      error: error instanceof Error ? error.message : error,
      flowId,
      executionId,
    });
    // Don't fail the flow completion if onComplete fails - just log the error
  }

  // Mark conversation as completed
  await conversationService.updateConversationInternal(
    context.core.conversationId,
    context.core.organizationId,
    {
      status: ConversationStatus.Completed,
    },
  );

  logger.debug('[completeFlow] Flow completed successfully', {
    executionId,
    flowId,
    conversationId: context.core.conversationId,
  });
}

export async function failFlow({
  context,
  flowId,
  executionId,
  errorMessage,
}: {
  context: FlowContext;
  flowId: string;
  executionId: FlowExecutionId;
  errorMessage: string;
}): Promise<void> {
  const logger = getLogger('FailFlow');
  logger.debug('[failFlow] Marking flow as failed', {
    context,
    flowId,
    executionId,
    errorMessage,
  });

  const appContext = await getAppContextForWorker();
  const conversationService = appContext.get(ConversationService);
  const flowExecutionService = appContext.get(FlowExecutionService);

  // Mark flow execution as failed
  await flowExecutionService.markFailed(
    executionId,
    context.core.organizationId,
    errorMessage,
    'FLOW_FAILED',
  );

  // Mark conversation as failed
  await conversationService.updateConversationInternal(
    context.core.conversationId,
    context.core.organizationId,
    {
      status: ConversationStatus.Deleted,
    },
  );

  logger.debug('[failFlow] Flow marked as failed successfully', {
    executionId,
    flowId,
    conversationId: context.core.conversationId,
    errorMessage,
  });
}

export async function markRecoverableFlow({
  context,
  flowId,
  executionId,
  reason,
}: {
  context: FlowContext;
  flowId: string;
  executionId: FlowExecutionId;
  reason: string;
}): Promise<void> {
  const logger = getLogger('MarkRecoverableFlow');
  logger.debug('[markRecoverableFlow] Marking flow as recoverable', {
    context,
    flowId,
    executionId,
    reason,
  });

  const appContext = await getAppContextForWorker();
  const conversationService = appContext.get(ConversationService);
  const flowExecutionService = appContext.get(FlowExecutionService);

  // Mark flow execution as failed (since there's no separate recoverable state in execution)
  await flowExecutionService.markFailed(
    executionId,
    context.core.organizationId,
    reason,
    'FLOW_RECOVERABLE',
  );

  // Mark conversation as recoverable so it can be resumed
  await conversationService.updateConversationInternal(
    context.core.conversationId,
    context.core.organizationId,
    {
      status: ConversationStatus.Recoverable,
    },
  );

  logger.debug(
    '[markRecoverableFlow] Flow marked as recoverable successfully',
    {
      executionId,
      flowId,
      conversationId: context.core.conversationId,
      reason,
    },
  );
}

// ==================== AGENT EXECUTION ACTIVITIES ====================

/**
 * Process agent execution results and update workflow context
 */
export async function processAgentResponse({
  agentExecutionResult,
  context,
  nodeId,
}: {
  agentExecutionResult: {
    executionId: string;
    status: 'completed' | 'failed' | 'timeout';
    result?: {
      changes: Array<{
        type: string;
        field: string;
        oldValue?: unknown;
        newValue: unknown;
        reasoning: string;
      }>;
      summary?: string;
      confidence?: number;
      reasoning?: string;
    };
    error?: string;
    iterations: number;
  };
  context: FlowContext;
  nodeId: string;
}): Promise<FlowContext> {
  const logger = getLogger('ProcessAgentResponse');

  logger.debug('[processAgentResponse] Processing agent results', {
    executionId: agentExecutionResult.executionId,
    status: agentExecutionResult.status,
    nodeId,
    hasResult: !!agentExecutionResult.result,
  });

  // Update context with comprehensive agent execution results
  const updatedContext: FlowContext = {
    ...context,
    lastAgentExecution: {
      agentId: agentExecutionResult.executionId.split('-')[0] || 'unknown',
      executionId: agentExecutionResult.executionId,
      timestamp: new Date().toISOString(),
      changes: agentExecutionResult.result?.changes || [],
      summary: agentExecutionResult.result?.summary || '',
      confidence: agentExecutionResult.result?.confidence || 0,
      reasoning: agentExecutionResult.result?.reasoning || '',
      status: agentExecutionResult.status,
      iterations: agentExecutionResult.iterations,
      nodeId,
    },

    // Store agent results by node ID for later reference
    agentExecutionHistory: {
      ...context.agentExecutionHistory,
      [nodeId]: {
        executionId: agentExecutionResult.executionId,
        timestamp: new Date().toISOString(),
        result: agentExecutionResult.result,
        status: agentExecutionResult.status,
        iterations: agentExecutionResult.iterations,
      },
    },

    // Update specialized context fields based on agent type
    analysisResults:
      nodeId === 'agent_analysis'
        ? {
            ...context.analysisResults,
            feedbackAnalysis: agentExecutionResult.result,
            lastAnalysisTimestamp: new Date().toISOString(),
          }
        : context.analysisResults,

    changeAnalysis:
      nodeId === 'analyze_change'
        ? {
            ...context.changeAnalysis,
            riskAssessment: agentExecutionResult.result,
            lastChangeAnalysisTimestamp: new Date().toISOString(),
          }
        : context.changeAnalysis,

    presentationResults:
      nodeId === 'present_findings'
        ? {
            ...context.presentationResults,
            findings: agentExecutionResult.result,
            lastPresentationTimestamp: new Date().toISOString(),
          }
        : context.presentationResults,
  };

  // If execution failed, log but don't throw - let workflow handle gracefully
  if (agentExecutionResult.status === 'failed') {
    logger.warn('[processAgentResponse] Agent execution failed', {
      executionId: agentExecutionResult.executionId,
      error: agentExecutionResult.error,
      nodeId,
    });
  }

  logger.debug('[processAgentResponse] Context updated with agent results', {
    executionId: agentExecutionResult.executionId,
    hasChanges:
      !!agentExecutionResult.result?.changes &&
      agentExecutionResult.result?.changes?.length > 0,
  });

  return updatedContext;
}

export async function startNonInteractiveNode(params: {
  job: SummarizationJobInput;
  workflowId: WorkflowId;
  nodeId: string;
  metadata?: Record<string, unknown>;
  requestId: string;
  flowId?: string;
  contextOverrides?: Record<string, unknown>;
}): Promise<{ jobId: string }> {
  const appContext = await getAppContextForWorker();
  const nodeExecutor = appContext.get(NodeExecutionService);
  const summarizationService = appContext.get(SummarizationService);

  const baseContext = summarizationService.buildFlowContext(
    params.job,
    params.workflowId,
    params.metadata,
    {
      flowId: params.flowId,
      workflowAboutId: params.job.workflowAboutId,
      workflowAboutType: params.job.workflowAboutType,
    },
  );
  const flowContext = {
    ...baseContext,
    ...(params.contextOverrides || {}),
  } as FlowContext;

  const { job: queuedJob } = await nodeExecutor.startNonInteractiveFlowNode({
    flowId: flowContext.flowId,
    nodeId: params.nodeId,
    context: flowContext,
    organizationId: params.job.organizationId,
    projectId: params.job.projectId,
    workflowId: params.workflowId,
    requestId: params.requestId as RequestId,
    conversationId: flowContext.core.conversationId,
    userId: flowContext.core.user.id,
  });

  return { jobId: queuedJob.id };
}

export async function startTaskDependencyInferenceNode(params: {
  job: TaskDependencyInferenceWorkflowInput;
  workflowId: WorkflowId;
  nodeId: string;
  requestId: string;
  flowId?: string;
}): Promise<{ jobId: string }> {
  const appContext = await getAppContextForWorker();
  const nodeExecutor = appContext.get(NodeExecutionService);

  const flowContext = {
    core: {
      workflowId: params.workflowId,
      projectId: params.job.projectId,
      organizationId: params.job.organizationId,
      conversationId:
        `task-dependency-inference-${params.workflowId}` as ConversationId,
      workflowAboutId: params.job.initiativeId,
      workflowAboutType: 'initiative',
      user: { id: 'system' as UserId, role: 'system' },
      session: { startTime: new Date(), interactionCount: 0 },
    },
    flowId: params.flowId ?? 'task-dependency-inference',
    flowPath: { pathTaken: [] },
    metadata: {
      trigger: params.job.trigger ?? 'task_dependency_inference',
    },
    initiativeId: params.job.initiativeId,
    targetTaskIds: params.job.targetTaskIds,
  } as TaskDependencyInferenceFlowContext;

  const { job } = await nodeExecutor.startNonInteractiveFlowNode({
    flowId: flowContext.flowId,
    nodeId: params.nodeId,
    context: flowContext,
    organizationId: params.job.organizationId,
    projectId: params.job.projectId,
    workflowId: params.workflowId,
    requestId: params.requestId as RequestId,
    conversationId: flowContext.core.conversationId,
    userId: flowContext.core.user.id,
  });

  return { jobId: job.id };
}

export async function startSuggestedTaskGenerationNode(params: {
  job: CreateSuggestedTaskWorkflowInput;
  workflowId: WorkflowId;
  nodeId: string;
  requestId: string;
  flowId?: string;
}): Promise<{ jobId: string }> {
  const appContext = await getAppContextForWorker();
  const nodeExecutor = appContext.get(NodeExecutionService);

  const flowContext = {
    core: {
      workflowId: params.workflowId,
      projectId: params.job.projectId,
      organizationId: params.job.organizationId,
      conversationId: params.job.sourceConversationId,
      workflowAboutId: params.job.sourceMessageId,
      workflowAboutType: 'message',
      user: { id: 'system' as UserId, role: 'system' },
      session: { startTime: new Date(), interactionCount: 0 },
    },
    flowId: params.flowId ?? 'create-suggested-task',
    flowPath: { pathTaken: [] },
    metadata: {
      trigger: params.job.trigger ?? 'suggested_action',
    },
    taskName: params.job.name,
    taskDescription: params.job.description,
    initiativeId: params.job.initiativeId,
    parentTaskId: params.job.parentTaskId,
    sourceConversationId: params.job.sourceConversationId,
    sourceMessageId: params.job.sourceMessageId,
  } as SuggestedTaskFlowContext;

  const { job } = await nodeExecutor.startNonInteractiveFlowNode({
    flowId: flowContext.flowId,
    nodeId: params.nodeId,
    context: flowContext,
    organizationId: params.job.organizationId,
    projectId: params.job.projectId,
    workflowId: params.workflowId,
    requestId: params.requestId as RequestId,
    conversationId: flowContext.core.conversationId,
    userId: flowContext.core.user.id,
  });

  return { jobId: job.id };
}

export async function startSuggestedDesignDocGenerationNode(params: {
  job: CreateSuggestedDesignDocWorkflowInput;
  workflowId: WorkflowId;
  nodeId: string;
  requestId: string;
  flowId?: string;
}): Promise<{ jobId: string }> {
  const appContext = await getAppContextForWorker();
  const nodeExecutor = appContext.get(NodeExecutionService);

  const flowContext = {
    core: {
      workflowId: params.workflowId,
      projectId: params.job.projectId,
      organizationId: params.job.organizationId,
      conversationId: params.job.sourceConversationId,
      workflowAboutId: params.job.sourceMessageId,
      workflowAboutType: 'message',
      user: { id: 'system' as UserId, role: 'system' },
      session: { startTime: new Date(), interactionCount: 0 },
    },
    flowId: params.flowId ?? 'create-suggested-design-doc',
    flowPath: { pathTaken: [] },
    metadata: {
      trigger: params.job.trigger ?? 'suggested_action',
    },
    designDocName: params.job.name,
    designDocDescription: params.job.description,
    template: params.job.template,
    initiativeId: params.job.initiativeId,
    taskId: params.job.taskId,
    sourceConversationId: params.job.sourceConversationId,
    sourceMessageId: params.job.sourceMessageId,
  } as SuggestedDesignDocFlowContext;

  const { job } = await nodeExecutor.startNonInteractiveFlowNode({
    flowId: flowContext.flowId,
    nodeId: params.nodeId,
    context: flowContext,
    organizationId: params.job.organizationId,
    projectId: params.job.projectId,
    workflowId: params.workflowId,
    requestId: params.requestId as RequestId,
    conversationId: flowContext.core.conversationId,
    userId: flowContext.core.user.id,
  });

  return { jobId: job.id };
}

export async function getLatestSubfacetConsolidationRun(params: {
  organizationId: OrganizationId;
  projectId: ProjectId;
  category: SummaryCategory;
}): Promise<SubfacetConsolidationRun | null> {
  const appContext = await getAppContextForWorker();
  const auditService = appContext.get(TopologyAuditService);

  return auditService.getLatestRun({
    organizationId: params.organizationId,
    projectId: params.projectId,
    category: params.category,
  });
}

export async function getLatestCategorySummarizationRun(params: {
  organizationId: OrganizationId;
  projectId: ProjectId;
  category: SummaryCategory;
}): Promise<CategorySummarizationRun | null> {
  const appContext = await getAppContextForWorker();
  const auditService = appContext.get(TopologyAuditService);

  return auditService.getLatestCategoryRun({
    organizationId: params.organizationId,
    projectId: params.projectId,
    category: params.category,
  });
}

export async function getLatestSubfacetSummarizationRun(params: {
  organizationId: OrganizationId;
  projectId: ProjectId;
  category: SummaryCategory;
  subfacetId: string;
}): Promise<SubfacetSummarizationRun | null> {
  const appContext = await getAppContextForWorker();
  const auditService = appContext.get(TopologyAuditService);

  return auditService.getLatestSubfacetSummaryRun({
    organizationId: params.organizationId,
    projectId: params.projectId,
    category: params.category,
    subfacetId: params.subfacetId,
  });
}

export async function listSummarizableSubfacets(params: {
  organizationId: OrganizationId;
  projectId: ProjectId;
  categories?: SummaryCategory[];
  subfacetIds?: string[];
  since?: string;
}): Promise<
  Array<{
    id: string;
    name: string;
    slug: string;
    category: SummaryCategory;
  }>
> {
  const appContext = await getAppContextForWorker();
  const subfacetService = appContext.get(SubfacetService);
  const subfacetIds = params.subfacetIds?.filter(Boolean);
  const categories = params.categories?.filter(Boolean);
  const since = params.since ? new Date(params.since) : undefined;
  if (since && Number.isNaN(since.getTime())) {
    throw new Error(
      `[listSummarizableSubfacets] Invalid since value: ${params.since}`,
    );
  }

  const subfacets = await subfacetService.listSubfacets({
    organizationId: params.organizationId,
    projectId: params.projectId,
    status: SubfacetStatus.ACTIVE,
  });

  const filteredSubfacets = subfacets.filter((subfacet) => {
    const allowedCategory =
      !categories?.length || categories.includes(subfacet.category);
    const allowedId = !subfacetIds?.length || subfacetIds.includes(subfacet.id);
    return allowedCategory && allowedId;
  });

  if (!since) {
    return filteredSubfacets
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((subfacet) => ({
        id: subfacet.id,
        name: subfacet.name,
        slug: subfacet.slug,
        category: subfacet.category,
      }));
  }

  if (!filteredSubfacets.length) {
    return [];
  }

  const prisma = appContext.get(PrismaService);
  const candidateIds = filteredSubfacets.map((subfacet) => subfacet.id);
  const eligible = await prisma.db.entitySubfacet.findMany({
    where: {
      organizationId: params.organizationId,
      projectId: params.projectId,
      subfacetId: { in: candidateIds },
      summary: {
        isCurrent: true,
        updatedAt: { gte: since },
      },
    },
    select: { subfacetId: true },
    distinct: ['subfacetId'],
  });
  const eligibleSubfacetIds = new Set(eligible.map((row) => row.subfacetId));

  return filteredSubfacets
    .filter((subfacet) => eligibleSubfacetIds.has(subfacet.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((subfacet) => ({
      id: subfacet.id,
      name: subfacet.name,
      slug: subfacet.slug,
      category: subfacet.category,
    }));
}
