import type { LocalFinalAssessmentPromptPayload } from '../../shared/agent-bridge-contract/index';
import type { PromptTypeHandler, PromptTypeHandlerContext } from '../prompt-type-handler';
import { buildFinalAssessmentPrompt } from '../prompts/final-assessment';
import { buildStartingMessage as buildStartingMessageForPromptType } from '../prompts/starting-message';

/**
 * Restricted MCP tool allowlist for the final-assessment subagent. Covers
 * the two capabilities the prompt needs: reading project state and proposing
 * artifact updates. No filesystem tools — the subagent never touches source
 * code.
 */
const FINAL_ASSESSMENT_SUBAGENT_MCP_ALLOWED_TOOLS: readonly string[] = [
  // Context / read
  'get_context',
  'get_feature_sync_context',
  'get_full_entity',
  'get_agent_sessions',
  'list_services',
  'list_features',
  'get_recently_viewed',
  // Search
  'unified_search',
  'task_search',
  'plan_search',
  'search_features',
  'search_design_docs',
  'search_implementation_hints',
  // Proposal creation
  'create_work_item',
  'create_design_doc',
  'create_implementation_hint',
  // Proposal edits
  'edit_work_item',
  'edit_tasks',
  'edit_design_doc',
  'edit_implementation_hint',
  'delete_implementation_hint',
  // Proposal lifecycle
  'update_proposal',
  // Edges
  'create_edge',
  'update_edge',
  'delete_edge',
];

export const finalAssessmentHandler: PromptTypeHandler<LocalFinalAssessmentPromptPayload> = {
  id: 'final_assessment',
  promptType: 'final_assessment',
  service: 'required',
  launchEntity: 'none',
  implementationReadiness: 'none',
  expectedResponseTypes: ['final_assessment_v2'],
  runnerKind: 'subagent',
  providerSessionCountsForContext: false,
  reports: [],
  subagentConfig: {
    mcpAllowedTools: FINAL_ASSESSMENT_SUBAGENT_MCP_ALLOWED_TOOLS,
    builtinAllowedTools: [],
    adapterId: 'claude-sdk-final-assessment-subagent',
    // No filesystem tools, so the dispatcher has nothing to extract from the
    // raw provider events — skip the normalization pipe.
    emitNormalizedEvents: false,
  },

  buildPrompt(payload: LocalFinalAssessmentPromptPayload): string {
    return buildFinalAssessmentPrompt(payload);
  },

  buildStartingMessage(
    payload: LocalFinalAssessmentPromptPayload,
    ctx?: PromptTypeHandlerContext,
  ): string | null {
    return buildStartingMessageForPromptType('final_assessment', payload, ctx);
  },
};
