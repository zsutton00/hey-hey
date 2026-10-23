import { PlanDependenciesService } from './plan/plan-dependencies.service';
import { buildPlanResearchContext } from './plan/build-plan-research-context';
import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FlowExecutionStatus, Prisma } from '@prisma/client';
import {
  CodingPromptPlanningMessage,
  CodingPromptPlanningMessageRoleEnum,
  CodingPromptPlanningResponse,
  CodingPromptPlanningResponseModeEnum,
  CodingPromptPlanningRetrievalSummary,
  CodingPromptsPlanningResponseWrapper,
  CodingPromptsRequest,
  EvidenceItem,
  EvidenceItemSourceEnum,
  EvidenceItemTypeEnum,
  TaskSummaryTaskTypeEnum,
} from 'src/generated/agents/models';
import { ReportAudience } from 'src/generated';
import { CODING_PROMPT_RESEARCH_NODES } from 'src/flows/constants';
import { CODING_PROMPT_RESEARCH_FLOW_ID } from 'src/flows/templates/coding-prompt-research.flow';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  ConversationId,
  OrganizationId,
  PlanId,
  ProjectId,
  UserId,
  WorkflowId,
} from 'src/types';
import { CodingPromptResearchFlowContext } from 'src/types/flow-internal.types';
import {
  flowContextToSerializableState,
  isSerializableWorkflowState,
  SerializableWorkflowState,
} from 'src/workflows/conversation-workflow-state';
import { z } from 'zod';
import { MastraClientService } from './agents/mastra-client.service';
import { ReportService } from './reports/report.service';
import { FlowExecutionService } from './workflows/flow-execution.service';

export type CreateCodingPromptResearchExecutionInput = {
  taskId?: string;
  designDocId?: string;
  planId?: string;
  serviceId?: string;
};

export type ResolvedCodingPromptResearchTarget = {
  taskId?: string;
  designDocId?: string;
  planId?: string;
  serviceId?: string;
  /** Resolved service name for implementation hint searching. */
  serviceName?: string;
  projectId: ProjectId;
  workflowAboutType: 'task' | 'design-doc';
  workflowAboutId: string;
};

export type CodingPromptResearchExecutionStarted = {
  executionId: string;
  status: 'STARTED';
  createdAt: string;
  target: ResolvedCodingPromptResearchTarget;
};

const ResearchRelatedEntitySchema = z
  .object({
    entityId: z.string(),
    entityType: z.string(),
    entityName: z.string(),
  })
  .passthrough();

const PlanningMessageSchema: z.ZodType<CodingPromptPlanningMessage> = z
  .object({
    role: z.nativeEnum(CodingPromptPlanningMessageRoleEnum),
    content: z.string(),
    name: z.string().optional(),
  })
  .passthrough();

const RetrievalPlanStepSchema = z
  .object({
    index: z.number(),
    tool: z.string().optional(),
    query: z.string().optional(),
    why: z.string().optional(),
  })
  .passthrough();

const RetrievalDeniedStepSchema = z
  .object({
    index: z.number(),
    tool: z.string().optional(),
    query: z.string().optional(),
    reason: z.string().optional(),
  })
  .passthrough();

const RetrievalErrorDetailSchema = z
  .object({
    message: z.string(),
  })
  .passthrough();

const RetrievalErrorSchema = z
  .object({
    index: z.number(),
    tool: z.string().optional(),
    query: z.string().optional(),
    error: RetrievalErrorDetailSchema.optional(),
  })
  .passthrough();

const RetrievalSummarySchema: z.ZodType<CodingPromptPlanningRetrievalSummary> =
  z
    .object({
      planSteps: z.array(RetrievalPlanStepSchema),
      deniedSteps: z.array(RetrievalDeniedStepSchema),
      errors: z.array(RetrievalErrorSchema),
      fromCache: z.boolean(),
    })
    .passthrough();

const EvidenceItemSchema: z.ZodType<EvidenceItem> = z
  .object({
    id: z.string(),
    type: z.nativeEnum(EvidenceItemTypeEnum),
    title: z.string().optional(),
    content: z.string().optional(),
    topologySummary: z.string().optional(),
    score: z.number().optional(),
    source: z.nativeEnum(EvidenceItemSourceEnum).optional(),
  })
  .passthrough();

const ResearchCodingPromptPlanningResponseSchema: z.ZodType<CodingPromptPlanningResponse> =
  z
    .object({
      mode: z.nativeEnum(CodingPromptPlanningResponseModeEnum),
      messages: z.array(PlanningMessageSchema),
      plannerMessages: z.array(PlanningMessageSchema),
      retrieval: RetrievalSummarySchema,
      evidenceItems: z.array(EvidenceItemSchema),
      projectStateSummary: z.string().optional(),
      relatedEntities: z.array(ResearchRelatedEntitySchema),
    })
    .passthrough();

const ResearchCodingPromptsResponseWrapperSchema: z.ZodType<CodingPromptsPlanningResponseWrapper> =
  z
    .object({
      success: z.boolean(),
      data: ResearchCodingPromptPlanningResponseSchema,
    })
    .passthrough();

type CodingPromptResearchAgentResult =
  | CodingPromptsPlanningResponseWrapper
  | CodingPromptPlanningResponse;
type CodingPromptsRequestPayload = CodingPromptsRequest &
  Record<string, unknown>;

const ResearchAgentResponseSchema: z.ZodType<CodingPromptResearchAgentResult> =
  z.union([
    ResearchCodingPromptsResponseWrapperSchema,
    ResearchCodingPromptPlanningResponseSchema,
  ]);

type ResearchSectionSnapshot = {
  key: string;
  materializedMarkdown: string | null;
};

@Injectable()
export class CodingPromptService {
  private readonly logger = new Logger(CodingPromptService.name);
  private readonly shouldExecuteResearchAsync = process.env.NODE_ENV !== 'test';
  private readonly researchAgentId =
    process.env.CODING_PROMPT_RESEARCH_AGENT_ID ?? 'coding-prompts-planning';
  private readonly researchResponseSchema = ResearchAgentResponseSchema;

  constructor(
    private readonly planDependencies: PlanDependenciesService,
    private readonly prisma: PrismaService,
    private readonly flowExecutionService: FlowExecutionService,
    private readonly mastraClient: MastraClientService,
    private readonly reportService: ReportService,
  ) {}

  async createResearchExecution(
    organizationId: OrganizationId,
    userId: UserId,
    input: CreateCodingPromptResearchExecutionInput,
  ): Promise<CodingPromptResearchExecutionStarted> {
    const target = await this.resolveResearchTarget(organizationId, input);
    const requestPayload = this.toResearchRequestPayload(input);
    const startedAt = new Date();
    const execution = await this.flowExecutionService.createFlowExecution({
      userId,
      flowId: CODING_PROMPT_RESEARCH_FLOW_ID,
      organizationId,
      projectId: target.projectId,
      entityType: target.workflowAboutType,
      entityId: target.workflowAboutId,
      currentNode: CODING_PROMPT_RESEARCH_NODES.AGENT,
      totalNodes: 2,
      metadata: {
        executionType: 'coding-prompt-research',
        taskId: target.taskId ?? null,
        designDocId: target.designDocId ?? null,
        planId: target.planId ?? null,
        request: requestPayload,
      },
    });

    await this.prisma.db.flowExecution.update({
      where: {
        id: execution.id,
        organizationId,
      },
      data: {
        flowState: this.buildInitialResearchFlowState({
          executionId: execution.id,
          organizationId,
          userId,
          target,
          request: requestPayload,
          startedAt,
        }) as unknown as Prisma.InputJsonObject,
      },
    });

    this.logger.log('Creating coding prompt research execution', {
      organizationId,
      userId,
      executionId: execution.id,
      target,
    });

    if (this.shouldExecuteResearchAsync) {
      this.launchResearchExecution({
        executionId: execution.id,
        organizationId,
        userId,
        target,
        request: input,
      });
    }

    return {
      executionId: execution.id,
      status: 'STARTED',
      createdAt: startedAt.toISOString(),
      target,
    };
  }

  async resolveResearchTarget(
    organizationId: OrganizationId,
    input: CreateCodingPromptResearchExecutionInput,
  ): Promise<ResolvedCodingPromptResearchTarget> {
    const taskId = input.taskId?.trim();
    const designDocId = input.designDocId?.trim();
    const planId = input.planId?.trim();

    if (!taskId && !designDocId) {
      throw new BadRequestException('Either taskId or designDocId is required');
    }

    if (taskId && designDocId) {
      throw new BadRequestException(
        'Provide exactly one target: taskId or designDocId',
      );
    }

    if (planId && !taskId && !designDocId) {
      throw new BadRequestException(
        'planId cannot be provided without taskId or designDocId',
      );
    }

    const serviceId = input.serviceId?.trim();

    if (taskId) {
      return this.resolveTaskResearchTarget(
        organizationId,
        taskId,
        planId,
        serviceId,
      );
    }

    return this.resolveDesignDocResearchTarget(
      organizationId,
      designDocId as string,
      planId,
    );
  }

  private async resolveTaskResearchTarget(
    organizationId: OrganizationId,
    taskId: string,
    planId?: string,
    serviceId?: string,
  ): Promise<ResolvedCodingPromptResearchTarget> {
    const task = await this.prisma.db.task.findFirst({
      where: {
        id: taskId,
        organizationId,
      },
      select: {
        id: true,
        initiativeId: true,
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    const projectLink = await this.prisma.db.projectInitiative.findFirst({
      where: {
        initiativeId: task.initiativeId,
      },
      select: {
        projectId: true,
      },
    });

    if (!projectLink?.projectId) {
      throw new BadRequestException(
        `Unable to resolve project for task ${task.id}`,
      );
    }

    if (planId) {
      await this.assertPlanMatchesProject(
        organizationId,
        planId,
        projectLink.projectId,
      );
    }

    let serviceName: string | undefined;
    if (serviceId) {
      const service = await this.prisma.db.service.findFirst({
        where: { id: serviceId, organizationId },
        select: { name: true },
      });
      serviceName = service?.name?.trim() || undefined;
      if (!serviceName) {
        this.logger.warn(
          'Service not found for implementation hint search, skipping',
          { serviceId, organizationId },
        );
      }
    }

    return {
      taskId: task.id,
      ...(planId ? { planId } : {}),
      ...(serviceId ? { serviceId } : {}),
      ...(serviceName ? { serviceName } : {}),
      projectId: projectLink.projectId as ProjectId,
      workflowAboutType: 'task',
      workflowAboutId: task.id,
    };
  }

  private async resolveDesignDocResearchTarget(
    organizationId: OrganizationId,
    designDocId: string,
    planId?: string,
  ): Promise<ResolvedCodingPromptResearchTarget> {
    const designDoc = await this.prisma.db.designDoc.findFirst({
      where: {
        id: designDocId,
        organizationId,
      },
      select: {
        id: true,
        projectId: true,
      },
    });

    if (!designDoc) {
      throw new NotFoundException('Design doc not found');
    }

    if (!designDoc.projectId) {
      throw new BadRequestException(
        `Unable to resolve project for design doc ${designDoc.id}`,
      );
    }

    if (planId) {
      await this.assertPlanMatchesProject(
        organizationId,
        planId,
        designDoc.projectId,
      );
    }

    return {
      designDocId: designDoc.id,
      ...(planId ? { planId } : {}),
      projectId: designDoc.projectId as ProjectId,
      workflowAboutType: 'design-doc',
      workflowAboutId: designDoc.id,
    };
  }

  private async assertPlanMatchesProject(
    organizationId: OrganizationId,
    planId: string,
    projectId: string,
  ): Promise<void> {
    const plan = await this.prisma.db.task.findFirst({
      where: {
        id: planId,
        organizationId,
        type: 'PLAN',
      },
      select: {
        id: true,
        projectId: true,
      },
    });

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    if (plan.projectId !== projectId) {
      throw new BadRequestException(
        `planId ${planId} does not match the target entity project`,
      );
    }
  }

  private launchResearchExecution(params: {
    executionId: string;
    organizationId: OrganizationId;
    userId: UserId;
    target: ResolvedCodingPromptResearchTarget;
    request: CreateCodingPromptResearchExecutionInput;
  }): void {
    setImmediate(() => {
      void this.runResearchExecution(params).catch((error: unknown) => {
        this.logger.error(
          'Unexpected coding prompt research execution failure',
          {
            executionId: params.executionId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      });
    });
  }

  private async runResearchExecution(params: {
    executionId: string;
    organizationId: OrganizationId;
    userId: UserId;
    target: ResolvedCodingPromptResearchTarget;
    request: CreateCodingPromptResearchExecutionInput;
  }): Promise<void> {
    const startedAt = Date.now();
    const startedAtIso = new Date(startedAt).toISOString();
    const requestPayload = this.toResearchRequestPayload(params.request);
    let rawResultData: Record<string, unknown> | undefined;
    const execution = await this.prisma.db.flowExecution.findFirst({
      where: {
        id: params.executionId,
        organizationId: params.organizationId,
      },
      select: {
        metadata: true,
        flowState: true,
      },
    });

    if (!execution) {
      this.logger.error('Research execution not found while starting worker', {
        executionId: params.executionId,
      });
      return;
    }

    const baseMetadata = this.toMetadataObject(execution.metadata);
    const flowState = this.ensureResearchFlowState(
      execution.flowState,
      params,
      requestPayload,
      new Date(startedAt),
    );
    const inProgressFlowState = this.withResearchFlowState(flowState, {
      status: 'IN_PROGRESS',
      startedAt: startedAtIso,
      request: requestPayload,
      currentNodeId: CODING_PROMPT_RESEARCH_NODES.AGENT,
      clearError: true,
    });

    await this.prisma.db.flowExecution.update({
      where: {
        id: params.executionId,
        organizationId: params.organizationId,
      },
      data: {
        version: { increment: 1 },
        status: FlowExecutionStatus.IN_PROGRESS,
        currentNode: CODING_PROMPT_RESEARCH_NODES.AGENT,
        flowState: inProgressFlowState as unknown as Prisma.InputJsonObject,
        metadata: {
          ...baseMetadata,
          executionType: 'coding-prompt-research',
          request: requestPayload,
          startedAt: startedAtIso,
          lastUpdatedAt: startedAtIso,
        } as Prisma.InputJsonObject,
      },
    });

    try {
      const agentInput = await this.buildResearchAgentInput(
        params.organizationId,
        params.target,
      );
      const requestWithAgentInput = {
        ...requestPayload,
        agentInput: agentInput as unknown as Record<string, unknown>,
      };

      const agentResponse = await this.mastraClient.executeAgentStructured<
        CodingPromptsRequestPayload,
        Record<string, unknown>
      >(
        {
          agentId: this.researchAgentId,
          requestId: params.executionId,
          context: {
            organizationId: params.organizationId,
            projectId: params.target.projectId,
            conversationId: params.executionId as ConversationId,
            workflowAboutType: params.target.workflowAboutType,
            workflowAboutId: params.target.workflowAboutId,
            ...(params.target.planId
              ? { planId: params.target.planId as PlanId }
              : {}),
          },
          input: agentInput,
        },
        this.researchResponseSchema as unknown as z.ZodSchema<
          Record<string, unknown>
        >,
      );

      if (agentResponse.status !== 'completed') {
        throw new Error(
          `Research agent returned non-completed status: ${agentResponse.status}`,
        );
      }

      const resultData = agentResponse.result?.data;
      if (
        !resultData ||
        typeof resultData !== 'object' ||
        Array.isArray(resultData)
      ) {
        throw new Error('Research agent returned invalid result payload');
      }
      rawResultData = resultData as Record<string, unknown>;

      const parsedResult = this.researchResponseSchema.parse(rawResultData);
      const normalizedResult = this.normalizeResearchResult(parsedResult);
      const normalizedResultRecord = normalizedResult as unknown as Record<
        string,
        unknown
      >;
      await this.persistCodingResearchReport({
        organizationId: params.organizationId,
        executionId: params.executionId,
        target: params.target,
        result: normalizedResultRecord,
      });
      const completedAt = new Date();
      const completedAtIso = completedAt.toISOString();
      const completedFlowState = this.withResearchFlowState(
        inProgressFlowState,
        {
          status: 'COMPLETED',
          completedAt: completedAtIso,
          request: requestWithAgentInput,
          result: normalizedResultRecord,
          ...(rawResultData ? { rawResult: rawResultData } : {}),
          clearError: true,
          currentNodeId: CODING_PROMPT_RESEARCH_NODES.END,
        },
      );

      await this.prisma.db.flowExecution.update({
        where: {
          id: params.executionId,
          organizationId: params.organizationId,
        },
        data: {
          version: { increment: 1 },
          status: FlowExecutionStatus.COMPLETED,
          currentNode: CODING_PROMPT_RESEARCH_NODES.END,
          completedAt,
          executionTimeMs:
            agentResponse.executionTime ?? Date.now() - startedAt,
          errorCode: null,
          errorMessage: null,
          flowState: completedFlowState as unknown as Prisma.InputJsonObject,
          metadata: {
            ...baseMetadata,
            executionType: 'coding-prompt-research',
            request: requestWithAgentInput,
            completedAt: completedAtIso,
            agent: {
              agentId: this.researchAgentId,
              executionId: agentResponse.executionId,
              status: agentResponse.status,
              cost: agentResponse.cost ?? null,
            },
            result: normalizedResultRecord,
            ...(rawResultData ? { rawResult: rawResultData } : {}),
          } as Prisma.InputJsonObject,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Unknown research execution error';
      this.logger.error('Coding prompt research execution failed', {
        executionId: params.executionId,
        error: errorMessage,
      });
      const failedAt = new Date();
      const failedAtIso = failedAt.toISOString();
      const failedFlowState = this.withResearchFlowState(inProgressFlowState, {
        status: 'FAILED',
        completedAt: failedAtIso,
        ...(rawResultData ? { rawResult: rawResultData } : {}),
        error: {
          code: 'RESEARCH_EXECUTION_FAILED',
          message: errorMessage,
        },
        currentNodeId: CODING_PROMPT_RESEARCH_NODES.AGENT,
      });

      await this.prisma.db.flowExecution.update({
        where: {
          id: params.executionId,
          organizationId: params.organizationId,
        },
        data: {
          version: { increment: 1 },
          status: FlowExecutionStatus.FAILED,
          currentNode: CODING_PROMPT_RESEARCH_NODES.AGENT,
          completedAt: failedAt,
          executionTimeMs: Date.now() - startedAt,
          resumable: false,
          errorCode: 'RESEARCH_EXECUTION_FAILED',
          errorMessage,
          flowState: failedFlowState as unknown as Prisma.InputJsonObject,
          metadata: {
            ...baseMetadata,
            executionType: 'coding-prompt-research',
            request: requestPayload,
            failedAt: failedAtIso,
            ...(rawResultData ? { rawResult: rawResultData } : {}),
            error: {
              code: 'RESEARCH_EXECUTION_FAILED',
              message: errorMessage,
            },
          } as Prisma.InputJsonObject,
        },
      });
    }
  }

  private async persistCodingResearchReport(params: {
    organizationId: OrganizationId;
    executionId: string;
    target: ResolvedCodingPromptResearchTarget;
    result: Record<string, unknown>;
  }): Promise<void> {
    await this.reportService.createCodingResearchReport({
      organizationId: params.organizationId,
      projectId: params.target.projectId,
      sourceExecutionId: params.executionId,
      audience: ReportAudience.WorkflowOnly,
      payload: params.result,
      ...(params.target.taskId ? { taskId: params.target.taskId } : {}),
      ...(params.target.designDocId
        ? { designDocId: params.target.designDocId }
        : {}),
      ...(params.target.planId ? { planId: params.target.planId } : {}),
    });
  }

  private toResearchRequestPayload(
    input: CreateCodingPromptResearchExecutionInput,
  ): Record<string, unknown> {
    return {
      taskId: input.taskId ?? null,
      designDocId: input.designDocId ?? null,
      planId: input.planId ?? null,
    };
  }

  private buildInitialResearchFlowState(params: {
    executionId: string;
    organizationId: OrganizationId;
    userId: UserId;
    target: ResolvedCodingPromptResearchTarget;
    request: Record<string, unknown>;
    startedAt: Date;
  }): SerializableWorkflowState {
    const context: CodingPromptResearchFlowContext = {
      core: {
        workflowId: params.executionId as WorkflowId,
        projectId: params.target.projectId,
        organizationId: params.organizationId,
        conversationId: params.executionId as ConversationId,
        workflowAboutId: params.target.workflowAboutId,
        workflowAboutType: params.target.workflowAboutType,
        ...(params.target.planId
          ? { planId: params.target.planId as PlanId }
          : {}),
        user: {
          id: params.userId,
          role: 'member',
        },
        session: {
          startTime: params.startedAt,
          interactionCount: 0,
        },
      },
      flowId: CODING_PROMPT_RESEARCH_FLOW_ID,
      flowPath: {
        pathTaken: [],
        previousNode: undefined,
        previousTransition: undefined,
      },
      ...(params.target.taskId
        ? {
            taskId: params.target
              .taskId as CodingPromptResearchFlowContext['taskId'],
          }
        : {}),
      ...(params.target.designDocId
        ? {
            designDocId: params.target
              .designDocId as CodingPromptResearchFlowContext['designDocId'],
          }
        : {}),
      ...(params.target.planId
        ? { planId: params.target.planId as PlanId }
        : {}),
      research: {
        status: 'STARTED',
        startedAt: params.startedAt.toISOString(),
        request: params.request,
      },
    };

    return flowContextToSerializableState(
      context,
      CODING_PROMPT_RESEARCH_NODES.AGENT,
      undefined,
    );
  }

  private ensureResearchFlowState(
    flowState: unknown,
    params: {
      executionId: string;
      organizationId: OrganizationId;
      userId: UserId;
      target: ResolvedCodingPromptResearchTarget;
    },
    requestPayload: Record<string, unknown>,
    startedAt: Date,
  ): SerializableWorkflowState {
    if (isSerializableWorkflowState(flowState)) {
      return flowState;
    }

    if (
      flowState &&
      typeof flowState === 'object' &&
      !Array.isArray(flowState)
    ) {
      return flowContextToSerializableState(
        flowState as CodingPromptResearchFlowContext,
        CODING_PROMPT_RESEARCH_NODES.AGENT,
        undefined,
      );
    }

    return this.buildInitialResearchFlowState({
      executionId: params.executionId,
      organizationId: params.organizationId,
      userId: params.userId,
      target: params.target,
      request: requestPayload,
      startedAt,
    });
  }

  private withResearchFlowState(
    flowState: SerializableWorkflowState,
    update: {
      status: 'STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
      startedAt?: string;
      completedAt?: string;
      request?: Record<string, unknown>;
      result?: Record<string, unknown>;
      rawResult?: Record<string, unknown>;
      error?: {
        code: string;
        message: string;
      };
      clearError?: boolean;
      currentNodeId?: string;
    },
  ): SerializableWorkflowState {
    const currentContext =
      flowState.context as unknown as CodingPromptResearchFlowContext;
    const currentResearch = currentContext.research;
    const nextResearch: NonNullable<
      CodingPromptResearchFlowContext['research']
    > = {
      status: update.status,
      ...(currentResearch?.startedAt
        ? { startedAt: currentResearch.startedAt }
        : {}),
      ...(currentResearch?.completedAt
        ? { completedAt: currentResearch.completedAt }
        : {}),
      ...(currentResearch?.request ? { request: currentResearch.request } : {}),
      ...(currentResearch?.result ? { result: currentResearch.result } : {}),
      ...(currentResearch?.rawResult
        ? { rawResult: currentResearch.rawResult }
        : {}),
      ...(currentResearch?.error ? { error: currentResearch.error } : {}),
      ...(update.startedAt ? { startedAt: update.startedAt } : {}),
      ...(update.completedAt ? { completedAt: update.completedAt } : {}),
      ...(update.request ? { request: update.request } : {}),
      ...(update.result ? { result: update.result } : {}),
      ...(update.rawResult ? { rawResult: update.rawResult } : {}),
      ...(update.error ? { error: update.error } : {}),
    };

    if (update.clearError) {
      delete nextResearch.error;
    }

    const nextNodeId = update.currentNodeId ?? flowState.currentNodeId;

    return {
      ...flowState,
      context: {
        ...currentContext,
        research: nextResearch,
      } as unknown as typeof flowState.context,
      currentNodeId: nextNodeId,
      nodeConfig: {
        ...flowState.nodeConfig,
        id: nextNodeId,
      },
      timestamp: new Date().toISOString(),
    };
  }

  private async buildResearchAgentInput(
    organizationId: OrganizationId,
    target: ResolvedCodingPromptResearchTarget,
  ): Promise<CodingPromptsRequestPayload> {
    let basePayload: CodingPromptsRequestPayload;
    if (target.taskId) {
      basePayload = await this.buildTaskResearchAgentInput(
        organizationId,
        target,
      );
    } else {
      basePayload = await this.buildDesignDocResearchAgentInput(
        organizationId,
        target,
      );
    }

    if (target.serviceId) {
      return {
        ...basePayload,
        serviceId: target.serviceId,
      };
    }

    return basePayload;
  }

  private async buildTaskResearchAgentInput(
    organizationId: OrganizationId,
    target: ResolvedCodingPromptResearchTarget,
  ): Promise<CodingPromptsRequestPayload> {
    const task = await this.prisma.db.task.findFirst({
      where: {
        id: target.taskId,
        organizationId,
      },
      select: {
        id: true,
        name: true,
        type: true,
        initiativeId: true,
        sections: {
          orderBy: { order: 'asc' },
          select: {
            key: true,
            materializedMarkdown: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException(
        'Task not found while preparing research input',
      );
    }

    const taskSummary = this.buildRequiredTaskSummary({
      entityLabel: `task ${task.id}`,
      title: task.name,
      taskType: task.type as WorkItemTypeKey,
      sections: task.sections,
    });

    let initiativeSummary: CodingPromptsRequest['initiative'] | undefined;
    if (task.initiativeId) {
      const initiative = await this.prisma.db.initiative.findFirst({
        where: {
          id: task.initiativeId,
          organizationId,
        },
        select: {
          id: true,
          name: true,
          sections: {
            orderBy: { order: 'asc' },
            select: {
              key: true,
              materializedMarkdown: true,
            },
          },
        },
      });

      if (!initiative) {
        throw new NotFoundException(
          `Initiative ${task.initiativeId} not found while preparing research input`,
        );
      }

      initiativeSummary = this.buildRequiredInitiativeSummary({
        entityLabel: `initiative ${initiative.id}`,
        title: initiative.name,
        sections: initiative.sections,
      });
    }

    return {
      lastUserMessage: this.buildResearchLastUserMessage(target),
      ...(target.planId
        ? await this.buildResearchPlanPayload(
            organizationId,
            target.planId,
            { taskId: target.taskId },
            initiativeSummary?.description ?? taskSummary.description,
          )
        : {}),
      task: taskSummary,
      ...(!target.planId && initiativeSummary
        ? { initiative: initiativeSummary }
        : {}),
    };
  }

  private async buildDesignDocResearchAgentInput(
    organizationId: OrganizationId,
    target: ResolvedCodingPromptResearchTarget,
  ): Promise<CodingPromptsRequestPayload> {
    const designDoc = await this.prisma.db.designDoc.findFirst({
      where: {
        id: target.designDocId,
        organizationId,
      },
      select: {
        id: true,
        name: true,
        summary: true,
        sections: {
          orderBy: { order: 'asc' },
          select: {
            key: true,
            materializedMarkdown: true,
          },
        },
      },
    });

    if (!designDoc) {
      throw new NotFoundException(
        'Design doc not found while preparing research input',
      );
    }

    const taskSummary = this.buildOptionalTaskSummary({
      title: designDoc.name,
      sections: designDoc.sections,
      descriptionFallback: designDoc.summary ?? undefined,
    });
    if (!taskSummary) {
      throw new BadRequestException(
        `Design doc ${designDoc.id} is missing required fields for coding prompt planning`,
      );
    }

    return {
      lastUserMessage: this.buildResearchLastUserMessage(target),
      ...(target.planId
        ? await this.buildResearchPlanPayload(
            organizationId,
            target.planId,
            { designDocId: target.designDocId },
            taskSummary.description,
          )
        : {}),
      task: taskSummary,
    };
  }

  private buildResearchLastUserMessage(
    target: ResolvedCodingPromptResearchTarget,
  ): string {
    if (target.taskId) {
      return 'Generate a coding prompt for this task.';
    }

    return 'Generate a coding prompt from this design document context.';
  }

  private async buildResearchPlanPayload(
    organizationId: string,
    planId: string,
    target: { taskId?: string; designDocId?: string },
    _stageDescriptionFallback?: string,
  ) {
    return buildPlanResearchContext(
      this.prisma.db,
      this.planDependencies,
      organizationId,
      planId,
      target,
    );
  }

  private buildRequiredTaskSummary(params: {
    entityLabel: string;
    title?: string | null;
    taskType?: WorkItemTypeKey | null;
    sections: ResearchSectionSnapshot[];
  }): NonNullable<CodingPromptsRequest['task']> {
    const content = this.mapSectionContent(params.sections);
    const taskType = this.toAgentTaskSummaryType(params.taskType);

    return {
      ...(taskType ? { taskType } : {}),
      title: this.requireNonEmpty(params.title, `${params.entityLabel}.title`),
      description: this.requireNonEmpty(
        content.description,
        `${params.entityLabel}.description`,
      ),
      ...((
        params.taskType === WORK_ITEM_TYPE_KEYS.Bug ||
        params.taskType === WORK_ITEM_TYPE_KEYS.Feature
          ? undefined
          : this.normalizeNonEmpty(content.acceptanceCriteria)
      )
        ? { acceptanceCriteria: content.acceptanceCriteria }
        : {}),
    };
  }

  private buildRequiredInitiativeSummary(params: {
    entityLabel: string;
    title?: string | null;
    sections: ResearchSectionSnapshot[];
  }): NonNullable<CodingPromptsRequest['initiative']> {
    const content = this.mapSectionContent(params.sections);

    return {
      title: this.requireNonEmpty(params.title, `${params.entityLabel}.title`),
      description: this.requireNonEmpty(
        content.description,
        `${params.entityLabel}.description`,
      ),
      details: this.requireNonEmpty(
        content.details,
        `${params.entityLabel}.details`,
      ),
      acceptanceCriteria: this.requireNonEmpty(
        content.acceptanceCriteria,
        `${params.entityLabel}.acceptanceCriteria`,
      ),
    };
  }

  private buildOptionalTaskSummary(params: {
    taskType?: WorkItemTypeKey | null;
    title?: string | null;
    sections: ResearchSectionSnapshot[];
    descriptionFallback?: string;
  }): NonNullable<CodingPromptsRequest['task']> | undefined {
    const content = this.mapSectionContent(params.sections);
    const taskType = this.toAgentTaskSummaryType(params.taskType);
    const title = this.normalizeNonEmpty(params.title);
    const description =
      this.normalizeNonEmpty(content.description) ??
      this.normalizeNonEmpty(params.descriptionFallback);
    const acceptanceCriteria = this.normalizeNonEmpty(
      content.acceptanceCriteria,
    );

    if (!title || !description) {
      return undefined;
    }

    return {
      ...(taskType ? { taskType } : {}),
      title,
      description,
      ...((
        params.taskType === WORK_ITEM_TYPE_KEYS.Bug ||
        params.taskType === WORK_ITEM_TYPE_KEYS.Feature
          ? undefined
          : acceptanceCriteria
      )
        ? { acceptanceCriteria }
        : {}),
    };
  }

  private toAgentTaskSummaryType(
    taskType?: WorkItemTypeKey | null,
  ): TaskSummaryTaskTypeEnum | undefined {
    if (!taskType) {
      return undefined;
    }
    return taskType === WORK_ITEM_TYPE_KEYS.Bug
      ? TaskSummaryTaskTypeEnum.BUG
      : TaskSummaryTaskTypeEnum.STANDARD;
  }

  private mapSectionContent(sections: ResearchSectionSnapshot[]): {
    description: string;
    details: string;
    acceptanceCriteria: string;
  } {
    const content = {
      description: '',
      details: '',
      acceptanceCriteria: '',
    };

    for (const section of sections) {
      if (section.key === 'description') {
        content.description = section.materializedMarkdown ?? '';
      }
      if (section.key === 'details') {
        content.details = section.materializedMarkdown ?? '';
      }
      if (section.key === 'acceptanceCriteria') {
        content.acceptanceCriteria = section.materializedMarkdown ?? '';
      }
    }

    return content;
  }

  private requireNonEmpty(
    value: string | null | undefined,
    label: string,
  ): string {
    const normalized = this.normalizeNonEmpty(value);
    if (!normalized) {
      throw new Error(`Missing required field: ${label}`);
    }
    return normalized;
  }

  private normalizeNonEmpty(
    value: string | null | undefined,
  ): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private normalizeResearchResult(
    result: CodingPromptResearchAgentResult,
  ): CodingPromptsPlanningResponseWrapper {
    if (this.isWrappedResearchResult(result)) {
      return result;
    }

    return {
      success: true,
      data: result,
    };
  }

  private isWrappedResearchResult(
    value: CodingPromptResearchAgentResult,
  ): value is CodingPromptsPlanningResponseWrapper {
    return (
      typeof value === 'object' &&
      value !== null &&
      'success' in value &&
      'data' in value
    );
  }

  private toMetadataObject(metadata: unknown): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }
    return { ...(metadata as Record<string, unknown>) };
  }
}
