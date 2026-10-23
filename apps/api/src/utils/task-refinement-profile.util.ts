import { WorkStatus } from 'src/generated';
import { TaskActiveSectionEnum } from 'src/generated/agents/models';

export type TaskRefinementLevel = 'description' | 'acceptanceCriteria';

/**
 * The full, ordered refinement level set: description then acceptanceCriteria.
 * A type runs the two-level flow when its derived levels include
 * acceptanceCriteria. This is also the type-less default for the abstract
 * refinement fallbacks and the registry's last resort when a type's sections
 * cannot be resolved. Per-type level sets are derived from the type's sections
 * by WorkItemTypeRegistryService.getTaskRefinementLevels — the single source of
 * truth; every helper here is parameterized by that derived set.
 */
export const CANONICAL_REFINEMENT_LEVELS: readonly TaskRefinementLevel[] = [
  'description',
  'acceptanceCriteria',
];

const DESCRIPTION_STATUSES = new Set<string>([
  WorkStatus.Generated,
  WorkStatus.Backlog,
  WorkStatus.RefiningDescription,
  WorkStatus.GeneratingDescription,
]);

const LEGACY_DETAILS_STATUSES = new Set<string>([
  WorkStatus.RefiningDetails,
  WorkStatus.GeneratingDetails,
  WorkStatus.GeneratingDescriptionAndDetails,
]);

const ACCEPTANCE_STATUSES = new Set<string>([
  WorkStatus.RefiningAcceptanceCriteria,
  WorkStatus.GeneratingAcceptanceCriteria,
  WorkStatus.GeneratingAll,
]);

const REVIEW_STATUSES = new Set<string>([
  WorkStatus.Active,
  WorkStatus.OnHold,
  WorkStatus.Verifying,
  WorkStatus.Completed,
  WorkStatus.Cancelled,
  WorkStatus.Archived,
]);

export function isTaskRefinementLevel(
  value: string,
): value is TaskRefinementLevel {
  return value === 'description' || value === 'acceptanceCriteria';
}

export function isTaskSectionAllowedForType(
  sectionKey: string,
  levels: readonly TaskRefinementLevel[],
): boolean {
  return levels.includes(sectionKey as TaskRefinementLevel);
}

export function getTaskCurrentRefinementLevel(
  status: string,
  levels: readonly TaskRefinementLevel[],
): TaskRefinementLevel {
  if (DESCRIPTION_STATUSES.has(status)) {
    return 'description';
  }

  // Acceptance/legacy-details statuses only map to the acceptanceCriteria level
  // for a type that actually carries it; single-level types stay at description.
  if (
    levels.includes('acceptanceCriteria') &&
    (LEGACY_DETAILS_STATUSES.has(status) || ACCEPTANCE_STATUSES.has(status))
  ) {
    return 'acceptanceCriteria';
  }

  return 'description';
}

export function getTaskActiveSection(
  status: string,
  levels: readonly TaskRefinementLevel[],
): TaskActiveSectionEnum {
  if (REVIEW_STATUSES.has(status)) {
    return TaskActiveSectionEnum.review;
  }

  return getTaskCurrentRefinementLevel(status, levels) === 'acceptanceCriteria'
    ? TaskActiveSectionEnum.acceptanceCriteria
    : TaskActiveSectionEnum.description;
}

export function getTaskNextRefinementLevel(
  currentLevel: TaskRefinementLevel,
  levels: readonly TaskRefinementLevel[],
): TaskRefinementLevel | null {
  const currentIndex = levels.indexOf(currentLevel);
  if (currentIndex === -1) {
    return null;
  }
  return levels[currentIndex + 1] ?? null;
}

export function getTaskNextRefinementLevelFromStatus(
  status: string,
  levels: readonly TaskRefinementLevel[],
): TaskRefinementLevel | null {
  if (LEGACY_DETAILS_STATUSES.has(status)) {
    return 'acceptanceCriteria';
  }
  if (isGeneratingTaskRefinementStatus(status)) {
    return getTaskCurrentRefinementLevel(status, levels);
  }
  const currentLevel = getTaskCurrentRefinementLevel(status, levels);
  return getTaskNextRefinementLevel(currentLevel, levels);
}

export function getTaskPreviousRefinementLevel(
  currentLevel: TaskRefinementLevel,
  levels: readonly TaskRefinementLevel[],
): TaskRefinementLevel | null {
  const currentIndex = levels.indexOf(currentLevel);
  if (currentIndex <= 0) {
    return null;
  }
  return levels[currentIndex - 1] ?? null;
}

export function getTaskRefiningStatusForLevel(
  level: TaskRefinementLevel,
): WorkStatus {
  return level === 'acceptanceCriteria'
    ? WorkStatus.RefiningAcceptanceCriteria
    : WorkStatus.RefiningDescription;
}

export function getTaskGeneratingStatusForLevel(
  level: TaskRefinementLevel,
): WorkStatus {
  return level === 'acceptanceCriteria'
    ? WorkStatus.GeneratingAcceptanceCriteria
    : WorkStatus.GeneratingDescription;
}

export function isGeneratingTaskRefinementStatus(status: string): boolean {
  return (
    status === WorkStatus.GeneratingDescription ||
    status === WorkStatus.GeneratingDetails ||
    status === WorkStatus.GeneratingDescriptionAndDetails ||
    status === WorkStatus.GeneratingAcceptanceCriteria ||
    status === WorkStatus.GeneratingAll
  );
}

export function getTaskNextStatus(
  status: string,
  levels: readonly TaskRefinementLevel[],
): WorkStatus {
  if (LEGACY_DETAILS_STATUSES.has(status)) {
    return getTaskRefiningStatusForLevel('acceptanceCriteria');
  }

  const currentLevel = getTaskCurrentRefinementLevel(status, levels);

  if (isGeneratingTaskRefinementStatus(status)) {
    return getTaskRefiningStatusForLevel(currentLevel);
  }

  const nextLevel = getTaskNextRefinementLevel(currentLevel, levels);
  if (!nextLevel) {
    return WorkStatus.Active;
  }

  return getTaskRefiningStatusForLevel(nextLevel);
}

export function canTaskFinalizeAtLevel(
  level: TaskRefinementLevel,
  levels: readonly TaskRefinementLevel[],
): boolean {
  return level === levels[levels.length - 1];
}

export function getTaskRefinementProgressPercentage(
  level: TaskRefinementLevel,
  levels: readonly TaskRefinementLevel[],
): number {
  const index = levels.indexOf(level);
  if (index === -1) {
    return 0;
  }
  return Math.round(((index + 1) / levels.length) * 100);
}
