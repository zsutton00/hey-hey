import type { ProjectModeSettings } from '../../generated';

export type ProjectModeEligibleTypeSource =
  | 'mode-settings'
  | 'legacy-type-guidance';

/**
 * Single source of a MODE's eligible work-item type keys, shared by the
 * eligibility policy and session capture. The per-MODE settings list wins;
 * MODEs without it keep the legacy shared agent-guidance derivation so
 * rollout never silently widens access.
 */
export function resolveProjectModeEligibleWorkItemTypeKeys(params: {
  modeTypeDefinition: {
    agentGuidance?: {
      contexts?: Array<{ focalTypeKeys: string[] }> | null;
    } | null;
  };
  settings: Pick<ProjectModeSettings, 'eligibleWorkItemTypeKeys'> | null;
}): { keys: string[]; source: ProjectModeEligibleTypeSource } {
  const perMode = params.settings?.eligibleWorkItemTypeKeys;
  if (perMode !== undefined && perMode !== null) {
    return {
      keys: Array.from(new Set(perMode)).sort(),
      source: 'mode-settings',
    };
  }
  return {
    keys: Array.from(
      new Set(
        (params.modeTypeDefinition.agentGuidance?.contexts ?? []).flatMap(
          (context) => context.focalTypeKeys,
        ),
      ),
    ).sort(),
    source: 'legacy-type-guidance',
  };
}
