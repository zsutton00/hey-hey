import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
/**
 * Task Optimization Service
 *
 * Implements the generic optimization interface for tasks, providing
 * task-specific change detection and optimization recommendations.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  BaseOptimizationService,
  WorkItemArtifactService,
} from '../base/base-optimization.service';
import { EntityType } from '../../types/refinable-entity.types';
import {
  ArtifactResponseDto,
  TaskPriority,
  WorkStatus,
  InsightData,
} from '../../generated';
import { ArtifactType } from '../../generated/model/artifactType';
import { TaskOriginalArtifactData } from '../../generated/model/taskOriginalArtifactData';
import { OrganizationId, TaskId } from '../../types';
import { TaskService } from './task.service';
import {
  TaskArtifactService,
  TaskOriginalData,
  toTaskOriginalArtifactTaskType,
} from './task-artifact.service';
import {
  TaskRefinableEntity,
  safeToTaskRefinableEntity,
} from '../../types/task-refinement-adapter.types';

/**
 * Adapter service to bridge between generic WorkItemArtifactService interface
 * and the specific TaskArtifactService implementation
 */
@Injectable()
class TaskArtifactServiceAdapter
  implements WorkItemArtifactService<TaskRefinableEntity>
{
  private readonly logger = new Logger(TaskArtifactServiceAdapter.name);
  private readonly advancedDebugPrefix = 'advanced_debug';

  constructor(private readonly taskArtifactService: TaskArtifactService) {}

  async getOriginalArtifact(
    entityId: string,
    organizationId: OrganizationId,
  ): Promise<TaskRefinableEntity | null> {
    this.logger.debug(
      `${this.advancedDebugPrefix} task_artifact.get_original.start`,
      {
        entityId,
        organizationId,
      },
    );

    const artifact = await this.taskArtifactService.getOriginalArtifactForTask(
      entityId as TaskId,
      organizationId,
    );

    if (!artifact) {
      this.logger.debug(
        `${this.advancedDebugPrefix} task_artifact.get_original.not_found`,
        {
          entityId,
          organizationId,
        },
      );
      return null;
    }

    // Parse the stored original data from the artifact
    try {
      this.logger.debug(
        `${this.advancedDebugPrefix} task_artifact.parse.start`,
        {
          entityId,
          organizationId,
          artifactId: artifact.id,
          dataType: artifact.data?.type,
        },
      );

      const originalData = this.extractOriginalTaskData(artifact);

      this.logger.debug(
        `${this.advancedDebugPrefix} task_artifact.parse.completed`,
        {
          entityId,
          organizationId,
          hasName: Boolean(originalData.name),
          descriptionLength: originalData.description?.length ?? 0,
          acceptanceCriteriaLength:
            originalData.acceptanceCriteria?.length ?? 0,
        },
      );

      return {
        id: entityId as TaskId,
        name: originalData.name,
        type: originalData.taskType ?? WORK_ITEM_TYPE_KEYS.Standard,
        description: originalData.description,
        details: '',
        acceptanceCriteria: originalData.acceptanceCriteria || '',
        status: WorkStatus.Backlog,
        priority: this.mapPriorityToDatabase(originalData.priority)?.toString(),
        assigneeId: undefined,
        organizationId,
        projectId: '',
        initiativeId: '',
        parentTaskId: undefined,
        createdAt: artifact.createdAt,
        updatedAt: artifact.updatedAt,
        archivedAt: undefined,
        dueDate: undefined,
      };
    } catch (error) {
      this.logger.error(
        `${this.advancedDebugPrefix} task_artifact.parse.error`,
        {
          entityId,
          organizationId,
          artifactId: artifact.id,
          error: error instanceof Error ? error.message : error,
        },
      );
      throw new Error(
        `Failed to parse original artifact data for task ${entityId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  private artifactDataIsOriginalTaskData(
    data: ArtifactResponseDto['data'],
  ): data is TaskOriginalArtifactData {
    return (
      (data as TaskOriginalArtifactData)?.type === ArtifactType.TaskOriginal
    );
  }

  private artifactDataIsInsightData(
    data: ArtifactResponseDto['data'],
  ): data is InsightData {
    return (data as TaskOriginalArtifactData)?.type === ArtifactType.Insight;
  }

  private extractOriginalTaskData(
    artifact: ArtifactResponseDto,
  ): TaskOriginalData {
    const data = artifact.data;

    if (this.artifactDataIsOriginalTaskData(data)) {
      this.logger.debug(
        `${this.advancedDebugPrefix} task_artifact.parse.task_original_payload`,
        {
          artifactId: artifact.id,
        },
      );
      return {
        type: 'TASK_ORIGINAL',
        taskType:
          data.taskType ?? TaskOriginalArtifactData.TaskTypeEnum.Standard,
        name: data.name ?? '',
        description: data.description ?? '',
        acceptanceCriteria: data.acceptanceCriteria ?? '',
        priority: data.priority ?? 'medium',
        estimatedEffort: data.estimatedEffort,
        tags: data.tags ?? [],
        reasoning: data.reasoning,
      };
    }

    // Legacy support for older artifacts that stored JSON in an INSIGHT payload
    if (this.artifactDataIsInsightData(data)) {
      this.logger.debug(
        `${this.advancedDebugPrefix} task_artifact.parse.insight_legacy_payload`,
        {
          artifactId: artifact.id,
        },
      );
      const parsed = JSON.parse(data.content);
      return {
        type: 'INSIGHT',
        taskType:
          parsed.taskType === WORK_ITEM_TYPE_KEYS.Bug
            ? TaskOriginalArtifactData.TaskTypeEnum.Bug
            : parsed.taskType === WORK_ITEM_TYPE_KEYS.Feature
              ? TaskOriginalArtifactData.TaskTypeEnum.Feature
              : parsed.taskType === WORK_ITEM_TYPE_KEYS.Goal
                ? TaskOriginalArtifactData.TaskTypeEnum.Goal
                : TaskOriginalArtifactData.TaskTypeEnum.Standard,
        name: parsed.name ?? parsed.title ?? '',
        description: parsed.description ?? '',
        acceptanceCriteria: parsed.acceptanceCriteria ?? '',
        priority: parsed.priority ?? 'medium',
        tags: parsed.tags ?? [],
        reasoning: parsed.reasoning,
      };
    }

    this.logger.warn(
      `${this.advancedDebugPrefix} task_artifact.parse.type_mismatch`,
      {
        artifactId: artifact.id,
        dataType: data?.type,
      },
    );
    throw new Error(
      `Expected TASK_ORIGINAL artifact, got ${data?.type || artifact.data?.type}`,
    );
  }

  async saveArtifactSnapshot(
    entity: TaskRefinableEntity,
    organizationId: OrganizationId,
  ): Promise<void> {
    // Convert TaskResponseDto to TaskOriginalData format for storage
    const originalData: TaskOriginalData = {
      type: ArtifactType.TaskOriginal,
      taskType: toTaskOriginalArtifactTaskType(entity.type),
      name: entity.name || '',
      description: entity.description || '',
      acceptanceCriteria:
        entity.type === WORK_ITEM_TYPE_KEYS.Standard
          ? entity.acceptanceCriteria || ''
          : '',
      priority: this.mapPriorityFromDatabase(entity.priority ?? undefined),
      tags: [], // Tasks don't currently have tags in the API
      reasoning: undefined, // Tasks don't currently have reasoning
    };

    // Store using the artifact service
    await this.taskArtifactService.storeOriginalGeneration(
      [originalData],
      [{ id: entity.id as TaskId }],
      organizationId,
      undefined, // Project ID not required for snapshots
      {
        sourceId: entity.id,
        generationModel: 'snapshot-save',
        generationPrompt: 'entity-snapshot',
        originalRequestContext: {
          source: 'optimization-service-snapshot',
          timestamp: new Date().toISOString(),
        },
      },
    );
  }

  private mapPriorityToDatabase(priority: string): TaskPriority {
    const mapping: Record<string, TaskPriority> = {
      low: TaskPriority.Low,
      medium: TaskPriority.Medium,
      high: TaskPriority.High,
      critical: TaskPriority.Critical,
    };
    return mapping[priority.toLowerCase()] || TaskPriority.Medium;
  }

  private mapPriorityFromDatabase(
    priority?: string,
  ): TaskOriginalArtifactData.PriorityEnum {
    if (!priority) return TaskOriginalArtifactData.PriorityEnum.Medium;

    // Handle both string and enum formats
    const priorityStr: string =
      typeof priority === 'string' ? priority : String(priority);
    const mapping: Record<string, TaskOriginalArtifactData.PriorityEnum> = {
      [TaskPriority.Low]: TaskOriginalArtifactData.PriorityEnum.Low,
      [TaskPriority.Medium]: TaskOriginalArtifactData.PriorityEnum.Medium,
      [TaskPriority.High]: TaskOriginalArtifactData.PriorityEnum.High,
      [TaskPriority.Critical]: TaskOriginalArtifactData.PriorityEnum.Critical,
    };
    return (
      mapping[priorityStr.toUpperCase()] ??
      TaskOriginalArtifactData.PriorityEnum.Medium
    );
  }
}

/**
 * Task-specific optimization service implementation
 * Extends BaseOptimizationService with task-specific behavior
 */
@Injectable()
export class TaskOptimizationService extends BaseOptimizationService<TaskRefinableEntity> {
  private readonly artifactServiceAdapter: TaskArtifactServiceAdapter;

  constructor(
    private readonly taskService: TaskService,
    private readonly taskArtifactService: TaskArtifactService,
  ) {
    super('TaskOptimizationService');
    this.artifactServiceAdapter = new TaskArtifactServiceAdapter(
      this.taskArtifactService,
    );
  }

  // Abstract method implementations from BaseOptimizationService

  protected getEntityType(): EntityType {
    return 'task';
  }

  protected async findOne(
    id: string,
    organizationId: OrganizationId,
  ): Promise<TaskRefinableEntity | null> {
    const task = await this.taskService.findOneForAdapter(
      id as TaskId,
      organizationId,
    );
    if (!task) {
      return null;
    }
    return safeToTaskRefinableEntity(task);
  }

  protected getArtifactService(): WorkItemArtifactService<TaskRefinableEntity> {
    return this.artifactServiceAdapter;
  }

  /**
   * Task-specific field weight configuration for change detection
   * Tasks may have different importance weighting than initiatives
   */
  protected getFieldWeight(field: string): number {
    const weights: Record<string, number> = {
      name: 0.4,
      description: 0.7, // Slightly higher importance for tasks
      acceptanceCriteria: 0.9,
      priority: 0.3,
      assigneeId: 0.4, // Higher importance for tasks since assignment is key
      status: 0.2, // Status changes are less significant for optimization
    };
    return weights[field] || 0.5;
  }

  /**
   * Task-specific similarity thresholds
   * Tasks might need different thresholds than initiatives
   */
  protected getTaskSimilarityThresholds() {
    return {
      SIMILARITY_THRESHOLD_MINOR: 0.8,
      SIMILARITY_THRESHOLD_MODERATE: 0.6,
      SKIP_LLM_THRESHOLD: 0.95,
      MAJOR_CHANGE_THRESHOLD: 0.4,
    };
  }

  /**
   * Check if task needs LLM processing based on task-specific criteria
   */
  protected shouldProcessTask(
    task: TaskRefinableEntity,
    changeIntensity: number,
  ): boolean {
    // Tasks in certain statuses might always need processing
    const alwaysProcessStatuses: WorkStatus[] = [
      'BACKLOG',
      'REFINING_DESCRIPTION',
    ];
    if (
      task.status &&
      alwaysProcessStatuses.includes(task.status as WorkStatus)
    ) {
      return changeIntensity > 0.1; // Lower threshold for new tasks
    }

    // Tasks with high priority might need more processing
    const highPriorityTypes: TaskPriority[] = [
      TaskPriority.High,
      TaskPriority.Critical,
    ];
    if (
      task.priority &&
      highPriorityTypes.includes(task.priority as TaskPriority)
    ) {
      return changeIntensity > 0.2; // Lower threshold for high priority
    }

    // Default to base class logic
    return changeIntensity > 0.3;
  }

  /**
   * Generate task-specific optimization hints
   */
  protected generateTaskOptimizationHints(
    task: TaskRefinableEntity,
    changeFields: string[],
  ): string[] {
    const hints: string[] = [];

    if (changeFields.includes('assigneeId')) {
      hints.push('Assignment changed - consider notifying affected users');
    }

    if (changeFields.includes('status')) {
      hints.push('Status changed - update dependent tasks and notifications');
    }

    if (changeFields.includes('priority')) {
      hints.push(
        'Priority changed - may affect sprint planning and resource allocation',
      );
    }

    if (task.parentTaskId) {
      hints.push('This is a subtask - changes may impact parent task');
    }

    return hints;
  }
}
