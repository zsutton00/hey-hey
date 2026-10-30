import type { ProjectModeSettings } from '../../generated';
import { WORK_ITEM_TYPE_KEYS } from './work-item-type-keys';

export type ProjectModeEligibleTypeSource = 'mode-settings' | 'default';

/**
 * MODEs whose settings omit eligibleWorkItemTypeKeys apply to STANDARD work
 * items only, the canonical applicability before per-MODE lists existed, so a
 * missing list never silently widens access.
 */
export const DEFAULT_PROJECT_MODE_ELIGIBLE_TYPE_KEYS: readonly string[] = [
  WORK_ITEM_TYPE_KEYS.Standard,
];

/**
 * Single source of a MODE's eligible work-item type keys, shared by the
 * eligibility policy and session capture.
 */
export function resolveProjectModeEligibleWorkItemTypeKeys(
  settings: Pick<ProjectModeSettings, 'eligibleWorkItemTypeKeys'> | null,
): { keys: string[]; source: ProjectModeEligibleTypeSource } {
  const perMode = settings?.eligibleWorkItemTypeKeys;
  if (perMode !== undefined && perMode !== null) {
    return {
      keys: Array.from(new Set(perMode)).sort(),
      source: 'mode-settings',
    };
  }
  return {
    keys: [...DEFAULT_PROJECT_MODE_ELIGIBLE_TYPE_KEYS],
    source: 'default',
  };
}
