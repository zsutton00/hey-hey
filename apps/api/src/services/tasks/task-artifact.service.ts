import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
/**
 * Task Artifact Service
 *
 * Specialized service for managing task artifacts as INSIGHT type.
 * Provides operations specific to storing and retrieving original LLM-generated task data
 * for change detection and optimization purposes.
 */

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  EventContextManager,
  WithEventContext,
} from '../../core/events/observable-event.context';
import {
  ArtifactResponseDto,
  CreateArtifactDto,
  QueryArtifactsDto,
  Influence,
  TaskOriginalArtifactData,
  ArtifactType,
  UpdateArtifactDto,
} from '../../generated';
import { OrganizationId, ProjectId, TaskId } from '../../types';
import { ArtifactService } from '../artifacts/artifact.service';

// Re-export openapi-generated type for local consumers
export type TaskOriginalData = TaskOriginalArtifactData;

export function toTaskOriginalArtifactTaskType(
  taskType: WorkItemTypeKey,
): TaskOriginalArtifactData.TaskTypeEnum {
  switch (taskType) {
    case WORK_ITEM_TYPE_KEYS.Standard:
      return TaskOriginalArtifactData.TaskTypeEnum.Standard;
    case WORK_ITEM_TYPE_KEYS.Bug:
      return TaskOriginalArtifactData.TaskTypeEnum.Bug;
    case WORK_ITEM_TYPE_KEYS.Feature:
      return TaskOriginalArtifactData.TaskTypeEnum.Feature;
    case WORK_ITEM_TYPE_KEYS.Goal:
      return TaskOriginalArtifactData.TaskTypeEnum.Goal;
    default:
      throw new Error(
        `Task original artifacts do not support task type ${taskType}`,
      );
  }
}

/**
 * Specialized service for managing task artifacts as INSIGHT type
 * Follows the same patterns as InitiativeArtifactService but for tasks
 */
@Injectable()
export class TaskArtifactService {
  private readonly logger = new Logger(TaskArtifactService.name);

  constructor(private readonly artifactService: ArtifactService) {}

  /**
   * Store original LLM-generated task data as artifacts
   * Called during task generation to preserve original data for change detection
   */
  @WithEventContext('TaskArtifactService')
  async storeOriginalGeneration(
    tasks: TaskOriginalData[],
    realTasks: Array<{ id: TaskId }>,
    organizationId: OrganizationId,
    projectId?: ProjectId,
    generationContext?: {
      sourceId?: string;
      generationModel?: string;
      generationPrompt?: string;
      originalRequestContext?: Record<string, unknown>;
      influences?: Influence[];
    },
  ): Promise<ArtifactResponseDto[]> {
    this.logger.debug(`[storeOriginalGeneration] starting`, {
      tasks,
    });

    // Input validation
    if (!tasks || tasks.length === 0) {
      throw new BadRequestException('Tasks array cannot be empty');
    }
    if (!realTasks || realTasks.length === 0) {
      throw new BadRequestException('Real tasks array cannot be empty');
    }
    if (!organizationId) {
      throw new BadRequestException('Organization ID is required');
    }

    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    this.logger.log(
      '[storeOriginalGeneration] Storing original task artifacts',
      {
        count: tasks.length,
        organizationId,
        projectId,
        correlationId: currentContext?.correlationId,
      },
    );

    if (tasks.length !== realTasks.length) {
      const error = new BadRequestException(
        'Task generation validation failed: mismatch between draft and real tasks',
        {
          cause: 'TASK_COUNT_MISMATCH',
          description: `Expected ${tasks.length} tasks but found ${realTasks.length} real tasks`,
        },
      );

      this.logger.error('[storeOriginalGeneration] Task count mismatch', {
        draftCount: tasks.length,
        realCount: realTasks.length,
        projectId,
        organizationId,
      });

      throw error;
    }

    const artifacts: ArtifactResponseDto[] = [];

    if (!projectId) {
      throw new BadRequestException(
        'Project ID is required for task artifact creation. ' +
          'Ensure the initiative has an originatingProjectId.',
      );
    }

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const realTask = realTasks[i];

      try {
        if (!task || !realTask) {
          throw new BadRequestException(
            'Task generation validation failed: missing task at index',
            {
              cause: 'TASK_MISSING_INDEX',
              description: `Missing task data at index ${i}`,
            },
          );
        }

        const artifactData: CreateArtifactDto = {
          projectId,
          organizationId,
          type: ArtifactType.TaskOriginal,
          title: `Original Task: ${task.name}`,
          tags: [`task-${realTask.id}`, 'original-generation', 'task-artifact'],
          category: 'task-generation',
          priority: 'MEDIUM',
          data: {
            type: ArtifactType.TaskOriginal,
            taskType: task.taskType ?? WORK_ITEM_TYPE_KEYS.Standard,
            name: task.name,
            description: task.description ?? '',
            acceptanceCriteria: task.acceptanceCriteria,
            priority: task.priority ?? 'medium',
            estimatedEffort: task.estimatedEffort,
            tags: task.tags ?? [],
            reasoning: task.reasoning,
          } as TaskOriginalArtifactData,
          status: 'ACTIVE',
          isPublic: false,
          generateEmbedding: false, // We don't need embeddings for original data
          sourceType: 'TASK',
          sourceId: realTask.id,
          influences: generationContext?.influences,
        };

        const artifact = await this.artifactService.create(artifactData, {
          nodeId: 'N/A',
        });
        artifacts.push(artifact);

        this.logger.debug(
          '[storeOriginalGeneration] Created artifact for task',
          {
            taskId: realTask.id,
            artifactId: artifact.id,
            taskName: task.name,
          },
        );
      } catch (error) {
        this.logger.error(
          '[storeOriginalGeneration] Failed to create artifact for task',
          {
            error: error instanceof Error ? error.message : error,
            taskIndex: i,
            taskId: realTask?.id,
            taskName: task?.name,
          },
        );
        throw error;
      }
    }

    this.logger.log(
      '[storeOriginalGeneration] Successfully stored task artifacts',
      {
        artifactCount: artifacts.length,
        organizationId,
        projectId,
        correlationId: currentContext?.correlationId,
      },
    );

    return artifacts;
  }

  /**
   * Get original artifact for a specific task
   */
  async getOriginalArtifactForTask(
    taskId: TaskId,
    organizationId: OrganizationId,
  ): Promise<ArtifactResponseDto | null> {
    this.logger.debug('BUG205 getOriginalArtifactForTask start', {
      taskId,
      organizationId,
    });

    this.logger.debug(
      '[getOriginalArtifactForTask] Retrieving original artifact',
      {
        taskId,
        organizationId,
      },
    );

    // Query for artifacts with the specific task tag
    const queryDto: QueryArtifactsDto = {
      type: 'TASK_ORIGINAL',
      status: 'ACTIVE',
      sourceType: 'TASK',
      category: 'task-generation',
      tags: `task-${taskId}`,
      orderBy: 'createdAt',
      orderDirection: 'desc',
      limit: 1,
    };

    const artifactsResult = await this.artifactService.findMany(
      queryDto,
      organizationId,
    );

    if (artifactsResult.data.length === 0) {
      this.logger.debug(
        '[getOriginalArtifactForTask] No original artifact found',
        {
          taskId,
          organizationId,
        },
      );
      this.logger.debug('BUG205 tried to load TASK_ORIGINAL artifact? failed', {
        taskId,
        organizationId,
      });
      return null;
    }

    this.logger.debug('BUG205 tried to load TASK_ORIGINAL artifact? success', {
      taskId,
      organizationId,
      artifactId: artifactsResult.data[0]?.id,
      dataType: artifactsResult.data[0]?.data?.type,
    });

    return artifactsResult.data[0] ?? null;
  }

  async updateOriginalArtifactFields(
    taskId: TaskId,
    organizationId: OrganizationId,
    updates: Partial<
      Pick<TaskOriginalArtifactData, 'description' | 'acceptanceCriteria'>
    >,
  ): Promise<void> {
    if (!updates || Object.keys(updates).length === 0) {
      this.logger.warn('[updateOriginalArtifactFields] No updates provided', {
        taskId,
        organizationId,
      });
      return;
    }

    const artifact = await this.getOriginalArtifactForTask(
      taskId,
      organizationId,
    );

    this.logger.debug(
      '[updateOriginalArtifactFields] attempting to update original task',
      {
        hasArtifact: !!artifact,
        updates,
      },
    );

    if (!artifact) {
      this.logger.warn(
        '[updateOriginalArtifactFields] No original artifact found',
        {
          taskId,
          organizationId,
        },
      );
      return;
    }

    if (!this.isTaskOriginalArtifactData(artifact.data)) {
      this.logger.warn(
        '[updateOriginalArtifactFields] Artifact data is not TASK_ORIGINAL',
        {
          taskId,
          artifactId: artifact.id,
          organizationId,
          dataType: artifact.data?.type,
        },
      );
      return;
    }

    const updatedData: TaskOriginalArtifactData = {
      ...artifact.data,
      ...updates,
      type: ArtifactType.TaskOriginal,
    };

    const updateDto: UpdateArtifactDto = {
      data: updatedData,
    };

    await this.artifactService.update(artifact.id, updateDto, organizationId);
  }

  private isTaskOriginalArtifactData(
    data: ArtifactResponseDto['data'],
  ): data is TaskOriginalArtifactData {
    return (
      (data as TaskOriginalArtifactData)?.type === ArtifactType.TaskOriginal
    );
  }
}
