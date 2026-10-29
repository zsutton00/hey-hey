/** Unknown tools are refused until their effects have been reviewed for inert execution. */
const INERT_SAFE_TOOLS: ReadonlySet<string> = new Set([
  'get_context',
  'get_edges',
  'get_full_entity',
  'get_diagram',
  'get_proposal',
  'get_report_body',
  'get_report_schema',
  'list_reports_by_entity',
  'list_features',
  'get_recently_viewed',
  'get_recently',
  'get_feature_sync_context',
  'get_work_item_type',
  'get_work_item_type_guidance_batch',
  'get_tool_guidance',
  'get_authoring_guidance',
  'get_future_revision',
  'get_proposal_group_authoring_snapshot',
  'unified_search',
  'unified_search_batch',
  'plan_search',
  'search_design_docs',
  'search_features',
  'search_implementation_hints',
  'task_search',
  'create_work_item',
  'edit_work_item',
  'create_design_doc',
  'edit_design_doc',
  'create_plan',
  'create_work_item_type',
  'edit_work_item_type',
  'start_proposal_group',
  'replace_proposal_group_prerequisites',
  'remove_proposal_group_member',
  'finalize_proposal_group',
]);

export const filterInertPlatformTools = (shortNames: readonly string[]): string[] =>
  shortNames.filter((name) => INERT_SAFE_TOOLS.has(name));

export const isInertPlatformToolAllowed = (shortName: string): boolean =>
  INERT_SAFE_TOOLS.has(shortName);

const INERT_SAFE_BUILTINS: ReadonlySet<string> = new Set(['Read', 'Glob', 'Grep', 'ToolSearch']);

export const filterInertBuiltinTools = (names: readonly string[]): string[] =>
  names.filter((name) => INERT_SAFE_BUILTINS.has(name));
