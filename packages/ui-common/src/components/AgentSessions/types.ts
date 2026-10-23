import type {
  StartupPlanReviewResponse,
  StartupSessionPlanResponse,
} from "../../agents/prompts";
import type { ConversationStartRunRequestDtoProviderEnum } from "../../api";
import type { ReasoningEffort } from "../AgentSession/runtime/types";

export type { AgentSessionMethod, SessionMethod } from "../../agents/prompts";

export type AgentProvider = ConversationStartRunRequestDtoProviderEnum;

export interface CodingServiceOption {
  id: string;
  name: string;
  description?: string;
}

export type CodingSetupStep = "session-method" | "selection" | "prompt";

export type { SessionMethodSelection } from "../../agents/coordination/types";

export type StartupPlanReviewPayload = StartupPlanReviewResponse;
export type StartupPlan = StartupSessionPlanResponse;
export type StartupPlanDecision = "approve" | "improve";

export interface StartupPlanSubmission {
  decision: StartupPlanDecision;
  feedback: string | null;
  review: StartupPlanReviewPayload;
  provider?: ConversationStartRunRequestDtoProviderEnum;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  fastMode?: boolean;
}
