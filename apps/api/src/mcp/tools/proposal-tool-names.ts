/**
 * Canonical MCP proposal tool names.
 *
 * Referenced by both @Tool decorators (registration) and by
 * services that need to know whether an entity type has proposal
 * support (e.g. TaskService → hasProposalSupport).
 */

export const PROPOSAL_TOOL_NAMES = {
  CREATE_WORK_ITEM: 'create_work_item',
  EDIT_WORK_ITEM: 'edit_work_item',
  CREATE_DESIGN_DOC: 'create_design_doc',
  EDIT_DESIGN_DOC: 'edit_design_doc',
  PROPOSE_FUTURE_REVISION: 'propose_future_revision',
  CREATE_WORK_ITEM_TYPE: 'create_work_item_type',
  EDIT_WORK_ITEM_TYPE: 'edit_work_item_type',
  UPDATE_PROPOSAL: 'update_proposal',
  DELETE_PROPOSAL: 'delete_proposal',
  GET_PROPOSAL: 'get_proposal',
  GET_FUTURE_REVISION: 'get_future_revision',
} as const;

/** Canonical MCP tool names for explicit proposal-group authoring. */
export const PROPOSAL_GROUP_TOOL_NAMES = {
  START: 'start_proposal_group',
  GET_AUTHORING_SNAPSHOT: 'get_proposal_group_authoring_snapshot',
  REPLACE_PREREQUISITES: 'replace_proposal_group_prerequisites',
  REMOVE_MEMBER: 'remove_proposal_group_member',
  FINALIZE: 'finalize_proposal_group',
} as const;

/** Entity types that have at least one create or edit proposal tool. */
export const ENTITY_TYPES_WITH_PROPOSAL_SUPPORT: ReadonlySet<string> = new Set([
  'TASK',
  'DESIGN_DOC',
  // TODO: Remove once real proposal tools exist for initiatives
  'INITIATIVE',
]);

/**
 * Check whether a given entity type has MCP proposal tool support.
 */
export function hasProposalSupport(entityType: string): boolean {
  return ENTITY_TYPES_WITH_PROPOSAL_SUPPORT.has(entityType);
}

/** Canonical MCP tool names for orchestration tools. */
export const ORCHESTRATION_TOOL_NAMES = {
  CREATE_PLAN: 'create_plan',
} as const;

/** Canonical MCP tool name for shared topology authoring guidance. */
export const AUTHORING_GUIDANCE_TOOL_NAME = 'get_authoring_guidance' as const;

/** Canonical MCP tool names for agent-authored edges. */
export const EDGE_TOOL_NAMES = {
  CREATE_EDGE: 'create_edge',
  UPDATE_EDGE: 'update_edge',
  DELETE_EDGE: 'delete_edge',
} as const;

/** Canonical MCP tool names for goal-tracks attach/detach. */
export const GOAL_TRACKS_TOOL_NAMES = {
  ATTACH_TO_GOAL: 'attach_to_goal',
  DETACH_FROM_GOAL: 'detach_from_goal',
} as const;
