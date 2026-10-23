import type { UIElement } from "../../../api";
import type { ResponseBehavior } from "../../Conversation/Components/conversationFormTypes";
import type { FieldShouldShowFormContext } from "./types";

// Conversation response resolution runs while fields are being imported. Keep
// this metadata free of component imports so it cannot initialize the registry.
const DISPLAY_ONLY_TYPES = new Set([
  "open_items_triage",
  "__message__",
  "agent_response",
  "verify_feature",
  "agent_hidden",
  "agent_search_results",
  "interstitial",
  "session_monitor",
  "file_diff",
]);

const CONTRIBUTION_FIELD_TYPES = new Set(["implementation_readiness"]);

const EXCLUSIVE_FIELD_TYPES = new Set([
  "textarea", "agent-reply-textarea", "currency", "priority", "text", "number", "select",
  "repository_grounding_intent", "datepicker", "integrations",
  "team_members", "initiative_list", "initiative_intro", "button_group",
  "complete_onboarding", "task_generation", "feature_list",
  "repository_placement_strategy", "repository_placement_review",
  "task_feedback", "task_list", "task_stub", "task_priority",
  "adr_context_starter", "adr_agent_response",
  "agent_complete", "agent_request_permission", "agent_question",
  "agent_request_service_scope",
  "agent_request_review_file_scope", "coding_prompt_final_assessment",
  "coding_prompt_merged_final_assessment", "coding_prompt_startup_plan",
  "plan_document_view", "question_group", "multiple_choice", "goal_pm_action",
  "coding_prompt", "service_selector", "repository_grounding",
  "plan_gaps_services", "plan_gaps_design_docs", "plan_gaps_tasks",
  "plan_approval", "plan_stage_proposal", "sync_recommendation",
  "reconciliation_report", "plan_generation_stage_review",
  "plan_generation_step_review",
  "plan_generation_journey_review", "plan_generation_visual_preview",
  "plan_generation_finalize", "plan_shaping_feature_sync_review",
]);

const TYPE_MAPPING: Record<string, string> = {
  text_input: "text",
  textarea: "textarea",
  select: "select",
  button_group: "button_group",
  checkbox: "text",
  integration_selector: "integrations",
  initiative_list: "initiative_list",
  initiative: "initiative",
  initiative_intro: "initiative_intro",
  team_members: "team_members",
  suggested_edit: "suggested_edit",
  task_generation: "task_generation",
  feature_list: "feature_list",
  FEATURE_LIST: "feature_list",
  task_list: "task_list",
  task_stub: "task_stub",
  TASK_STUBS: "task_stub",
  task_priority: "task_priority",
  TASK_PRIORITY: "task_priority",
  adr_context_starter: "adr_context_starter",
  adr_agent_response: "adr_agent_response",
  question_group: "question_group",
  "multiple-choice": "multiple_choice",
  agent_complete: "agent_complete",
  "agent-request-permission": "agent_request_permission",
  agent_request_permission: "agent_request_permission",
  "agent-request-service-scope": "agent_request_service_scope",
  agent_request_service_scope: "agent_request_service_scope",
  "agent-request-review-file-scope": "agent_request_review_file_scope",
  agent_request_review_file_scope: "agent_request_review_file_scope",
  SESSION_MONITOR: "session_monitor",
  repository_prerequisites: "repository_grounding",
  repository_analysis: "repository_grounding",
  REPOSITORY_GROUNDING: "repository_grounding",
};

export type RegistryTypeInput = string | Pick<UIElement, "id" | "type">;

export const getRegistryType = (input: RegistryTypeInput): string => {
  const type = typeof input === "string" ? input : input.type;
  if (
    typeof input !== "string" &&
    (input.id === "repository_grounding_intent" ||
      type === "repository_grounding_intent")
  ) {
    return "repository_grounding_intent";
  }
  return TYPE_MAPPING[type] ?? type;
};

export const getFieldResponseBehavior = (
  input: RegistryTypeInput
): ResponseBehavior | undefined => {
  const type = getRegistryType(input);
  if (DISPLAY_ONLY_TYPES.has(type)) return { ownership: "display-only" };
  if (CONTRIBUTION_FIELD_TYPES.has(type)) {
    return { ownership: "contribution", submissionKind: "field" };
  }
  if (EXCLUSIVE_FIELD_TYPES.has(type)) {
    return { ownership: "exclusive", submissionKind: "field" };
  }
  return undefined;
};

// Completed narration rows still render their bodies without a user response.
const ALWAYS_VISIBLE_TYPES = new Set([
  "open_items_triage", "verify_feature", "agent_search_results", "interstitial",
  "implementation_readiness", "session_monitor", "agent_request_permission",
  "agent_request_service_scope", "agent_request_review_file_scope",
  "file_diff", "goal_pm_action", "plan_generation_visual_preview",
]);

const getVisibilityForType = (
  type: string
): ((context: FieldShouldShowFormContext) => boolean) | undefined => {
  if (type === "agent_hidden") return () => false;
  if (ALWAYS_VISIBLE_TYPES.has(type)) return () => true;
  return undefined;
};

export const getFieldResponseMetadata = (type: string): {
  responseBehavior: ResponseBehavior;
  shouldShowForm?: (context: FieldShouldShowFormContext) => boolean;
} => {
  const responseBehavior = getFieldResponseBehavior(type);
  if (!responseBehavior) throw new Error(`Unknown field response type: ${type}`);
  return {
    responseBehavior,
    shouldShowForm: getVisibilityForType(type),
  };
};

export const getFormVisibilityOverride = (
  uiElements: unknown
): ((context: FieldShouldShowFormContext) => boolean) | undefined => {
  if (!Array.isArray(uiElements)) return undefined;
  for (const element of uiElements) {
    if (
      typeof element !== "object" || element === null ||
      typeof element.id !== "string" || typeof element.type !== "string"
    ) continue;
    const type = getRegistryType(element);
    const override = getVisibilityForType(type);
    if (override) return override;
  }
  return undefined;
};
