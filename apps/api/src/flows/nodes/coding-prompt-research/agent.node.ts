import { PlanDependenciesService } from '../../../services/plan/plan-dependencies.service';
import { buildPlanResearchContext } from '../../../services/plan/build-plan-research-context';
import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import { Injectable } from '@nestjs/common';
import { SystemMessageData, UIElement } from 'src/generated';
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
import { PrismaService } from 'src/prisma/prisma.service';
import {
  AgentResponseShape,
  MastraAgentResponse,
} from 'src/services/agents/mastra-client.service';
import { DesignDocService } from 'src/services/design-doc/design-doc.service';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import { TaskService } from 'src/services/tasks/task.service';
import {
  CodingPromptResearchFlowContext,
  ProcessAgentResponseResult,
} from 'src/types/flow-internal.types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { materializedSectionsToContentMap } from 'src/utils/work-item-section.util';
import { z } from 'zod';
import { CODING_PROMPT_RESEARCH_NODES } from '../../constants';
import { AgentNodeBase } from '../base';

const RelatedEntitySchema = z
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

const PlanningResponseSchema: z.ZodType<CodingPromptPlanningResponse> = z
  .object({
    mode: z.nativeEnum(CodingPromptPlanningResponseModeEnum),
    messages: z.array(PlanningMessageSchema),
    plannerMessages: z.array(PlanningMessageSchema),
    retrieval: RetrievalSummarySchema,
    evidenceItems: z.array(EvidenceItemSchema),
    projectStateSummary: z.string().optional(),
    relatedEntities: z.array(RelatedEntitySchema),
  })
  .passthrough();

type ResearchAgentResponse =
  | CodingPromptsPlanningResponseWrapper
  | CodingPromptPlanningResponse;

const ResearchAgentResponseSchema: z.ZodType<ResearchAgentResponse> = z.union([
  z
    .object({
      success: z.boolean(),
      data: PlanningResponseSchema,
    })
    .passthrough() as z.ZodType<CodingPromptsPlanningResponseWrapper>,
  PlanningResponseSchema,
]);

function toAgentTaskSummaryType(
  taskType: WorkItemTypeKey,
): TaskSummaryTaskTypeEnum {
  return taskType === WORK_ITEM_TYPE_KEYS.Bug
    ? TaskSummaryTaskTypeEnum.BUG
    : TaskSummaryTaskTypeEnum.STANDARD;
}

@Injectable()
export class CodingPromptResearchAgentNode extends AgentNodeBase<
  CodingPromptResearchFlowContext,
  CodingPromptsRequest & Record<string, unknown>
> {
  readonly id = CODING_PROMPT_RESEARCH_NODES.AGENT;
  readonly title = 'Coding Prompt Research Agent';
  readonly agentId = 'coding-prompts-planning';
  readonly userPrompt = '';
  readonly responseSchema = ResearchAgentResponseSchema;

  constructor(
    private readonly planDependencies: PlanDependenciesService,
    private readonly prisma: PrismaService,
    private readonly taskService: TaskService,
    private readonly initiativeService: InitiativeService,
    private readonly designDocService: DesignDocService,
  ) {
    super();
  }

  async buildContext(
    tracker: MutableContextHandle<CodingPromptResearchFlowContext>,
  ): Promise<Record<string, unknown>> {
    const context = tracker.getContext();
    return {
      organizationId: context.core.organizationId,
      projectId: context.core.projectId,
      workflowId: context.core.workflowId,
      workflowAboutType: context.core.workflowAboutType,
      workflowAboutId: context.core.workflowAboutId,
      taskId: context.taskId,
      designDocId: context.designDocId,
      planId: context.planId,
    };
  }

  readonly agentInput = async (
    tracker: MutableContextHandle<CodingPromptResearchFlowContext>,
  ): Promise<CodingPromptsRequest & Record<string, unknown>> => {
    const context = tracker.getContext();
    const organizationId = context.core.organizationId;

    if (context.taskId) {
      const task = await this.taskService.findOneForAdapter(
        context.taskId,
        organizationId,
      );
      if (!task) {
        throw new Error(
          `Task ${context.taskId} not found while building research input`,
        );
      }

      const taskContent = materializedSectionsToContentMap(task.sections);
      const taskSummary = {
        taskType: toAgentTaskSummaryType(task.type),
        title: this.requireField(task.name, 'task.name'),
        description: this.requireField(
          taskContent.description,
          'task.description',
        ),
        ...(task.type === WORK_ITEM_TYPE_KEYS.Standard
          ? {
              acceptanceCriteria: this.requireField(
                taskContent.acceptanceCriteria,
                'task.acceptanceCriteria',
              ),
            }
          : {}),
      };

      const serviceId = await this.resolveServiceIdForTask(
        context.taskId,
        organizationId,
      );

      const initiativeId = context.initiativeId ?? task.initiativeId;
      let initiativeSummary: CodingPromptsRequest['initiative'] | undefined;
      if (initiativeId) {
        const initiative = await this.initiativeService.findOneForAdapter(
          initiativeId,
          organizationId,
        );
        if (initiative) {
          const initiativeContent = materializedSectionsToContentMap(
            initiative.sections,
          );
          initiativeSummary = {
            title: this.requireField(initiative.name, 'initiative.name'),
            description: this.requireField(
              initiativeContent.description,
              'initiative.description',
            ),
            details: this.requireField(
              initiativeContent.details,
              'initiative.details',
            ),
            acceptanceCriteria: this.requireField(
              initiativeContent.acceptanceCriteria,
              'initiative.acceptanceCriteria',
            ),
          };
        }
      }

      if (context.planId) {
        const planContext = await this.buildPlanContext(
          organizationId,
          context.planId,
          { taskId: context.taskId },
          initiativeSummary?.description ?? taskSummary.description,
        );

        return {
          lastUserMessage: 'Generate a coding prompt for this task.',
          task: taskSummary,
          plan: planContext.plan,
          planStage: planContext.planStage,
          ...(serviceId ? { serviceId } : {}),
        };
      }

      return {
        lastUserMessage: 'Generate a coding prompt for this task.',
        task: taskSummary,
        ...(initiativeSummary ? { initiative: initiativeSummary } : {}),
        ...(serviceId ? { serviceId } : {}),
      };
    }

    if (context.designDocId) {
      const designDoc = await this.designDocService.findOneForAdapter(
        context.designDocId,
        organizationId,
      );
      if (!designDoc) {
        throw new Error(
          `Design doc ${context.designDocId} not found while building research input`,
        );
      }

      const designDocSummary = this.toTaskSummaryFromDesignDoc(designDoc);

      if (context.planId) {
        const planContext = await this.buildPlanContext(
          organizationId,
          context.planId,
          { designDocId: context.designDocId },
          designDocSummary.description,
        );

        return {
          lastUserMessage:
            'Generate a coding prompt from this design document context.',
          task: designDocSummary,
          plan: planContext.plan,
          planStage: planContext.planStage,
        };
      }

      return {
        lastUserMessage:
          'Generate a coding prompt from this design document context.',
        task: designDocSummary,
      };
    }

    throw new Error('Coding prompt research requires taskId or designDocId');
  };

  async processAgentResponse(
    agentResponse: MastraAgentResponse<AgentResponseShape>,
    tracker: MutableContextHandle<CodingPromptResearchFlowContext>,
  ): Promise<ProcessAgentResponseResult> {
    if (!agentResponse.result?.data) {
      return {
        errorMsg: 'Coding prompt research agent returned empty result',
      };
    }

    const parsed = ResearchAgentResponseSchema.safeParse(
      agentResponse.result.data,
    );
    if (!parsed.success) {
      return {
        errorMsg: `Coding prompt research response validation failed: ${parsed.error.message}`,
      };
    }

    const normalized = this.normalizeWrapper(parsed.data);
    const rawResult =
      typeof agentResponse.result.data === 'object' &&
      agentResponse.result.data !== null &&
      !Array.isArray(agentResponse.result.data)
        ? (agentResponse.result.data as Record<string, unknown>)
        : undefined;

    tracker.mutate((draft) => {
      draft.research = {
        ...(draft.research ?? {
          status: 'IN_PROGRESS',
        }),
        status: 'COMPLETED',
        completedAt: new Date().toISOString(),
        result: normalized as unknown as Record<string, {}>,
        ...(rawResult
          ? { rawResult: rawResult as unknown as Record<string, {}> }
          : {}),
      };
    });

    const summaryMessage = this.resolveSummaryMessage(normalized.data);
    const systemMessageData = {
      ragEnabled: false,
      type: SystemMessageData.TypeEnum.Questions,
      nodeId: this.id,
      title: 'Coding Prompt Research',
      response: summaryMessage,
      detectedIntent: 'coding_prompt_research_complete',
      intentConfidence: 1,
      reasoning: 'coding prompt planning research complete',
      uiElements: [] as UIElement[],
    };

    return {
      nextNodeId: CODING_PROMPT_RESEARCH_NODES.END,
      systemMessageData,
    };
  }

  private async resolveServiceIdForTask(
    taskId: string,
    organizationId: string,
  ): Promise<string | undefined> {
    const relation = await this.prisma.db.serviceTask.findFirst({
      where: {
        taskId,
        service: { organizationId, archivedAt: null },
      },
      select: { serviceId: true },
      orderBy: { createdAt: 'desc' },
    });
    return relation?.serviceId ?? undefined;
  }

  private requireField(
    value: string | null | undefined,
    label: string,
  ): string {
    if (!value || !value.trim()) {
      throw new Error(`Missing required field: ${label}`);
    }
    return value;
  }

  private toTaskSummaryFromDesignDoc(
    designDoc: NonNullable<
      Awaited<ReturnType<DesignDocService['findOneForAdapter']>>
    >,
  ): CodingPromptsRequest['task'] {
    const sections = designDoc.sections ?? [];
    const contentByKey = sections.reduce<Record<string, string>>(
      (acc, section) => {
        acc[section.key] = section.materializedMarkdown ?? '';
        return acc;
      },
      {},
    );

    const title = designDoc.name?.trim();
    const description =
      contentByKey.description?.trim() || designDoc.summary?.trim() || '';
    const acceptanceCriteria = contentByKey.acceptanceCriteria?.trim() || '';

    if (!title || !description) {
      throw new Error(
        `Design doc ${designDoc.id} is missing required sections for coding prompt planning`,
      );
    }

    return {
      title,
      description,
      acceptanceCriteria,
    };
  }

  private async buildPlanContext(
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

  private normalizeWrapper(
    value: ResearchAgentResponse,
  ): CodingPromptsPlanningResponseWrapper {
    if ('success' in value && 'data' in value) {
      return value;
    }

    return {
      success: true,
      data: value,
    };
  }

  private resolveSummaryMessage(data: CodingPromptPlanningResponse): string {
    const projectSummary = data.projectStateSummary?.trim();
    if (projectSummary) {
      return projectSummary;
    }

    const plannerMessage = data.plannerMessages.find((message) =>
      this.hasReadableContent(message),
    );
    if (plannerMessage) {
      return plannerMessage.content;
    }

    const conversationMessage = data.messages.find((message) =>
      this.hasReadableContent(message),
    );
    if (conversationMessage) {
      return conversationMessage.content;
    }

    throw new Error(
      'Coding prompt planning response missing a readable summary message',
    );
  }

  private hasReadableContent(message: CodingPromptPlanningMessage): boolean {
    return (
      message.role !== CodingPromptPlanningMessageRoleEnum.tool &&
      message.content.trim().length > 0
    );
  }
}
