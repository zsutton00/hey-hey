import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import { Logger } from '@nestjs/common';
import {
  ArtifactType,
  InitiativeResponseDto,
  MaterializedWorkItemSection,
  QAPairData,
  TaskResponseDto,
} from 'src/generated';
import { ArtifactService } from 'src/services/artifacts/artifact.service';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import { WorkItemTypeRegistryService } from 'src/services/tasks/work-item-type-registry.service';
import { TaskRefinementFlowContext } from 'src/types/flow-internal.types';
import { formatArtifactForPrompt } from 'src/utils/artifact-formatting.util';
import { TaskActiveSectionEnum } from 'src/generated/agents/models';
import { TaskSummaryTaskTypeEnum } from 'src/generated/agents/models/TaskSummary';
import { materializedSectionsToContentMap } from 'src/utils/work-item-section.util';
import { getTaskActiveSection } from 'src/utils/task-refinement-profile.util';
import { TaskRefinerRequest, TaskRefinerRequestSchema } from './types';

const requireField = (value: string | null | undefined, label: string) => {
  if (value === null || value === undefined) {
    throw new Error(`Missing required field: ${label}`);
  }
  return value;
};

export const getCommonAgentInput = async (
  context: TaskRefinementFlowContext,
  lastUserMessage: {
    content?: string;
    id?: string;
  },
  task: Pick<TaskResponseDto, 'status' | 'name'> & {
    type?: WorkItemTypeKey | null;
    description?: string | null;
    acceptanceCriteria?: string | null;
    sections?: MaterializedWorkItemSection[] | null;
  },
  artifactService: ArtifactService,
  initiativeService: InitiativeService,
  workItemTypeRegistry: WorkItemTypeRegistryService,
  logger: Logger,
  {
    requiredOps,
  }: {
    requiredOps?: number;
  } = {},
): Promise<TaskRefinerRequest | undefined> => {
  try {
    if (!task) {
      logger.error('Task not found while building agent input', {
        taskId: context.taskId,
        initiativeId: context.initiativeId,
        organizationId: context.core.organizationId,
      });
      throw new Error(
        `Task not found while building agent input ${context.taskId}`,
      );
    }

    if (lastUserMessage.content === undefined) {
      logger.error('latestUserMessage not found while building agent input', {
        workflowId: context.core.workflowId,
        organizationId: context.core.organizationId,
      });
      throw new Error(`latestUserMessage not found while building agent input`);
    }

    if (!task.type) {
      logger.error('Task type missing while building agent input', {
        taskId: context.taskId,
        projectId: context.core.projectId,
        organizationId: context.core.organizationId,
      });
      throw new Error(
        `Task type missing while building agent input ${context.taskId}`,
      );
    }

    // Determine active section from status and the type's derived level set.
    const levels = workItemTypeRegistry.getTaskRefinementLevels(
      task.type,
      context.core.projectId,
    );
    const hasAcceptanceCriteria = levels.includes('acceptanceCriteria');
    const fallbackStatus = hasAcceptanceCriteria
      ? 'REFINING_ACCEPTANCE_CRITERIA'
      : 'REFINING_DESCRIPTION';
    const statusLevel = getTaskActiveSection(
      task.status || fallbackStatus,
      levels,
    ) as TaskActiveSectionEnum;

    // Fetch recent conversation messages (excluding current user message)
    let recentConversationMessages:
      | Array<{ id: string; content: string; role?: string }>
      | undefined;

    let initiative:
      | (Pick<InitiativeResponseDto, 'name'> & {
          acceptanceCriteria?: string | null;
          description?: string | null;
          details?: string | null;
          sections?: MaterializedWorkItemSection[] | null;
        })
      | null;
    try {
      if (!context.initiativeId) {
        throw new Error(
          `Initiative ID is required but missing while building agent input for task ${context.taskId}`,
        );
      }
      initiative = await initiativeService.findOneForAdapter(
        context.initiativeId,
        context.core.organizationId,
      );
      if (!initiative) {
        throw new Error(
          `Initiative ${context.initiativeId} not found while building agent input`,
        );
      }
    } catch (error) {
      logger.error('Failed to fetch initiative', {
        initiativeId: context.initiativeId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }

    try {
      const artifacts = await artifactService.findMany(
        {
          projectId: context.core.projectId,
          sourceId: String(context.core.conversationId),
          status: 'ACTIVE',
          limit: 3,
          type: ArtifactType.QaPair,
          orderBy: 'createdAt',
          orderDirection: 'desc',
        },
        context.core.organizationId,
      );

      const conversationEntries: Array<{
        id: string;
        content: string;
        role?: string;
      }> = [];

      for (const artifact of artifacts?.data ?? []) {
        const data = artifact.data as QAPairData | undefined;
        if (!data || data.type !== 'QA_PAIR') {
          continue;
        }
        if (data.userMessageId === lastUserMessage?.id) {
          continue;
        }
        const content = formatArtifactForPrompt(artifact, {
          includeTitle: false,
          includeContentHeader: false,
          includeType: false,
          includeTimestamp: false,
        });

        conversationEntries.push({
          id: artifact.id,
          content,
        });
      }

      recentConversationMessages = conversationEntries.length
        ? conversationEntries.slice(0, 3)
        : undefined;
    } catch (error) {
      logger.warn('Failed to fetch recent conversation messages', {
        conversationId: context.core.conversationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Continue without recent messages if fetch fails
      recentConversationMessages = undefined;
    }

    if (!task.sections || task.sections.length === 0) {
      logger.error('Task sections missing while building agent input', {
        taskId: context.taskId,
        organizationId: context.core.organizationId,
      });
      throw new Error(
        `Task ${context.taskId} is missing collaborative sections`,
      );
    }

    if (!initiative.sections || initiative.sections.length === 0) {
      logger.error('Initiative sections missing while building agent input', {
        initiativeId: context.initiativeId,
        organizationId: context.core.organizationId,
      });
      throw new Error(
        `Initiative ${context.initiativeId} is missing collaborative sections`,
      );
    }

    const taskContent = materializedSectionsToContentMap(task.sections);
    const initiativeContent = materializedSectionsToContentMap(
      initiative.sections,
    );

    const input: TaskRefinerRequest = {
      task: {
        taskType:
          task.type === WORK_ITEM_TYPE_KEYS.Bug
            ? TaskSummaryTaskTypeEnum.BUG
            : TaskSummaryTaskTypeEnum.STANDARD,
        title: requireField(task.name, 'task.name'),
        description: taskContent.description,
        acceptanceCriteria: hasAcceptanceCriteria
          ? taskContent.acceptanceCriteria
          : undefined,
      },
      initiative: {
        title: requireField(initiative.name, 'initiative.name'),
        description: initiativeContent.description,
        details: initiativeContent.details,
        acceptanceCriteria: initiativeContent.acceptanceCriteria,
      },
      lastUserMessage: lastUserMessage.content,
      activeSection: statusLevel,
      recentConversationMessages,
      requiredOps: requiredOps ?? 0,
    };

    const validation = TaskRefinerRequestSchema.safeParse(input);

    if (!validation.success) {
      const issues = validation.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      logger.warn('Task refiner input validation failed', {
        taskId: context.taskId,
        issues,
      });
      throw new Error(
        `Task refiner input validation failed: ${JSON.stringify(issues)}`,
      );
    }

    return validation.data;
  } catch (error) {
    logger.error('Failed to build task refiner input', {
      error: error instanceof Error ? error.message : 'Unknown error',
      taskId: context.taskId,
    });
    throw error;
  }
};
