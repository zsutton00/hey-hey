import { AgentSessionStatus } from "../../../../api";
import type { PendingTaskContext } from "../types";

const LOG_PREFIX = "[CodingActiveSession]";

export const log = (action: string, data?: Record<string, unknown>) => {
  if (data) {
    console.log(`${LOG_PREFIX} ${action}`, data);
  } else {
    console.log(`${LOG_PREFIX} ${action}`);
  }
};

export const logError = (
  action: string,
  error: unknown,
  data?: Record<string, unknown>,
) => {
  console.error(`${LOG_PREFIX} ${action}`, { error, ...data });
};

export interface StepContext {
  projectId: string;
  planId?: string;
  stepId?: string;
  taskId: string | null;
  taskName?: string;
}

export type FollowupSubmissionAction =
  "code_review" | "commit" | "system_diagram";

export const toErrorMessage = (value: unknown, fallback: string): string =>
  value instanceof Error ? value.message : fallback;

export const createWriteTraceId = (
  agentSessionId: string,
  runId: string,
): string => `bind_${agentSessionId}_${runId}_${Date.now().toString(36)}`;

export const createStatusWriteTraceId = (
  agentSessionId: string,
  runId: string,
): string => `status_${agentSessionId}_${runId}_${Date.now().toString(36)}`;

export const toLatencyMs = (startedAtMs: number): number =>
  Math.max(0, Date.now() - startedAtMs);

export const toPendingTaskContext = (
  stepContext: StepContext,
  _fallbackId: string,
): PendingTaskContext => {
  return {
    projectId: stepContext.projectId,
    ...(stepContext.planId ? { planId: stepContext.planId } : {}),
    ...(stepContext.stepId ? { stepId: stepContext.stepId } : {}),
  };
};

export interface ResolveHasSentInitialPromptInput {
  agentSessionStatus: AgentSessionStatus;
}

// The session has sent its initial prompt once it has moved off NotStarted.
// With the client-side CodingRun gone, persisted session status is the sole
// authority — a resumed/in-progress session is past its initial prompt.
export const resolveHasSentInitialPrompt = ({
  agentSessionStatus,
}: ResolveHasSentInitialPromptInput): boolean =>
  agentSessionStatus !== AgentSessionStatus.NotStarted;
