export const ACTIVE_CAP_PER_CATEGORY = 24;
export const BOOTSTRAP_MIN_FACETS = 12;
export const BOOTSTRAP_DIRECT_CREATE_PER_RUN = 6;
export const PROVISIONAL_EXPLORATION_MIN = 2;
export const PROVISIONAL_EXPLORATION_MAX = 12;
export const PROMOTE_TO_ACTIVE_SURVIVAL_COUNT = 3;
export const PROMOTE_CANDIDATES_PER_RUN_PER_CATEGORY = 2;

export type SummarizationPoolMode =
  | 'active_only'
  | 'active_with_provisional_fill'
  | 'provisional_only';

export function calculateProvisionalExplorationBudget(
  activeCount: number,
): number {
  return Math.min(
    PROVISIONAL_EXPLORATION_MAX,
    Math.max(
      PROVISIONAL_EXPLORATION_MIN,
      2 * Math.max(ACTIVE_CAP_PER_CATEGORY - activeCount, 0),
    ),
  );
}

export function shouldAllowDirectProvisionalCreate(params: {
  activeCount: number;
  provisionalCount: number;
  directCreatesThisRunForCategory: number;
}): boolean {
  const provisionalBudget = calculateProvisionalExplorationBudget(
    params.activeCount,
  );
  return (
    params.provisionalCount < provisionalBudget &&
    params.directCreatesThisRunForCategory < BOOTSTRAP_DIRECT_CREATE_PER_RUN
  );
}

export function canPromoteCandidate(params: {
  activeCount: number;
  provisionalCount: number;
}): boolean {
  return params.activeCount + params.provisionalCount < ACTIVE_CAP_PER_CATEGORY;
}

export function shouldPromoteProvisional(params: {
  survivalCount: number;
}): boolean {
  return params.survivalCount >= PROMOTE_TO_ACTIVE_SURVIVAL_COUNT;
}

export function buildSummarizationPoolMode(
  activeCount: number,
): SummarizationPoolMode {
  if (activeCount >= BOOTSTRAP_MIN_FACETS) {
    return 'active_only';
  }
  if (activeCount > 0) {
    return 'active_with_provisional_fill';
  }
  return 'provisional_only';
}
