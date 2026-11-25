import {
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  INestApplicationContext,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { FlowExecutionStatus, Prisma } from '@prisma/client';
import {
  ConversationStatus,
  SystemMessageData,
  WorkflowName,
  MessageResponseDto,
  ExternalAgentNodeCompletion,
  UserMessageData,
  MessageStatus,
} from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
  RequestId,
} from '../../types';
import {
  AgentHandoffNodeBase,
  FlowContext,
  RepositoryImportFlowContext,
  FlowUserMessage,
  INode,
  isExternalAgentNode,
  NodeType,
  validateExternalAgentCompletion,
} from '../../types/flow-internal.types';
import { createMutableContextHandle } from '../../utils/mutable-context';
import { MessageResponseUtil } from '../../utils/message-response.util';
import { convertNodeResultToSystemMessage } from '../../utils/node-result-to-system-message.util';
import { hasUiElements } from '../../utils/type-checks';
import { workflowAboutTypeToEntityType } from '../../utils/workflow-about-type.util';
import {
  isSerializableWorkflowState,
  SerializableWorkflowState,
  WORKFLOW_STEP_TO_PHASE,
  WorkflowStep,
} from '../../workflows/conversation-workflow-state';
import { ZodError } from 'zod';
import { JsonExtractionUtil } from '../../utils/json-extraction.util';
import { featureGenerationResponseSchema } from '../../flows/utils/shared-schemas';
import { isLocalRepositoryImportExecutionOwner } from './repository-import-execution-owner';
import { NodeRegistry } from '../../flows/nodes/node-registry.service';
import { LocalRepositoryOutlineRefinementNode } from './local-repository-outline-refinement.node';
import { LOCAL_REPOSITORY_OUTLINE_REFINEMENT_NODE } from '../../flows/constants/node-ids';
import { randomUUID } from 'node:crypto';
import { isTimelineMessage } from '../../mappers/message.mapper';
import {
  REPOSITORY_IMPORT_NODES,
  ONBOARDING_NODES,
} from '../../flows/constants';
import { resolveRepositoryImportFlowIdentity } from '../../workflows/repository-import-legacy-compatibility';
import { AgentOperationWorkflowAnswerService } from '../agent-operation/agent-operation-workflow-answer.service';
import { MessageService } from '../message.service';
import { NodeExecutionService } from './node-execution.service';

const FLOW_ID = WorkflowName.RepositoryImport;
const MAX_AUTOMATIC_TRANSITIONS = 20;

/** Where a local import stopped after stepping as far as it can. */
export type LocalRepositoryImportProgress =
  | 'WAITING_FOR_USER'
  | 'WAITING_FOR_AGENT'
  | 'COMPLETED';

/**
 * Runs repository import in a local installation, where there is no hosted
 * workflow service. Progress lives in the conversation's saved execution;
 * every step runs under a lock on that row.
 */
@Injectable()
export class LocalRepositoryImportService implements OnModuleInit {
  private readonly logger = new Logger(LocalRepositoryImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nodes: NodeExecutionService,
    @Inject(forwardRef(() => MessageService))
    private readonly messages: MessageService,
    @Inject('APP_CONTEXT') private readonly appContext: INestApplicationContext,
  ) {}

  onModuleInit(): void {
    const registry = this.appContext.get(NodeRegistry, { strict: false });
    registry.register(
      this.appContext.get(LocalRepositoryOutlineRefinementNode, {
        strict: false,
      }),
    );
  }

  /** Saves a new import's execution and shows its first form, atomically. */
  async begin(input: {
    context: FlowContext;
    userId: UserId;
  }): Promise<LocalRepositoryImportProgress> {
    const { context, userId } = input;
    const { organizationId, projectId, conversationId } = context.core;
    const flow = this.nodes.getFlow(FLOW_ID);
    if (!flow) {
      throw new Error('The repository import flow is not registered');
    }

    return this.prisma.withTransaction(
      async (tx) => {
        const state: SerializableWorkflowState = {
          executionOwner: 'CLI',
          step: WorkflowStep.EXECUTING_AUTO_NODE,
          phase: WORKFLOW_STEP_TO_PHASE[WorkflowStep.EXECUTING_AUTO_NODE],
          nodeConfig: {
            id: flow.startNode,
            type: NodeType.QUESTIONS,
            supportsPhases: false,
          },
          iterations: 0,
          context: {
            ...context,
            currentNodeExecution: {
              nodeId: flow.startNode,
              questionsGenerated: false,
            },
          },
          currentNodeId: flow.startNode,
          currentNodeExecutionId: undefined,
          lastSystemMessageId: undefined,
          lastUserMessageId: undefined,
          hasPendingLLMResponse: false,
          timestamp: new Date().toISOString(),
          version: 1,
        };
        await tx.flowExecution.create({
          data: {
            // The launching user owns the execution; Agent Session binding checks it.
            userId,
            flowId: FLOW_ID,
            organizationId,
            projectId,
            conversationId,
            entityType: workflowAboutTypeToEntityType(
              context.core.workflowAboutType,
            ),
            entityId: context.core.workflowAboutId,
            currentNode: flow.startNode,
            totalNodes: Object.keys(flow.nodes).length,
            flowState: toJson(state),
            resumable: true,
            status: FlowExecutionStatus.IN_PROGRESS,
          },
        });
        await tx.conversation.update({
          where: { id: conversationId },
          data: { status: ConversationStatus.InProgress },
        });

        return this.step(tx, {
          organizationId,
          projectId,
          conversationId,
        }).then((progress) => {
          if (!progress)
            throw new Error('New repository import execution is missing');
          return progress;
        });
      },
      {
        timeout: 60000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  async recoverStart(context: FlowContext, userId: UserId): Promise<boolean> {
    const { conversationId, projectId, organizationId, workflowId } =
      context.core;
    return this.prisma.withTransaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${conversationId} AND organization_id = ${organizationId} FOR UPDATE`;
        const conversation = await tx.conversation.findFirst({
          where: { id: conversationId, projectId, organizationId },
          select: { status: true, createdBy: true },
        });
        if (
          !conversation ||
          (conversation.createdBy && conversation.createdBy !== userId)
        ) {
          throw new ConflictException(
            'The importing user must resume this conversation',
          );
        }
        if (
          conversation.status === ConversationStatus.Completed ||
          conversation.status === ConversationStatus.Deleted
        ) {
          return false;
        }
        const saved = await tx.flowExecution.findFirst({
          where: { conversationId, projectId, organizationId },
          select: { id: true },
        });
        if (saved) {
          return false;
        }
        await tx.conversation.update({
          where: { id: conversationId },
          data: { workflowId, workflowName: FLOW_ID },
        });
        await this.begin({ context, userId });
        return true;
      },
      { timeout: 60000 },
    );
  }

  async advance(
    message: MessageResponseDto,
    organizationId: OrganizationId,
    input: {
      nodeId: string;
      operationId?: string;
      completion?: ExternalAgentNodeCompletion;
    },
  ): Promise<boolean> {
    if (!isTimelineMessage(message)) {
      throw new Error('Local repository import requires a dated input');
    }

    const progress = await this.prisma.withTransaction(
      (tx) =>
        this.step(
          tx,
          {
            organizationId,
            projectId: message.projectId as ProjectId,
            conversationId: message.conversationId as ConversationId,
          },
          { ...input, message },
        ),
      { timeout: 60000 },
    );
    return progress !== undefined;
  }

  private async step(
    tx: Prisma.TransactionClient,
    scope: {
      organizationId: OrganizationId;
      projectId: ProjectId;
      conversationId: ConversationId;
    },
    input?: {
      nodeId: string;
      operationId?: string;
      completion?: ExternalAgentNodeCompletion;
      message: MessageResponseDto & { createdAt: string };
    },
  ): Promise<LocalRepositoryImportProgress | undefined> {
    const { organizationId, projectId, conversationId } = scope;
    await tx.$queryRaw`SELECT id FROM flow_executions WHERE conversation_id = ${conversationId} AND organization_id = ${organizationId} AND project_id = ${projectId} FOR UPDATE`;
    const conversation = await tx.conversation.findUnique({
      where: { id: conversationId },
      select: { workflowName: true },
    });
    const execution = await tx.flowExecution.findFirst({
      where: {
        organizationId,
        projectId,
        conversationId,
        flowId: { in: [FLOW_ID, WorkflowName.Onboarding] },
      },
      orderBy: { startedAt: 'desc' },
    });
    if (
      !execution ||
      !isSerializableWorkflowState(execution.flowState) ||
      !isLocalRepositoryImportExecutionOwner(
        execution.flowState.executionOwner,
      ) ||
      !resolveRepositoryImportFlowIdentity({
        conversationWorkflowName: conversation?.workflowName ?? null,
        executionFlowId: execution.flowId,
        currentNode: execution.currentNode,
        flowState: execution.flowState,
      })
    ) {
      return undefined;
    }
    const state = execution.flowState;
    state.executionOwner = 'CLI';
    state.context = { ...state.context, flowId: FLOW_ID };
    if (
      execution.status === FlowExecutionStatus.COMPLETED &&
      !execution.resumable
    ) {
      return 'COMPLETED';
    }

    const save = async () => {
      await tx.flowExecution.update({
        where: { id: execution.id },
        data: {
          currentNode: state.currentNodeId,
          flowState: toJson(state),
          version: { increment: 1 },
        },
      });
    };

    let reply: FlowUserMessage | undefined;
    if (input) {
      if (input.message.id === state.lastUserMessageId) {
        return 'WAITING_FOR_USER';
      }
      const entry = this.nodes.getNode(FLOW_ID, state.currentNodeId);
      const parentId =
        input.completion?.completesTriggerMessageId ??
        input.message.parentMessageId;
      if (
        !entry ||
        entry.node.id !== input.nodeId ||
        !state.lastSystemMessageId ||
        parentId !== state.lastSystemMessageId ||
        state.step !== WorkflowStep.WAITING_FOR_USER_INPUT
      ) {
        this.logger.warn('Ignoring stale local repository import input', {
          conversationId,
          messageId: input.message.id,
          nodeId: input.nodeId,
          currentNodeId: state.currentNodeId,
        });
        if (input.operationId) {
          await this.appContext
            .get(AgentOperationWorkflowAnswerService, { strict: false })
            .succeedWithoutTrigger(input.operationId, {
              resolution: 'NO_TRIGGER',
              reason: 'stale_form',
              nextNodeId: state.currentNodeId,
            });
        }
        return 'WAITING_FOR_USER';
      }

      const message: FlowUserMessage = {
        ...input.message,
        type: 'USER',
        conversationId,
        projectId,
        data: { ...input.message.data } as UserMessageData,
        nodeId: entry.node.id,
        timestamp: input.message.createdAt,
        workflowAnswerOperationId: input.operationId,
      };
      const { node, routing } = entry;
      const tracker = createMutableContextHandle(state.context);
      let action: string | undefined;
      if (input.completion) {
        if (!isExternalAgentNode(node)) {
          throw new ConflictException(
            'Repository import step does not accept agent completions',
          );
        }
        ({ action } = validateExternalAgentCompletion({
          nodeId: node.id,
          actions: node.actions,
          message,
        }));
      }

      if (
        node.id === LOCAL_REPOSITORY_OUTLINE_REFINEMENT_NODE &&
        input.completion
      ) {
        await this.showRefinedOutline(tx, state, input.completion);
        await save();
        return 'WAITING_FOR_USER';
      }

      const lifecycleNode: INode = entry.node;
      await lifecycleNode.processUserResponse?.(tracker, message);
      reply = message;
      state.context = tracker.getContext();
      state.lastUserMessageId = message.id as MessageId;
      if (input.operationId && input.message.type === 'USER') {
        await tx.message.updateMany({
          where: {
            id: state.lastSystemMessageId,
            conversationId,
            status: MessageStatus.Open,
          },
          data: { status: MessageStatus.Completed },
        });
      }
      const next =
        action && isExternalAgentNode(node)
          ? ((await node.determineRoutingFromAgentCompletion?.(
              state.context,
              action,
            )) ?? routing.transitions?.[action]?.nextNodeId)
          : await node.determineRoutingFromUserMessage?.(
              state.context,
              message,
            );
      this.move(
        state,
        next ?? routing.nextNode ?? routing.transitions?.default?.nextNodeId,
      );
      if (
        state.currentNodeId === REPOSITORY_IMPORT_NODES.ANALYSIS &&
        !input.operationId
      ) {
        this.logger.warn(
          'Repository analysis needs a controller-authorized start',
          {
            conversationId,
            messageId: message.id,
          },
        );
        this.move(state, REPOSITORY_IMPORT_NODES.RECOVERY);
      }
      const nextNode = this.nodes.getNode(FLOW_ID, state.currentNodeId)?.node;
      if (
        input.operationId &&
        (!nextNode ||
          (!isExternalAgentNode(nextNode) &&
            !(nextNode instanceof AgentHandoffNodeBase)))
      ) {
        await this.appContext
          .get(AgentOperationWorkflowAnswerService, { strict: false })
          .succeedWithoutTrigger(input.operationId, {
            resolution: 'NO_TRIGGER',
            nextNodeId: state.currentNodeId,
          });
      }
    }

    for (let count = 0; count < MAX_AUTOMATIC_TRANSITIONS; count += 1) {
      if (state.step === WorkflowStep.WAITING_FOR_USER_INPUT) {
        await save();
        return 'WAITING_FOR_USER';
      }

      const entry = this.nodes.getNode(FLOW_ID, state.currentNodeId);
      if (!entry) {
        throw new ConflictException(
          `Saved repository import node ${state.currentNodeId} is unavailable`,
        );
      }
      const { node, routing } = entry;
      const tracker = createMutableContextHandle(state.context);
      if (isExternalAgentNode(node) || node instanceof AgentHandoffNodeBase) {
        const { message } = await this.nodes.startFlowNode({
          node,
          context: state.context,
          ...state.context.core,
          requestId: randomUUID() as RequestId,
          userMessageId: state.lastUserMessageId,
          parentMessageId: state.lastUserMessageId,
          transaction: tx,
        });
        this.rememberMessage(state, message.id as MessageId);
        if (isExternalAgentNode(node)) {
          this.wait(state, node);
          await save();
          return 'WAITING_FOR_AGENT';
        }
        await this.complete(tx, execution.id, conversationId);
        await save();
        return 'COMPLETED';
      }

      if (node.type === NodeType.GENERATE) {
        const generated = await node.getPrecomputedResponse?.(tracker, reply);
        if (!generated) {
          this.move(state, LOCAL_REPOSITORY_OUTLINE_REFINEMENT_NODE);
          continue;
        }
        const processed = await node.processLlmResponse?.(
          generated,
          reply,
          tracker,
        );
        if (!processed?.modifiedResult) {
          throw new Error(
            'Repository import did not produce an outline for review',
          );
        }
        state.context = tracker.getContext();
        await this.publish(tx, state, node, processed.modifiedResult);
        this.wait(state, node);
        continue;
      }

      const { result, nextNodeId } = await this.nodes.executeNode(
        node.id,
        tracker,
        routing,
        reply,
      );
      state.context = tracker.getContext();
      const data = convertNodeResultToSystemMessage(result, node.type, node.id);
      const placement = (state.context as RepositoryImportFlowContext)
        .repositoryPlacementCompletion;
      if (
        node.id === REPOSITORY_IMPORT_NODES.PLACEMENT_STRATEGY &&
        placement &&
        placement.outcome !== 'success'
      ) {
        data.response = `${placement.message} ${data.response}`;
      }
      await this.publish(tx, state, node, data);

      if (node.id === REPOSITORY_IMPORT_NODES.END) {
        await this.complete(tx, execution.id, conversationId);
        await save();
        return 'COMPLETED';
      }
      if (hasUiElements(data) && data.uiElements.length > 0) {
        this.wait(state, node);
        continue;
      }

      this.move(state, nextNodeId);
    }
    throw new Error(
      'Repository import exceeded its automatic transition bound',
    );
  }

  private async showRefinedOutline(
    tx: Prisma.TransactionClient,
    state: SerializableWorkflowState,
    completion: ExternalAgentNodeCompletion,
  ): Promise<void> {
    const { core } = state.context;
    const outline = this.nodes.getNode(
      FLOW_ID,
      REPOSITORY_IMPORT_NODES.GENERATE_FEATURES,
    )?.node;
    if (!outline?.processLlmResponse) {
      throw new Error('Repository import outline node is unavailable');
    }
    const tracker = createMutableContextHandle(state.context);
    let response: SystemMessageData | undefined;
    let reason: string | undefined;
    if (completion.action === 'success') {
      const { output } = completion.payload as { output: string };
      try {
        const parsed = featureGenerationResponseSchema.parse(
          JSON.parse(JsonExtractionUtil.extractJSONFromResponse(output)),
        );
        response = (
          await outline.processLlmResponse(
            { ...parsed, nodeId: outline.id },
            undefined,
            tracker,
          )
        ).modifiedResult;
      } catch (error) {
        if (!(error instanceof SyntaxError) && !(error instanceof ZodError)) {
          throw error;
        }
        reason = 'The provider returned an invalid Feature outline.';
        this.logger.warn(reason, {
          conversationId: core.conversationId,
          error: error.name,
        });
      }
    } else {
      const failure = completion.payload as { code: string; message: string };
      reason = failure.message;
      this.logger.warn('Repository import refinement failed', {
        conversationId: core.conversationId,
        code: failure.code,
        reason,
      });
    }

    if (!response) {
      const request = state.lastUserMessageId
        ? await this.messages.getMessage(
            state.lastUserMessageId,
            core.organizationId,
          )
        : null;
      const prior = request?.parentMessageId
        ? await this.messages.getMessage(
            request.parentMessageId,
            core.organizationId,
          )
        : null;
      if (prior?.type !== 'SYSTEM') {
        throw new Error(
          'Repository import refinement has no previous outline to review',
        );
      }
      response = {
        ...prior.data,
        response: `${reason ?? 'Refinement returned no revised outline.'} Review the saved outline or request changes again.`,
      };
    }
    state.context = tracker.getContext();
    this.move(state, outline.id);
    await this.publish(tx, state, outline, response);
    this.wait(state, outline);
  }

  private move(
    state: SerializableWorkflowState,
    next: string | undefined,
  ): void {
    if (!next) {
      throw new Error(
        `Repository import node ${state.currentNodeId} has no next transition`,
      );
    }
    state.context.flowPath.previousNode = state.currentNodeId;
    state.context.flowPath.pathTaken = [
      ...new Set([...state.context.flowPath.pathTaken, state.currentNodeId]),
    ];
    state.currentNodeId =
      next === ONBOARDING_NODES.FINALIZE
        ? REPOSITORY_IMPORT_NODES.FINALIZE
        : next;
    state.step = WorkflowStep.EXECUTING_AUTO_NODE;
    state.phase = WORKFLOW_STEP_TO_PHASE[state.step];
    state.context = {
      ...state.context,
      currentNodeExecution: {
        nodeId: state.currentNodeId,
        questionsGenerated: false,
      },
    };
  }

  private async publish(
    tx: Prisma.TransactionClient,
    state: SerializableWorkflowState,
    node: INode,
    data: SystemMessageData,
  ): Promise<void> {
    const { core } = state.context;
    const message = await this.messages.addMessageInTransaction(
      tx,
      {
        conversationId: core.conversationId,
        projectId: core.projectId,
        parentMessageId: state.lastUserMessageId,
        type: 'SYSTEM',
        data: { ...data, nodeId: node.id },
        status: MessageResponseUtil.determineMessageStatus(data),
      },
      core.organizationId,
      'localRepositoryImport',
    );
    this.rememberMessage(state, message.id as MessageId);
  }

  private wait(state: SerializableWorkflowState, node: INode): void {
    state.step = WorkflowStep.WAITING_FOR_USER_INPUT;
    state.phase = WORKFLOW_STEP_TO_PHASE[state.step];
    state.nodeConfig = {
      id: node.id,
      type: node.type,
      supportsPhases: node.twoPhase,
    };
    state.context = {
      ...state.context,
      currentNodeExecution: { nodeId: node.id, questionsGenerated: true },
    };
  }

  private async complete(
    tx: Prisma.TransactionClient,
    executionId: string,
    conversationId: ConversationId,
  ): Promise<void> {
    await tx.flowExecution.update({
      where: { id: executionId },
      data: {
        status: FlowExecutionStatus.COMPLETED,
        completedAt: new Date(),
        resumable: false,
      },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { status: ConversationStatus.Completed },
    });
  }

  private rememberMessage(
    state: SerializableWorkflowState,
    messageId: MessageId,
  ): void {
    state.lastSystemMessageId = messageId;
    state.currentNodeExecutionId = messageId;
    state.context = { ...state.context, lastSystemMessageId: messageId };
  }
}

function toJson(state: SerializableWorkflowState): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue;
}
