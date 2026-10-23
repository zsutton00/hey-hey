/**
 * Browser-safe coordination prompt entrypoint.
 *
 * Exposes only prompt builders and prompt-input types so web consumers can
 * avoid importing node-specific agent runtime modules.
 */
export {
  buildFinalAssessmentPrompt,
  buildVerificationPlanPrompt,
} from "./coordination/prompts";
export {
  deriveFinalAssessmentTaskNeighborhood,
  deriveInitiativeFinalAssessmentTaskNeighborhood,
  resolveFinalAssessmentTaskNeighborhood,
} from "./coordination/finalAssessmentTaskNeighborhood";

export {
  extractStructuredJsonPayload,
  parseFinalAssessmentResponseFromText,
  parseSetSplittingResponseFromText,
  parseStartupSessionPlanResponseFromText,
  parseVerificationPlanResponseFromText,
} from "./coordination/parser";

export {
  parseFinalAssessmentResponse,
  parseSetSplittingResponse,
  parseStartupSessionPlanResponse,
  parseVerificationPlanResponse,
} from "./coordination/schemas";

export { resolveCodingSessionWorkflowType } from "./coordination/sessionMethodWorkflow";

export type {
  AgentSessionMethod,
  AgentWorkflowContext,
  FinalAssessmentResponse,
  FinalAssessmentStartupDiscrepancyContextItem,
  FinalAssessmentStartupDiscrepancySourceEventMetadata,
  FinalAssessmentRelatedTaskInput,
  FinalAssessmentTaskNeighborhoodInput,
  SessionMethod,
  SessionMethodSelection,
  SessionMethodContext,
  ProjectModeSelectionContext,
  SetSplittingGeneratedTask,
  SetSplittingResponse,
  SetSplittingSplitMode,
  StartupAdjacentScopeTaskInput,
  StartupDesignDocInput,
  StartupPlanReviewResponse,
  StartupSessionPlanResponse,
  StartupInitiativeInput,
  StartupPlanInput,
  StartupTaskNeighborhoodInput,
  StartupPromptInput,
  StartupTaskInput,
  VerificationPlanResponse,
} from "./coordination/types";
