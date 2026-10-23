import { invert } from 'lodash';
import { WorkStatus } from 'src/generated';

/**
 * Work Item Status Utilities
 *
 * This module provides utilities for working with the unified WorkStatus enum for work items.
 * The WorkStatus enum is shared between work items and initiatives to ensure consistent
 * status progression across the entire refinement system.
 *
 * Status Progression:
 * STANDARD tasks: REFINING_ACCEPTANCE_CRITERIA → BACKLOG (skip REFINING_DESCRIPTION)
 * FEATURE/BUG tasks: REFINING_DESCRIPTION → BACKLOG
 *
 * Generation States:
 * GENERATING_DESCRIPTION → GENERATING_DETAILS → GENERATING_ACCEPTANCE_CRITERIA → GENERATING_ALL
 *
 * Final States:
 * ACTIVE (ready for implementation), ON_HOLD, VERIFYING, COMPLETED, CANCELLED
 */

/**
 * Maps WorkStatus values to their corresponding refinement levels
 * This is the core function that determines which level a work item is currently at
 * based on its status in the database.
 */
export function getCurrentSectionFromStatus(
  status: string,
): 'description' | 'details' | 'acceptanceCriteria' {
  switch (status) {
    case 'GENERATED':
    case 'BACKLOG':
    case 'REFINING_DESCRIPTION':
    case 'GENERATING_DESCRIPTION':
      return 'description';
    case 'REFINING_DETAILS':
    case 'GENERATING_DETAILS':
    case 'GENERATING_DESCRIPTION_AND_DETAILS':
      return 'details';
    case 'REFINING_ACCEPTANCE_CRITERIA':
    case 'GENERATING_ACCEPTANCE_CRITERIA':
    case 'GENERATING_ALL':
      return 'acceptanceCriteria';
    case 'ACTIVE':
    case 'ON_HOLD':
    case 'VERIFYING':
    case 'COMPLETED':
    case 'CANCELLED':
      return 'acceptanceCriteria'; // Fully refined work items
    default:
      return 'description'; // Default for unknown statuses
  }
}

export function getPreviousSectionFromStatus(
  status: string,
): 'description' | 'details' | 'acceptanceCriteria' | '' {
  switch (status) {
    case 'GENERATED':
    case 'BACKLOG':
    case 'REFINING_DESCRIPTION':
    case 'GENERATING_DESCRIPTION':
      return '';
    case 'REFINING_DETAILS':
    case 'GENERATING_DETAILS':
    case 'GENERATING_DESCRIPTION_AND_DETAILS':
      return 'description';
    case 'REFINING_ACCEPTANCE_CRITERIA':
    case 'GENERATING_ACCEPTANCE_CRITERIA':
    case 'GENERATING_ALL':
      return 'details';
    default:
      return 'acceptanceCriteria';
  }
}

// Helper function to determine next level for work items
export function getPreviousSection(
  currentSection: 'description' | 'details' | 'acceptanceCriteria',
): 'description' | 'details' | 'acceptanceCriteria' | null {
  const levelProgression: Record<
    string,
    'description' | 'details' | 'acceptanceCriteria' | null
  > = {
    description: null,
    details: 'description',
    acceptanceCriteria: 'details',
  };

  return levelProgression[currentSection] || null;
}

const SECTION_ORDER: Record<
  'description' | 'details' | 'acceptanceCriteria',
  1 | 2 | 3
> = Object.freeze({
  description: 1,
  details: 2,
  acceptanceCriteria: 3,
});

const SECTION_BY_ORDER = invert(SECTION_ORDER) as Record<
  number,
  'description' | 'details' | 'acceptanceCriteria'
>;

export function getSectionOrder(
  section: 'description' | 'details' | 'acceptanceCriteria',
): 1 | 2 | 3 {
  return SECTION_ORDER[section];
}

export function getSectionByOrder(
  order: 1 | 2 | 3,
): 'description' | 'details' | 'acceptanceCriteria' {
  const section = SECTION_BY_ORDER[order];
  if (!section) {
    throw new Error(`Unknown section order: ${order}`);
  }
  return section;
}

// Helper function to determine next level for work items
export function getNextSection(
  currentSection: 'description' | 'details' | 'acceptanceCriteria',
): 'description' | 'details' | 'acceptanceCriteria' | null {
  const order = (getSectionOrder(currentSection) + 1) as 2 | 3 | 4;

  return order === 4 ? null : getSectionByOrder(order);
}

// Helper function to get next status from current level for work items
export function getNextStatusFromSection(
  currentLevel: string,
):
  | 'REFINING_DESCRIPTION'
  | 'REFINING_DETAILS'
  | 'REFINING_ACCEPTANCE_CRITERIA'
  | 'ACTIVE' {
  const statusMap: Record<
    string,
    | 'REFINING_DESCRIPTION'
    | 'REFINING_DETAILS'
    | 'REFINING_ACCEPTANCE_CRITERIA'
    | 'ACTIVE'
  > = {
    description: 'REFINING_DETAILS',
    details: 'REFINING_ACCEPTANCE_CRITERIA',
    acceptanceCriteria: 'ACTIVE', // Final level moves to ACTIVE
  };

  return statusMap[currentLevel] || 'ACTIVE';
}

/**
 * Get the next refinement level from current status
 * @param status The current WorkStatus
 * @returns The next refinement level
 */
export function getNextSectionFromStatus(
  status: string,
): 'description' | 'details' | 'acceptanceCriteria' {
  switch (status) {
    case 'GENERATED':
    case 'BACKLOG':
    case 'GENERATING_DESCRIPTION':
      return 'description';
    case 'REFINING_DESCRIPTION':
    case 'GENERATING_DETAILS':
    case 'GENERATING_DESCRIPTION_AND_DETAILS':
      return 'details';
    case 'REFINING_DETAILS':
    case 'REFINING_ACCEPTANCE_CRITERIA':
    case 'GENERATING_ACCEPTANCE_CRITERIA':
    case 'GENERATING_ALL':
      return 'acceptanceCriteria';
    case 'ACTIVE':
    case 'ON_HOLD':
    case 'VERIFYING':
    case 'COMPLETED':
    case 'CANCELLED':
      return 'acceptanceCriteria';
    default:
      return 'acceptanceCriteria'; // Default for unknown/final statuses
  }
}

/**
 * Get the next status based on current status
 * Handles both GENERATING_* and REFINING_* statuses:
 * - GENERATING_* → REFINING_* (stays at same level)
 * - REFINING_* → REFINING_NEXT (advances to next level)
 * @param status The current WorkStatus
 * @returns The next WorkStatus in the refinement progression
 */
export function getNextStatus(
  status: string,
):
  | 'REFINING_DESCRIPTION'
  | 'REFINING_DETAILS'
  | 'REFINING_ACCEPTANCE_CRITERIA'
  | 'ACTIVE' {
  const isGenerating = isGeneratingStatus(status);
  const currentSection = getCurrentSectionFromStatus(status);

  if (isGenerating) {
    // For GENERATING_* statuses, transition to REFINING_* at the SAME level
    return getRefiningStatusForSection(currentSection);
  }
  // For REFINING_* statuses, advance to the NEXT level
  return getNextStatusFromSection(currentSection);
}

/**
 * Get the appropriate GENERATING status for a given level
 * @param level The refinement level (description, details, acceptanceCriteria)
 * @returns The corresponding GENERATING status
 */
export function getGeneratingStatusForSection(
  level: 'description' | 'details' | 'acceptanceCriteria',
):
  | 'GENERATING_DESCRIPTION'
  | 'GENERATING_DETAILS'
  | 'GENERATING_DESCRIPTION_AND_DETAILS'
  | 'GENERATING_ACCEPTANCE_CRITERIA'
  | 'GENERATING_ALL' {
  const statusMap: Record<
    'description' | 'details' | 'acceptanceCriteria',
    | 'GENERATING_DESCRIPTION'
    | 'GENERATING_DETAILS'
    | 'GENERATING_DESCRIPTION_AND_DETAILS'
    | 'GENERATING_ACCEPTANCE_CRITERIA'
    | 'GENERATING_ALL'
  > = {
    description: 'GENERATING_DESCRIPTION',
    details: 'GENERATING_DETAILS',
    acceptanceCriteria: 'GENERATING_ACCEPTANCE_CRITERIA',
  };

  return statusMap[level];
}

/**
 * Get the appropriate REFINING status for a given level
 * @param level The refinement level (description, details, acceptanceCriteria)
 * @returns The corresponding REFINING status
 */
export function getRefiningStatusForSection(
  section: 'description' | 'details' | 'acceptanceCriteria',
):
  | 'REFINING_DESCRIPTION'
  | 'REFINING_DETAILS'
  | 'REFINING_ACCEPTANCE_CRITERIA' {
  const statusMap: Record<
    'description' | 'details' | 'acceptanceCriteria',
    'REFINING_DESCRIPTION' | 'REFINING_DETAILS' | 'REFINING_ACCEPTANCE_CRITERIA'
  > = {
    description: 'REFINING_DESCRIPTION',
    details: 'REFINING_DETAILS',
    acceptanceCriteria: 'REFINING_ACCEPTANCE_CRITERIA',
  };

  return statusMap[section];
}

/**
 * Check if a status indicates content generation is in progress
 * @param status The work item status to check
 * @returns True if the status is a GENERATING_* status
 */
export function isGeneratingStatus(status: string): boolean {
  return [
    'GENERATING_DESCRIPTION',
    'GENERATING_DETAILS',
    'GENERATING_DESCRIPTION_AND_DETAILS',
    'GENERATING_ACCEPTANCE_CRITERIA',
    'GENERATING_ALL',
  ].includes(status);
}

/**
 * Determine if multiple fields can be updated at a given level
 * @param level The refinement level
 * @returns True if multiple fields can be updated at this level
 */
export function canUpdateMultipleFieldsAtLevel(
  level: 'description' | 'details' | '',
): boolean {
  // Only description level is single-field, details and acceptanceCriteria can update multiple fields
  return level !== 'description';
}

export function getWorkItemSections(status: WorkStatus) {
  const currentSection = getCurrentSectionFromStatus(status);
  const isGenerating = isGeneratingStatus(status);
  const nextSection = isGenerating
    ? currentSection
    : getNextSection(currentSection);

  return { currentSection, nextSection };
}

export const isRefining = (status: WorkStatus) => {
  return (
    [
      WorkStatus.RefiningAcceptanceCriteria,
      WorkStatus.RefiningDescription,
      WorkStatus.RefiningDetails,
    ].includes(status) || isGeneratingStatus(status)
  );
};
