import { useCallback, useMemo, useRef } from "react";
import { useCreateAgentSession } from "../../../data/hooks/useCreateAgentSession";
import { useCreateAgentSessionConversation } from "../../../data/hooks/useCreateAgentSessionConversation";
import { updateAgentSessionRecord } from "../runtime/coding/update-agent-session-record";
import { submitMachinePingViaPlatform } from "../runtime/hooks/submitMachinePingViaPlatform";
import {
  launchAgentSession,
  newAgentSessionLaunchAttempt,
  type AgentSessionLaunchAttempt,
  type AgentSessionLaunchBinding,
  type AgentSessionLaunchRequest,
  type AgentSessionLaunchResult,
} from "./launchAgentSession";
import { useAgentSessionInteractionAccessResolver } from "./useAgentSessionInteractionAccess";

export interface UseLaunchAgentSessionResult {
  /**
   * Starts the agent session on the chosen machine with the first prompt.
   * Calling it again for the same launch follows the same session, Conversation
   * and operation; a recorded outcome is returned instead of starting again.
   */
  launch: (
    request: AgentSessionLaunchRequest,
  ) => Promise<AgentSessionLaunchResult>;
  /**
   * Begins a new operation after the user explicitly retries a terminal
   * outcome. The prepared session and Conversation are kept.
   */
  retryAfterTerminalOutcome: () => void;
}

export const useLaunchAgentSession = (
  binding: AgentSessionLaunchBinding,
): UseLaunchAgentSessionResult => {
  const accessResolver = useAgentSessionInteractionAccessResolver();
  const { mutate: createSession } = useCreateAgentSession();
  const { mutate: createConversation } = useCreateAgentSessionConversation();
  const attemptRef = useRef<AgentSessionLaunchAttempt | null>(null);

  const dependencies = useMemo(
    () => ({
      getAccess: accessResolver.getAccess,
      pingMachine: submitMachinePingViaPlatform,
      createSession,
      bindMachine: updateAgentSessionRecord,
      createConversation,
    }),
    [accessResolver.getAccess, createSession, createConversation],
  );

  const launch = useCallback(
    (request: AgentSessionLaunchRequest) => {
      attemptRef.current ??= newAgentSessionLaunchAttempt();
      return launchAgentSession(
        dependencies,
        binding,
        request,
        attemptRef.current,
      );
    },
    [dependencies, binding],
  );

  const retryAfterTerminalOutcome = useCallback(() => {
    const previous = attemptRef.current;
    if (!previous || previous.inFlight) {
      return;
    }
    attemptRef.current = {
      ...newAgentSessionLaunchAttempt(),
      session: previous.session,
      conversationId: previous.conversationId,
      boundMachineId: previous.boundMachineId,
    };
  }, []);

  return { launch, retryAfterTerminalOutcome };
};
