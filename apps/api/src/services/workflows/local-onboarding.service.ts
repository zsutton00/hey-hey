import { isTimelineMessage } from '../../mappers/message.mapper';
import { JsonExtractionUtil } from '../../utils/json-extraction.util';
import { ZodError } from 'zod';
import {
  OnboardingNextStepsService,
  featureNextStepsResponseSchema,
} from '../onboarding-next-steps.service';
import {
  ConflictException,
  Injectable,
  Inject,
  INestApplicationContext,
  NotFoundException,
} from '@nestjs/common';
import { FlowExecutionStatus, Prisma } from '@prisma/client';
import { v4 as uuid } from 'uuid';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  ConversationStatus,
  LocalOnboardingStepRequest,
  LocalOnboardingStepResponse,
  SystemMessageData,
  UserMessage,
} from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
  MessageId,
} from '../../types';
import {
  FlowUserMessage,
  INode,
  IntermediateSystemMessageData,
  RepositoryImportFlowContext,
  isPromptConfigurableNode,
  NodeType,
} from '../../types/flow-internal.types';
import {
  isSerializableWorkflowState,
  SerializableWorkflowState,
  WorkflowStep,
} from '../../workflows/conversation-workflow-state';
import { createMutableContextHandle } from '../../utils/mutable-context';
import { convertNodeResultToSystemMessage } from '../../utils/node-result-to-system-message.util';
import { MessageResponseUtil } from '../../utils/message-response.util';
import {
  hasUiElements,
  isGenerationSystemMessageData,
} from '../../utils/type-checks';
import { ONBOARDING_NODES } from '../../flows/constants/node-ids';
import { MessageService } from '../message.service';
import { NodeExecutionService } from './node-execution.service';
import { PromptBuilderService } from '../llm/prompt-builder.service';

@Injectable()
export class LocalOnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nodes: NodeExecutionService,
    private readonly prompts: PromptBuilderService,
    private readonly messages: MessageService,
    private readonly nextSteps: OnboardingNextStepsService,
    @Inject('APP_CONTEXT') private readonly appContext: INestApplicationContext,
  ) {}

  async advance(input: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    conversationId: ConversationId;
    userId: UserId;
    request: LocalOnboardingStepRequest;
  }): Promise<LocalOnboardingStepResponse> {
    const { organizationId, projectId, conversationId, userId, request } =
      input;
    return this.prisma.withTransaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM flow_executions WHERE conversation_id = ${conversationId} AND organization_id = ${organizationId} AND project_id = ${projectId} FOR UPDATE`;
        const execution = await tx.flowExecution.findFirst({
          where: {
            organizationId,
            projectId,
            conversationId,
            flowId: 'onboarding',
          },
          orderBy: { startedAt: 'desc' },
        });
        if (!execution || !isSerializableWorkflowState(execution.flowState)) {
          throw new NotFoundException('No saved onboarding execution');
        }
        const state = execution.flowState;
        if (state.executionOwner !== 'CLI') {
          throw new ConflictException(
            'Onboarding belongs to its hosted execution owner',
          );
        }
        const session = await tx.agentSession.findFirst({
          where: {
            id: request.agentSessionId,
            organizationId,
            projectId,
            userId,
            conversationId,
          },
        });
        if (!session?.machineId) {
          throw new ConflictException(
            'An admitted machine-bound Agent Session is required',
          );
        }
        if (
          state.localOnboarding &&
          state.localOnboarding.agentSessionId !== session.id
        ) {
          throw new ConflictException(
            'Onboarding already has an execution owner',
          );
        }
        const boundNow = !state.localOnboarding;
        state.localOnboarding ??= { agentSessionId: session.id };
        if (execution.status === FlowExecutionStatus.COMPLETED) {
          return { state: 'COMPLETED' };
        }
        const save = async () => {
          await tx.flowExecution.update({
            where: { id: execution.id },
            data: {
              currentNode: state.currentNodeId,
              flowState: JSON.parse(
                JSON.stringify(state),
              ) as Prisma.InputJsonValue,
              version: { increment: 1 },
            },
          });
        };
        if (
          request.requestId &&
          request.requestId !== state.localOnboarding.acceptedRequestId
        ) {
          if (
            state.localOnboarding.pending?.requestId !== request.requestId ||
            request.outputText === undefined
          ) {
            throw new ConflictException(
              'Provider result does not match the saved request',
            );
          }
          try {
            await this.accept(state, request.outputText, tx);
          } catch (error) {
            if (
              !(error instanceof SyntaxError) &&
              !(error instanceof ZodError)
            ) {
              throw error;
            }
            const pending = state.localOnboarding.pending;
            pending.attempts += 1;
            if (pending.attempts < 2) {
              pending.prompt +=
                '\nYour previous output did not satisfy the response schema. Return one valid JSON object.';
              await save();
              return {
                state: 'PROVIDER_REQUIRED',
                requestId: pending.requestId,
                prompt: pending.prompt,
              };
            }
            if (state.currentNodeId !== ONBOARDING_NODES.CLARIFY_CONCEPT) {
              throw new ConflictException(
                'Onboarding provider output did not satisfy its schema after two attempts',
              );
            }
            this.move(state, ONBOARDING_NODES.ANALYZE_PROJECT_CONCEPT);
          }
          state.localOnboarding.acceptedRequestId = request.requestId;
          delete state.localOnboarding.pending;
          await save();
        }
        for (let count = 0; count < 20; count += 1) {
          const pending = state.localOnboarding.pending;
          if (pending) {
            return {
              state: 'PROVIDER_REQUIRED',
              requestId: pending.requestId,
              prompt: pending.prompt,
            };
          }
          const entry = this.nodes.getNode('onboarding', state.currentNodeId);
          if (!entry) {
            throw new ConflictException('Saved onboarding node is unavailable');
          }
          const { node, routing } = entry;
          const tracker = createMutableContextHandle(state.context);
          if (state.step === WorkflowStep.WAITING_FOR_USER_INPUT) {
            if (node.id === ONBOARDING_NODES.FINALIZE) {
              const project = await tx.project.findFirst({
                where: { id: projectId, organizationId },
                select: { status: true },
              });
              if (project?.status === 'ACTIVE') {
                this.move(state, ONBOARDING_NODES.END);
                await save();
                continue;
              }
            }
            const reply = await tx.message.findFirst({
              where: {
                conversationId,
                projectId,
                type: 'USER',
                parentMessageId: state.lastSystemMessageId,
              },
              orderBy: { createdAt: 'asc' },
            });
            if (!reply || reply.id === state.lastUserMessageId) {
              if (boundNow) {
                await save();
              }
              return { state: 'WAITING_FOR_USER' };
            }
            const stored = await this.messages.getMessage(
              reply.id as MessageId,
              organizationId,
            );
            if (
              !stored ||
              stored.type !== 'USER' ||
              !isTimelineMessage(stored)
            ) {
              throw new Error('Saved onboarding reply is unavailable');
            }
            const message: FlowUserMessage = {
              ...stored,
              nodeId: node.id,
              timestamp: stored.createdAt,
            };
            await node.processUserResponse?.(tracker, message);
            const next = await node.determineRoutingFromUserMessage?.(
              tracker.getContext(),
              message,
            );
            state.context = tracker.getContext();
            state.lastUserMessageId = reply.id as MessageId;
            state.localOnboarding.triggeringUserMessage = message;
            state.localOnboarding.userMessages ??= [];
            state.localOnboarding.userMessages.push({
              id: message.id,
              nodeId: node.id,
              data: message.data,
            });
            if (node.id === ONBOARDING_NODES.ANALYZE_PROJECT_CONCEPT) {
              state.step = WorkflowStep.GENERATING_QUESTIONS;
              state.context = {
                ...state.context,
                currentNodeExecution: {
                  nodeId: node.id,
                  questionsGenerated: true,
                },
              };
              await save();
              continue;
            }
            this.move(
              state,
              next ??
                routing.nextNode ??
                routing.transitions?.default?.nextNodeId,
            );
            await save();
            continue;
          }
          if (node.id === ONBOARDING_NODES.END) {
            await tx.flowExecution.update({
              where: { id: execution.id },
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
            await save();
            return { state: 'COMPLETED' };
          }
          if (
            node.id === ONBOARDING_NODES.FINALIZE &&
            !state.localOnboarding.nextStepsComplete
          ) {
            const prompt = await this.nextSteps.prepareLocal(
              this.nextStepsSource(state),
            );
            if (prompt) {
              state.localOnboarding.pending = {
                requestId: uuid(),
                prompt: `${prompt}\n${this.canonicalUserContext(state)}\nReturn only JSON satisfying: ${JSON.stringify(zodToJsonSchema(featureNextStepsResponseSchema))}`,
                attempts: 0,
                kind: 'NEXT_STEPS',
              };
            } else {
              state.localOnboarding.nextStepsComplete = true;
            }
            await save();
            continue;
          }
          const lifecycleNode: INode = node;
          if (isPromptConfigurableNode(node) && node.promptConfig) {
            await lifecycleNode.beforeGeneration?.(
              tracker,
              state.localOnboarding.triggeringUserMessage,
            );
            const prompt = await this.prompts.buildPrompt(
              node,
              tracker,
              state.localOnboarding.triggeringUserMessage,
              routing.transitions,
            );
            const schema = node.promptConfig.responseSchema;
            if (!schema) {
              throw new Error(
                'Onboarding generation requires a response schema',
              );
            }
            state.localOnboarding.pending = {
              requestId: uuid(),
              prompt: `${prompt.fullPrompt}\n\n${this.canonicalUserContext(state)}\n\nReturn only JSON satisfying this schema:\n${JSON.stringify(zodToJsonSchema(schema))}`,
              attempts: 0,
            };
            state.context = tracker.getContext();
            await save();
            continue;
          }
          const { result, nextNodeId } = await this.nodes.executeNode(
            node.id,
            tracker,
            routing,
            state.localOnboarding.triggeringUserMessage,
          );
          state.context = tracker.getContext();
          await this.publish(
            state,
            node,
            convertNodeResultToSystemMessage(result, node.type, node.id),
            tx,
          );
          if (!this.waiting(state)) {
            this.move(state, nextNodeId);
          }
          await save();
        }
        throw new Error('Onboarding exceeded its automatic transition bound');
      },
      {
        timeout: 60000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  private canonicalUserContext(state: SerializableWorkflowState): string {
    // These admitted answers do not depend on asynchronous Q&A projections.
    return `Canonical onboarding answers (user-provided context):\n${JSON.stringify(state.localOnboarding?.userMessages ?? [])}`;
  }

  private waiting(state: SerializableWorkflowState): boolean {
    return state.step === WorkflowStep.WAITING_FOR_USER_INPUT;
  }

  private move(
    state: SerializableWorkflowState,
    next: string | undefined,
  ): void {
    if (!next) {
      throw new Error('Onboarding node has no next transition');
    }
    state.currentNodeId = next;
    state.step = WorkflowStep.EXECUTING_AUTO_NODE;
    state.context = {
      ...state.context,
      currentNodeExecution: { nodeId: next, questionsGenerated: false },
    };
  }

  private nextStepsSource(state: SerializableWorkflowState) {
    const context: RepositoryImportFlowContext = state.context;
    const { core } = context;
    return {
      organizationId: core.organizationId,
      projectId: core.projectId,
      conversationId: core.conversationId,
      workflowId: core.workflowId,
      userId: core.user.id,
      nodeId: ONBOARDING_NODES.FINALIZE,
      materializedFeatureIds:
        context.repositoryImportMaterializedFeatureIds ?? [],
    };
  }

  private async accept(
    state: SerializableWorkflowState,
    output: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (state.localOnboarding?.pending?.kind === 'NEXT_STEPS') {
      await this.nextSteps.recordLocal(
        this.nextStepsSource(state),
        JSON.parse(JsonExtractionUtil.extractJSONFromResponse(output)),
      );
      state.localOnboarding.nextStepsComplete = true;
      return;
    }
    const entry = this.nodes.getNode('onboarding', state.currentNodeId);
    if (
      !entry ||
      !isPromptConfigurableNode(entry.node) ||
      !entry.node.promptConfig?.responseSchema
    ) {
      throw new ConflictException('Saved request has no response schema');
    }
    const { routing } = entry;
    const node: INode = entry.node;
    const parsed: IntermediateSystemMessageData =
      entry.node.promptConfig.responseSchema.parse(
        JSON.parse(JsonExtractionUtil.extractJSONFromResponse(output)),
      );
    const tracker = createMutableContextHandle(state.context);
    const processed = await node.processLlmResponse?.(
      parsed,
      state.localOnboarding?.triggeringUserMessage,
      tracker,
    );
    state.context = tracker.getContext();
    const data = processed?.modifiedResult ?? {
      type: 'ANALYSIS',
      response: '',
      ...parsed,
      nodeId: node.id,
    };
    await this.publish(state, node, data, tx);
    if (state.step !== WorkflowStep.WAITING_FOR_USER_INPUT) {
      const intent = 'detectedIntent' in data ? data.detectedIntent : undefined;
      this.move(
        state,
        processed?.routingOverride ??
          (intent ? routing.transitions?.[intent]?.nextNodeId : undefined) ??
          routing.nextNode ??
          routing.transitions?.default?.nextNodeId,
      );
    }
  }

  private async publish(
    state: SerializableWorkflowState,
    node: INode,
    data: SystemMessageData,
    tx: Prisma.TransactionClient,
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
      'localOnboarding',
    );
    if (isGenerationSystemMessageData(data) && data.insights?.length) {
      const { LlmProcessor } = await import(
        '../../core/processing/llm-processor.service'
      );
      await this.appContext
        .get(LlmProcessor, { strict: false })
        .handleLLMCompletionEvent({
          id: message.id,
          type: 'llm.complete',
          aggregateId: message.id,
          payload: {
            payloadType: 'llm.complete',
            organizationId: core.organizationId,
            projectId: core.projectId,
            conversationId: core.conversationId,
            workflowId: core.workflowId,
            messageId: message.id,
            userId: core.user.id,
            nodeId: node.id,
            status: 'success',
            systemMessageData: data,
          },
        });
    }
    state.lastSystemMessageId = message.id as MessageId;
    state.context = {
      ...state.context,
      lastSystemMessageId: message.id as MessageId,
    };
    state.step =
      hasUiElements(data) && data.uiElements.length > 0
        ? WorkflowStep.WAITING_FOR_USER_INPUT
        : WorkflowStep.EXECUTING_AUTO_NODE;
  }
}
