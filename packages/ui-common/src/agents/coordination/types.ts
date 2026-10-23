import type {
  CodingPromptStartupPlanPayload,
  CodingPromptStartupPlanStep,
  CreateImplementationHintDtoSourceTypeEnum,
  DesignDocDraftSection,
  DesignDocSectionUpdateSource,
  TaskSectionUpdateSource,
  UpdateDesignDocDto,
  WorkStatus,
  ProjectModeSelection,
} from "../../api";
import type { WorkItemTypeKey } from "../../constants/taskTypes";
import type { LocalPromptStartupInput } from "../../api";
import type { AgentSessionId } from "../core";

type Brand<T, B extends string> = T & { readonly __brand: B };

export type TaskId = Brand<string, "TaskId">;
export type DesignDocId = Brand<string, "DesignDocId">;
export type PlanId = Brand<string, "PlanId">;
export type InitiativeId = Brand<string, "InitiativeId">;
export type { AgentSessionId };
export type ImplementationHintId = Brand<string, "ImplementationHintId">;
export type ServiceId = Brand<string, "ServiceId">;

export const toTaskId = (value: string): TaskId => value as TaskId;
export const toDesignDocId = (value: string): DesignDocId =>
  value as DesignDocId;
export const toPlanId = (value: string): PlanId => value as PlanId;
export const toInitiativeId = (value: string): InitiativeId =>
  value as InitiativeId;
export { toAgentSessionId } from "../core";
export const toImplementationHintId = (value: string): ImplementationHintId =>
  value as ImplementationHintId;
export const toServiceId = (value: string): ServiceId => value as ServiceId;

export interface AgentWorkflowContext {
  organizationId: string;
  projectId: string;
  providerAgentSessionId: AgentSessionId | null;
  agentSessionId?: AgentSessionId;
  taskId?: TaskId;
  designDocId?: DesignDocId;
  initiativeId?: InitiativeId;
  planId?: PlanId;
  serviceId?: ServiceId;
}

export interface StartupTaskInput {
  id?: string;
  title?: string;
  taskType: WorkItemTypeKey;
  description: string;
  acceptanceCriteria?: string;
}

export interface StartupDesignDocInput {
  id?: string;
  title?: string;
  sections?: Record<string, string>;
}

export interface StartupPlanInput {
  id?: string;
  title?: string;
  description?: string;
  outcome?: string;
}

export interface StartupInitiativeInput {
  id?: string;
  title?: string;
  description?: string;
}

export interface StartupAdjacentScopeTaskInput {
  id?: string;
  title: string;
  taskType?: WorkItemTypeKey;
  description?: string;
  acceptanceCriteria?: string;
}

export interface StartupTaskNeighborhoodTaskInput {
  id: string;
  title: string;
  taskType?: WorkItemTypeKey;
  description: string;
  acceptanceCriteria?: string;
  status?: WorkStatus;
}

export interface StartupTaskNeighborhoodChildTaskInput
  extends StartupTaskNeighborhoodTaskInput {
  parentTaskIds: string[];
  incompleteParentTaskIds: string[];
  allParentTasksCompleted: boolean;
}

export interface StartupTaskNeighborhoodDesignDocSectionInput {
  key: string;
  content: string;
}

export interface StartupTaskNeighborhoodDesignDocInput {
  id: string;
  title: string;
  sections: StartupTaskNeighborhoodDesignDocSectionInput[];
  status?: string;
}

export interface StartupTaskNeighborhoodInput {
  parentTasks: StartupTaskNeighborhoodTaskInput[];
  childTasks: StartupTaskNeighborhoodChildTaskInput[];
  ancestralDesignDocs: StartupTaskNeighborhoodDesignDocInput[];
}

export type SessionMethod =
  | "plan"
  | "split_by_service"
  | "split_by_function"
  | "open"
  | "debug"
  | "research"
  | "quick";

export type AgentSessionMethod = SessionMethod | "validation";

export interface SessionMethodService {
  id: string;
  name: string;
}

export interface SessionMethodContext {
  method: SessionMethod;
  serviceIds: string[];
  services: SessionMethodService[];
}

export interface ProjectModeSelectionContext {
  method: undefined;
  projectModeSelection: ProjectModeSelection;
  serviceIds: string[];
  services: SessionMethodService[];
}

/**
 * The setup picker carries either a built-in routing method or the generated
 * identity of a project-defined MODE. Keeping the two arms separate prevents
 * a MODE id from being mistaken for a built-in prompt routing identity.
 */
export type SessionMethodSelection =
  | (Omit<SessionMethodContext, "method"> & {
      method: AgentSessionMethod;
      projectModeSelection?: never;
    })
  | ProjectModeSelectionContext;

// The start-run startup context is the generated wire type
// `LocalPromptStartupInput` (the one source of truth, shared by the API
// producer and the CLI consumer). The UI extends it with `sessionMethod`,
// which is UI-only branching state that never travels the wire.
export interface StartupPromptInput extends LocalPromptStartupInput {
  sessionMethod?: SessionMethodSelection;
}

export interface FinalAssessmentRelatedTaskInput {
  id: string;
  title: string;
  taskType?: WorkItemTypeKey;
  description: string;
  acceptanceCriteria?: string;
}

export interface FinalAssessmentTaskNeighborhoodInput {
  parentTasks: FinalAssessmentRelatedTaskInput[];
  childTasks: FinalAssessmentRelatedTaskInput[];
}

export type StartupSourceType =
  | "evidenceItem"
  | "task"
  | "designDoc"
  | "plan"
  | "initiative";

export interface StartupSourceRef {
  sourceType: StartupSourceType;
  sourceId: string;
}

export type StartupDiscrepancySeverity = "low" | "medium" | "high";

export interface StartupPlanReference {
  sourceType: StartupSourceType;
  sourceId: string;
  rationale: string;
}

export type StartupPlanStep = CodingPromptStartupPlanStep;

export interface StartupDiscrepancy {
  sourceRef: StartupSourceRef;
  sourceField?: string;
  sourceExcerpt: string;
  reasoning: string;
  discrepancyText: string;
  severity: StartupDiscrepancySeverity;
}

export interface StartupClarificationQuestion {
  question: string;
  reason?: string;
  relatedSourceRefs?: StartupSourceRef[];
}

export type StartupSessionPlanResponse = CodingPromptStartupPlanPayload;

export interface StartupQuestionAnswer {
  question: string;
  answer: string;
}

export type StartupDiscrepancyDisposition = "acknowledged" | "blocker";

export interface StartupDiscrepancyReview {
  discrepancyIndex: number;
  disposition: StartupDiscrepancyDisposition;
  note?: string;
}

export interface FinalAssessmentStartupDiscrepancySourceEventMetadata {
  startupPlanResponseEventSeq?: number;
  startupPlanReviewActionEventSeq?: number;
  startupPlanReviewSourceEventSeq?: number;
}

export interface FinalAssessmentStartupDiscrepancyContextItem {
  discrepancyIndex: number;
  sourceRef: StartupSourceRef;
  sourceField?: string;
  sourceExcerpt: string;
  reasoning: string;
  discrepancyText: string;
  severity: StartupDiscrepancySeverity;
  disposition?: StartupDiscrepancyDisposition;
  dispositionNote?: string;
  sourceEventMetadata?: FinalAssessmentStartupDiscrepancySourceEventMetadata;
}

export interface StartupPlanReviewResponse {
  responseType: "startup_plan_review_v1";
  originalPlan: StartupSessionPlanResponse;
  questionAnswers: StartupQuestionAnswer[];
  discrepancyDispositions: StartupDiscrepancyReview[];
}

export type FinalAssessmentVerdict =
  | "completed"
  | "partiallyCompleted"
  | "blocked"
  | "notCompleted"
  | "unknown";

export type FinalAssessmentSourceType = StartupSourceType | "sessionOutput";

export interface FinalAssessmentSourceRef {
  sourceType: FinalAssessmentSourceType;
  sourceId: string;
}

export interface FinalAssessmentTargetRef<
  T extends "task" | "designDoc" | "implementationHint" | "evidenceItem" =
    | "task"
    | "designDoc"
    | "implementationHint"
    | "evidenceItem"
> {
  entityType: T;
  entityId: string;
}

export interface FinalTaskAssessment {
  target: FinalAssessmentTargetRef<"task">;
  verdict: FinalAssessmentVerdict;
  statusRecommendation: {
    status: WorkStatus;
    reason: string;
  };
  summary: string;
}

export interface FinalTaskStatusUpdateSuggestion {
  target: FinalAssessmentTargetRef<"task">;
  updateType: "task_status";
  updatePayload: {
    status: WorkStatus;
    sectionUpdateSource?: TaskSectionUpdateSource;
  };
  reasoning: string;
  sourceRefs: FinalAssessmentSourceRef[];
}

export interface FinalTaskDetailsUpdateSuggestion {
  target: FinalAssessmentTargetRef<"task">;
  updateType: "task_details";
  updatePayload: {
    description?: string;
    acceptanceCriteria?: string;
  };
  reasoning: string;
  sourceRefs: FinalAssessmentSourceRef[];
}

export interface FinalTaskAcceptanceCriteriaUpdateSuggestion {
  target: FinalAssessmentTargetRef<"task">;
  updateType: "task_acceptance_criteria";
  updatePayload: {
    acceptanceCriteria: string;
  };
  reasoning: string;
  sourceRefs: FinalAssessmentSourceRef[];
}

export interface FinalDesignDocRevisionSuggestion {
  target: FinalAssessmentTargetRef<"designDoc">;
  updateType: "design_doc_revision";
  updatePayload: {
    status?: UpdateDesignDocDto["status"];
    summary?: UpdateDesignDocDto["summary"];
    sections?: DesignDocDraftSection[];
    sectionUpdateSource?: DesignDocSectionUpdateSource;
  };
  reasoning: string;
  sourceRefs: FinalAssessmentSourceRef[];
}

export interface FinalImplementationHintCreateSuggestion {
  target: FinalAssessmentTargetRef<"implementationHint">;
  updateType: "implementation_hint_create";
  updatePayload: {
    featureName: string;
    description: string;
    sourceType: CreateImplementationHintDtoSourceTypeEnum;
    agentSessionIds?: string[];
  };
  reasoning: string;
  sourceRefs: FinalAssessmentSourceRef[];
}

export interface FinalImplementationHintUpdateSuggestion {
  target: FinalAssessmentTargetRef<"implementationHint">;
  updateType: "implementation_hint_update";
  updatePayload: {
    featureName?: string;
    description?: string;
    sourceType?: CreateImplementationHintDtoSourceTypeEnum;
    agentSessionIds?: string[];
  };
  reasoning: string;
  sourceRefs: FinalAssessmentSourceRef[];
}

export type FinalArtifactUpdateSuggestion =
  | FinalTaskStatusUpdateSuggestion
  | FinalTaskDetailsUpdateSuggestion
  | FinalTaskAcceptanceCriteriaUpdateSuggestion
  | FinalDesignDocRevisionSuggestion
  | FinalImplementationHintCreateSuggestion
  | FinalImplementationHintUpdateSuggestion;

export interface FinalEvidenceCorrection {
  target: FinalAssessmentTargetRef<"evidenceItem">;
  severity: StartupDiscrepancySeverity;
  issueType: "outdated" | "incorrect" | "conflicting" | "missing_context";
  reasoning: string;
  suggestedReplacement: string;
  sourceExcerpt: string;
}

type RequireAtLeastOne<T extends object> = {
  [K in keyof T]-?: Required<Pick<T, K>> & Partial<Omit<T, K>>;
}[keyof T];

interface FinalValidationRecommendationTargetFields {
  filePath?: string;
  serviceId?: string;
  endpoint?: string;
  uiFlow?: string;
}

export type FinalValidationRecommendationTarget =
  RequireAtLeastOne<FinalValidationRecommendationTargetFields>;

export interface FinalValidationRecommendationFileReference {
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface FinalValidationRecommendationProvenance {
  sessionId: string;
  agentResponseId: string;
}

export interface FinalValidationRecommendation {
  stepId: string;
  title: string;
  stepDescription: string;
  target: FinalValidationRecommendationTarget;
  preconditions: string[];
  expectedResult: string;
  executionType: "manual" | "automated";
  estimatedEffort: number;
  confidence: number;
  provenance: FinalValidationRecommendationProvenance;
  fileReferences?: FinalValidationRecommendationFileReference[];
}

export interface FinalOpenQuestion {
  question: string;
  reason: string;
}

export interface FinalAssessmentResponse {
  responseType: "final_assessment_v2";
  taskAssessment: FinalTaskAssessment;
  implementationNotes?: string;
  artifactUpdateSuggestions: FinalArtifactUpdateSuggestion[];
  evidenceCorrections: FinalEvidenceCorrection[];
  validationRecommendationsSummary: string;
  validationRecommendations: FinalValidationRecommendation[];
  openQuestions: FinalOpenQuestion[];
}

export interface ChildTaskDescriptionUpdateNote {
  taskId: string;
  integrationNote: string;
}

export interface ChildTaskDescriptionUpdateResponse {
  responseType: "child_task_description_update_v1";
  updates: ChildTaskDescriptionUpdateNote[];
}

export type VerificationTier =
  | "product_walkthrough"
  | "api_or_script"
  | "automated_test";

export interface VerificationTargetRef {
  entityType: "task" | "designDoc" | "service" | "artifact";
  entityId: string;
}

export interface VerificationFallback {
  tier: "api_or_script" | "automated_test";
  trigger: string;
  steps: string[];
}

export interface VerificationEvidenceRef {
  sourceType:
    | "task"
    | "designDoc"
    | "plan"
    | "initiative"
    | "evidenceItem"
    | "sessionOutput";
  sourceId: string;
}

export interface VerificationCheck {
  checkId: string;
  tier: VerificationTier;
  priority: number;
  goal: string;
  target: VerificationTargetRef;
  steps: string[];
  expectedResult: string;
  fallback: VerificationFallback | null;
  evidenceRefs: VerificationEvidenceRef[];
}

export interface VerificationCoverageSummary {
  verifiedBehaviors: string[];
  remainingRisks: string[];
  recommendedNextAction: string;
}

export interface VerificationPlanResponse {
  responseType: "verification_plan_v1";
  verificationChecks: VerificationCheck[];
  coverageSummary: VerificationCoverageSummary;
}

export type SetSplittingSplitMode = "feature" | "service";

export interface SetSplittingGeneratedTask {
  title: string;
  description: string;
  acceptanceCriteria: string;
}

export interface SetSplittingResponse {
  responseType: "set_splitting_v1";
  splitMode: SetSplittingSplitMode;
  tasks: SetSplittingGeneratedTask[];
  reasoning: string;
}
