import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
/**
 * Task Refinement Adapter Types
 *
 * Provides type-safe adapters between TaskResponseDto (generated API types)
 * and RefinableEntity (domain types) to enable unified refinement processing.
 */

import { OrganizationId } from 'src/types';
import {
  TaskPriority,
  TaskResponseDto,
  TaskSource,
  WorkStatus,
} from '../generated';
import { materializedSectionsToContentMap } from '../utils/work-item-section.util';
import { RefinableEntity } from './refinable-entity.types';
/**
 * Task-specific refinable entity that extends the base interface
 * with task-specific fields while ensuring all required fields are present
 */
export interface TaskRefinableEntity extends RefinableEntity {
  // Task-specific fields
  type: WorkItemTypeKey;
  projectId: string;
  initiativeId: string;
  dueDate?: string | null;
  parentTaskId?: string | null;
  archivedAt?: string | null;
  source?: TaskSource;

  // Override base types with task-specific enums
  status: string; // WorkStatus as string for compatibility
  priority?: string | null; // Keep as string for compatibility with RefinableEntity?
}

/**
 * Type guard to check if a TaskResponseDto has all required fields for refinement
 */
export function isValidTaskForRefinement(
  task: TaskResponseDto,
): task is Required<
  Pick<
    TaskResponseDto,
    'id' | 'name' | 'organizationId' | 'status' | 'createdAt' | 'updatedAt'
  >
> &
  Omit<
    TaskResponseDto,
    'id' | 'name' | 'organizationId' | 'status' | 'createdAt' | 'updatedAt'
  > {
  return (
    typeof task.id === 'string' &&
    typeof task.name === 'string' &&
    typeof task.organizationId === 'string' &&
    typeof task.status === 'string' &&
    typeof task.createdAt === 'string' &&
    typeof task.updatedAt === 'string' &&
    Array.isArray(task.sections) &&
    task.sections.length > 0
  );
}

/**
 * Converts TaskResponseDto to TaskRefinableEntity
 * Throws an error if required fields are missing
 */
export function toTaskRefinableEntity(
  task: TaskResponseDto,
): TaskRefinableEntity {
  if (!isValidTaskForRefinement(task)) {
    throw new Error(
      `Invalid task for refinement: missing required fields. Task ID: ${task.id}`,
    );
  }

  const content = materializedSectionsToContentMap(task.sections);

  return {
    id: task.id,
    name: task.name,
    type: task.type,
    description: content.description,
    details: content.details,
    acceptanceCriteria:
      task.type === WORK_ITEM_TYPE_KEYS.Standard
        ? content.acceptanceCriteria
        : '',
    status: task.status,
    priority: task.priority?.toString() || null,
    assigneeId: task.assigneeId,
    organizationId: task.organizationId as OrganizationId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,

    // Task-specific fields
    projectId: task.projectId,
    initiativeId: task.initiativeId || '',
    dueDate: task.dueDate,
    parentTaskId: task.parentTaskId,
    archivedAt: task.archivedAt,
    source: task.source,
  };
}

/**
 * Converts TaskRefinableEntity back to TaskResponseDto for API responses
 */
export function fromTaskRefinableEntity(
  entity: TaskRefinableEntity,
): TaskResponseDto {
  return {
    id: entity.id,
    name: entity.name,
    type: entity.type,
    organizationId: entity.organizationId,
    projectId: entity.projectId,
    status: entity.status as WorkStatus,
    priority: entity.priority ? (entity.priority as TaskPriority) : undefined,
    assigneeId: entity.assigneeId ?? undefined,
    createdAt:
      typeof entity.createdAt === 'string'
        ? entity.createdAt
        : entity.createdAt.toISOString(),
    updatedAt:
      typeof entity.updatedAt === 'string'
        ? entity.updatedAt
        : entity.updatedAt.toISOString(),

    // Task-specific fields
    initiativeId: entity.initiativeId,
    dueDate: entity.dueDate ?? undefined,
    parentTaskId: entity.parentTaskId ?? undefined,
    archivedAt: entity.archivedAt ?? undefined,
    source: entity.source ?? 'system',
  };
}

/**
 * Safe conversion with error handling and validation
 */
export function safeToTaskRefinableEntity(
  task: TaskResponseDto,
): TaskRefinableEntity | null {
  try {
    return toTaskRefinableEntity(task);
  } catch (error) {
    console.warn(`Failed to convert task to refinable entity:`, error);
    return null;
  }
}

/**
 * Validates that a task update preserves required fields
 */
export function validateTaskUpdate(
  original: TaskRefinableEntity,
  updates: Partial<TaskResponseDto>,
): void {
  const requiredFields: (keyof TaskRefinableEntity)[] = [
    'id',
    'name',
    'organizationId',
    'status',
  ];

  for (const field of requiredFields) {
    if (
      updates[field as keyof TaskResponseDto] === null ||
      updates[field as keyof TaskResponseDto] === undefined
    ) {
      if (original[field] === null || original[field] === undefined) {
        throw new Error(
          `Cannot update task: required field '${field}' would become null/undefined`,
        );
      }
    }
  }
}

/**
 * Applies updates to a TaskRefinableEntity while preserving type safety
 */
export function applyTaskUpdates(
  entity: TaskRefinableEntity,
  updates: Partial<TaskResponseDto>,
): TaskRefinableEntity {
  validateTaskUpdate(entity, updates);

  // Create updated entity with type safety
  const updated: TaskRefinableEntity = {
    ...entity,
    // Only apply defined updates, preserving original values for undefined
    ...(updates.name !== undefined && { name: updates.name }),
    ...(updates.status !== undefined && { status: updates.status }),
    ...(updates.priority !== undefined && {
      priority: updates.priority ? updates.priority.toString() : null,
    }),
    ...(updates.assigneeId !== undefined && { assigneeId: updates.assigneeId }),
    ...(updates.dueDate !== undefined && { dueDate: updates.dueDate }),
    ...(updates.parentTaskId !== undefined && {
      parentTaskId: updates.parentTaskId,
    }),
    ...(updates.type !== undefined && { type: updates.type }),
    updatedAt: new Date().toISOString(), // Always update timestamp
  };

  return updated;
}
