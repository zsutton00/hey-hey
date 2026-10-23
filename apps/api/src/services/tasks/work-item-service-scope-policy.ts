import type { WorkItemTypeRules } from './work-item-type-registry.service';

/**
 * Service scope is a consumer policy of work-item authoring. The registry role
 * is the only classification that makes a type eligible; stable type keys and
 * capabilities must not be used as substitutes.
 */
export function isWorkItemServiceScopeEligible(
  rules: Pick<WorkItemTypeRules, 'role'> | null | undefined,
): boolean {
  return rules?.role === 'work-item';
}

export const WORK_ITEM_SERVICE_SCOPE_INVALID_REASON =
  'serviceIds is only valid for work-item types whose registry role is "work-item."';

export const WORK_ITEM_SERVICE_SCOPE_INVALID_SUGGESTION =
  'Omit serviceIds for types with a different registry role.';

export const WORK_ITEM_SERVICE_SCOPE_GUIDANCE = `## Complete known service scope

For a work-item type whose registry role is \`work-item\`, include \`serviceIds\` whenever implementation scope is known. The supplied IDs are the complete set: include every service explicitly mentioned in the description or implementation detail, without guessing additional services. On create, omit \`serviceIds\` only when scope is genuinely unknown. On edit, omit it to preserve current assignments; supply an empty array only to assert that the complete known set is empty.`;
