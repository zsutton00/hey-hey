/**
 * Initiative Refinement Adapter Types
 *
 * Provides type-safe adapters between InitiativeResponseDto (generated API types)
 * and RefinableEntity (domain types) to enable unified refinement processing.
 */

import { InitiativeResponseDto } from '../generated';
import { materializedSectionsToContentMap } from '../utils/work-item-section.util';
import { RefinableEntity } from './refinable-entity.types';

/**
 * Initiative-specific refinable entity that extends the base interface
 * with initiative-specific fields while ensuring all required fields are present
 */
export interface InitiativeRefinableEntity extends RefinableEntity {
  // Initiative-specific fields (no additional fields needed beyond RefinableEntity)
  // Override base types with initiative-specific enums
  status: string; // WorkStatus as string for compatibility
  priority?: string | null; // Keep as string for compatibility with RefinableEntity
}

/**
 * Type guard to check if an InitiativeResponseDto has all required fields for refinement
 */
export function isValidInitiativeForRefinement(
  initiative: InitiativeResponseDto,
): initiative is Required<
  Pick<
    InitiativeResponseDto,
    'id' | 'name' | 'organizationId' | 'status' | 'createdAt' | 'updatedAt'
  >
> &
  Omit<
    InitiativeResponseDto,
    'id' | 'name' | 'organizationId' | 'status' | 'createdAt' | 'updatedAt'
  > {
  return (
    typeof initiative.id === 'string' &&
    typeof initiative.name === 'string' &&
    typeof initiative.organizationId === 'string' &&
    typeof initiative.status === 'string' &&
    typeof initiative.createdAt === 'string' &&
    typeof initiative.updatedAt === 'string' &&
    Array.isArray(initiative.sections) &&
    initiative.sections.length > 0
  );
}

/**
 * Converts InitiativeResponseDto to InitiativeRefinableEntity
 * Throws an error if required fields are missing
 */
export function toInitiativeRefinableEntity(
  initiative: InitiativeResponseDto,
): InitiativeRefinableEntity {
  if (!isValidInitiativeForRefinement(initiative)) {
    throw new Error(
      `Invalid initiative for refinement: missing required fields. Initiative ID: ${(initiative as { id: string }).id}`,
    );
  }

  const content = materializedSectionsToContentMap(initiative.sections);

  return {
    id: initiative.id,
    name: initiative.name,
    description: content.description,
    details: content.details,
    acceptanceCriteria: content.acceptanceCriteria,
    status: initiative.status,
    priority: initiative.priority?.toString() || null,
    assigneeId: initiative.assigneeId,
    organizationId: initiative.organizationId,
    createdAt: initiative.createdAt,
    updatedAt: initiative.updatedAt,
    tags: initiative.tags,
    reasoning: initiative.reasoning,
  };
}

/**
 * Validates that an initiative update preserves required fields
 */
export function validateInitiativeUpdate(
  original: InitiativeRefinableEntity,
  updates: Partial<InitiativeResponseDto>,
): void {
  const requiredFields: (keyof InitiativeRefinableEntity)[] = [
    'id',
    'name',
    'organizationId',
    'status',
  ];

  for (const field of requiredFields) {
    if (
      updates[field as keyof InitiativeResponseDto] === null ||
      updates[field as keyof InitiativeResponseDto] === undefined
    ) {
      if (original[field] === null || original[field] === undefined) {
        throw new Error(
          `Cannot update initiative: required field '${field}' would become null/undefined`,
        );
      }
    }
  }
}

/**
 * Applies updates to an InitiativeRefinableEntity while preserving type safety
 */
export function applyInitiativeUpdates(
  entity: InitiativeRefinableEntity,
  updates: Partial<InitiativeResponseDto>,
): InitiativeRefinableEntity {
  validateInitiativeUpdate(entity, updates);

  // Create updated entity with type safety
  const updated: InitiativeRefinableEntity = {
    ...entity,
    // Only apply defined updates, preserving original values for undefined
    ...(updates.name !== undefined && { name: updates.name }),
    ...(updates.status !== undefined && { status: updates.status }),
    ...(updates.priority !== undefined && {
      priority: updates.priority ? updates.priority.toString() : null,
    }),
    ...(updates.assigneeId !== undefined && { assigneeId: updates.assigneeId }),
    updatedAt: new Date().toISOString(), // Always update timestamp
  };

  return updated;
}
