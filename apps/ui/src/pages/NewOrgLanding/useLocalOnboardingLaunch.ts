import { useRef, useState } from "react";
import {
  AgentSessionType,
  type AgentSessionDto,
  type RunCreatePayloadLocalOnboarding,
} from "@hey-hey/ui-common/api";
import {
  useLaunchAgentSession,
  type AgentSessionLaunchBinding,
  type SurfaceSelection,
} from "@hey-hey/ui-common/components";

import { toOnboardingSessionConfig } from "../LocalOnboarding/localOnboardingRuntime";

export interface LocalOnboardingTarget {
  organizationId: string;
  projectId: string;
  conversationId: string;
  workflowId: string;
}

/** What the shared launch operation needs to start onboarding for the project's existing onboarding workflow. */
export const buildLocalOnboardingBinding = (
  target: LocalOnboardingTarget,
  runtime: SurfaceSelection,
): AgentSessionLaunchBinding => ({
  organizationId: target.organizationId,
  projectId: target.projectId,
  session: { type: AgentSessionType.Coding },
  runtime: {
    provider: runtime.provider,
    model: runtime.model,
    ...(runtime.reasoningEffort
      ? { reasoningEffort: runtime.reasoningEffort }
      : {}),
    ...(runtime.fastMode !== undefined ? { fastMode: runtime.fastMode } : {}),
    config: toOnboardingSessionConfig(runtime),
  },
  conversation: {
    kind: "existingWorkflow",
    conversationId: target.conversationId,
    workflowId: target.workflowId,
  },
  start: {
    handlerPromptType: "local_onboarding",
    payload: (prompt, conversationId) =>
      ({
        promptType: "local_onboarding",
        userMessage: prompt,
        conversationId,
      }) satisfies RunCreatePayloadLocalOnboarding,
    initialMessage: true,
  },
});

/**
 * Starts local onboarding through the shared agent launch operation and
 * reports the session it saved, so the caller can keep the choice fixed from
 * then on.
 */
export const useLocalOnboardingLaunch = (
  binding: AgentSessionLaunchBinding,
  onSessionSaved: (session: AgentSessionDto) => void,
) => {
  const launcher = useLaunchAgentSession(binding);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terminalOutcomeRecorded = useRef(false);

  const handleStart = async (machineId: string): Promise<boolean> => {
    if (launching) {
      return false;
    }

    if (terminalOutcomeRecorded.current) {
      // The platform settled the last start; this click is an explicit retry.
      launcher.retryAfterTerminalOutcome();
      terminalOutcomeRecorded.current = false;
    }

    setLaunching(true);
    setError(null);
    try {
      const result = await launcher.launch({ machineId, prompt: "" });
      if (result.session) {
        onSessionSaved(result.session);
      }
      if (result.ok) {
        return true;
      }

      terminalOutcomeRecorded.current = result.operation !== undefined;
      setError(result.error);
      return false;
    } finally {
      setLaunching(false);
    }
  };

  return { launching, error, handleStart };
};
