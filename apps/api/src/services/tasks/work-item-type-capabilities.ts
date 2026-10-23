/**
 * Capability flags a work-item type declares — the boolean switches the engine
 * reads when it resolves rules for a type. Stored as the `capabilities` JSONB
 * map on each `work_item_type` row and surfaced on
 * WorkItemTypeDefinitionDto.capabilities.
 *
 * This module is the single source of the capability KEY NAMES so the three
 * places that touch the map cannot disagree on spelling: the seed generator
 * (scripts/generate-work-item-type-seed.ts) writing the built-ins, deriveRules
 * unpacking the map into engine rules, and the enactment write persisting an
 * accepted custom definition. It is intentionally dependency-free so the seed
 * script can import it without pulling in the Nest service graph.
 */
export const WORK_ITEM_CAPABILITY_KEYS = {
  requiresParent: 'requiresParent',
  planEligible: 'planEligible',
  hasSetInitialStatus: 'hasSetInitialStatus',
  rendersInline: 'rendersInline',
  showsInExplorerSidebar: 'showsInExplorerSidebar',
} as const;

export type WorkItemCapabilityKey =
  (typeof WORK_ITEM_CAPABILITY_KEYS)[keyof typeof WORK_ITEM_CAPABILITY_KEYS];

/** The full capability map an item of a type carries. */
export type WorkItemCapabilities = Record<WorkItemCapabilityKey, boolean>;

/** Read one capability from a (possibly partial) stored map, defaulting false. */
export function readCapability(
  capabilities: { [K in WorkItemCapabilityKey]?: boolean } | null | undefined,
  key: WorkItemCapabilityKey,
): boolean {
  return capabilities?.[key] === true;
}
