import type {
  ConversationStartRunRequestDtoProviderEnum,
  ConversationStartRunRequestDtoReasoningEffortEnum,
  ServiceRepoBinding,
} from "../../../api";
import type {
  StartupPlanReviewResponse,
  StartupSessionPlanResponse as StartupPlanResponse,
} from "../../../agents/prompts.js";

export type AgentProvider = ConversationStartRunRequestDtoProviderEnum;
export type ReasoningEffort = ConversationStartRunRequestDtoReasoningEffortEnum;
export type RepoBinding = ServiceRepoBinding;

export interface PendingTaskContext {
  projectId: string;
  serviceIds?: string[];
  launchServiceId?: string;
  planId?: string;
  stepId?: string;
  provider?: AgentProvider;
}

export interface MentionSuggestion {
  mentionText: string;
  relativePath: string;
  absolutePath: string;
  confidence: number;
  selectable: boolean;
}

export type StartupPlanReview = StartupPlanReviewResponse;
export type StartupPlan = StartupPlanResponse;
export type StartupPlanDecision = "approve" | "improve";

export type PermissionDecision =
  | "approve"
  | "always_approve"
  | "deny"
  | "whitelist";

export interface StartupPlanSubmission {
  decision: StartupPlanDecision;
  feedback: string | null;
  review: StartupPlanReview;
  provider?: AgentProvider;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  fastMode?: boolean;
}

export interface ProjectOption {
  id: string;
  name: string;
}

export interface InitiativeOption {
  id: string;
  title: string;
}

export interface TaskOption {
  id: string;
  name: string;
  initiativeId: string;
}

export interface ServiceOption {
  id: string;
  name: string;
}
