import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import {
  AgentSessionContinuationState,
  type AgentSessionContinuationDto,
  type MachineDto,
} from "../../api";
import {
  agentSessionContinuationKeys,
  cancelAgentSessionContinuation,
  commitAgentSessionContinuation,
  ContinuationAuthorizationDeniedError,
  inspectAgentSessionContinuation,
} from "../../data/collections/agentSessionContinuation";
import { invalidateAgentSessionDetail } from "../../data/collections/agentSessions";
import { conversationCliStatusKeys } from "../../data/collections/conversationCliStatus";

/** Why a continuation step failed; `ambiguous` means the outcome is unknown. */
export type ContinuationFailureCause =
  | "binding_changed"
  | "not_eligible"
  | "destination_not_ready"
  | "authorization_denied"
  | "inspection_failed"
  | "attempt_unresolved"
  | "ambiguous";

export type AgentSessionContinuationPhase =
  | { kind: "idle" }
  | { kind: "inspecting"; destination: MachineDto }
  | { kind: "committing"; destination: MachineDto }
  | {
      kind: "failed";
      destination: MachineDto;
      cause: ContinuationFailureCause;
      /** Present when repeating the same step is safe and meaningful. */
      canRetry: boolean;
    };

export interface AgentSessionContinuationControls {
  /** Page-local progress of the step in flight; durable outcomes come from the server. */
  phase: AgentSessionContinuationPhase;
  continueOn: (destination: MachineDto) => void;
  /** Delivers an attempt awaiting history confirmation, with consent. */
  confirmSavedHistory: (
    continuation: AgentSessionContinuationDto,
    destination: MachineDto,
  ) => void;
  /** Declines an attempt that has not been delivered; nothing starts. */
  cancel: (continuation: AgentSessionContinuationDto | null) => void;
  /** Retries a FAILED attempt's delivery to its own destination. */
  retryDelivery: (
    continuation: AgentSessionContinuationDto,
    destination: MachineDto,
  ) => void;
  /** Repeats the last step after a page-local failure. */
  retry: () => void;
}

interface Step {
  destination: MachineDto;
  run: () => Promise<void>;
}

const readErrorCode = (error: unknown): string | null => {
  if (!axios.isAxiosError(error)) {
    return null;
  }
  const data: unknown = error.response?.data;
  if (typeof data !== "object" || data === null || !("code" in data)) {
    return null;
  }
  return typeof data.code === "string" ? data.code : null;
};

const classifyFailure = (error: unknown): ContinuationFailureCause => {
  if (error instanceof ContinuationAuthorizationDeniedError) {
    return "authorization_denied";
  }
  const code = readErrorCode(error);
  if (
    code === "CONTINUATION_BINDING_CHANGED" ||
    code === "CONTINUATION_ATTEMPT_CHANGED"
  ) {
    return "binding_changed";
  }
  if (code === "CONTINUATION_ATTEMPT_UNRESOLVED") {
    return "attempt_unresolved";
  }
  if (
    code === "CONTINUATION_NOT_ELIGIBLE" ||
    code === "CONTINUATION_START_RECIPE_UNAVAILABLE" ||
    code === "CONTINUATION_NOT_RESUMABLE" ||
    code === "CONTINUATION_CANCELLED"
  ) {
    return "not_eligible";
  }
  if (
    code === "CONTINUATION_DESTINATION_NOT_READY" ||
    code === "CONTINUATION_DESTINATION_UNAVAILABLE"
  ) {
    return "destination_not_ready";
  }
  if (code?.startsWith("CONTINUATION_INSPECTION_")) {
    return "inspection_failed";
  }
  // No server verdict (timeout, network, unexpected): the outcome is unknown,
  // so a retry repeats the same step under the same continuation identity.
  return "ambiguous";
};

/**
 * Drives the person's steps on one durable continuation attempt: inspect a
 * destination under its own authorization, deliver, confirm saved history,
 * cancel, or retry a failed delivery. The attempt's state lives on the server
 * and survives reloads; this hook only tracks the request in flight.
 */
export function useAgentSessionContinuation(target: {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  conversationId: string;
  boundMachineId: string | null;
}): AgentSessionContinuationControls {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<AgentSessionContinuationPhase>({
    kind: "idle",
  });
  const lastStep = useRef<Step | null>(null);

  const refreshServerState = useCallback(async () => {
    // The coding reply reads the session detail while the composer reads CLI status.
    await invalidateAgentSessionDetail(
      queryClient,
      target.organizationId,
      target.projectId,
      target.agentSessionId,
    );
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: agentSessionContinuationKeys.session(
          target.organizationId,
          target.projectId,
          target.agentSessionId,
        ),
      }),
      queryClient.invalidateQueries({
        queryKey: conversationCliStatusKeys.conversation(
          target.organizationId,
          target.projectId,
          target.conversationId,
        ),
      }),
    ]);
  }, [queryClient, target]);

  const perform = useCallback(
    async (step: Step, pending: AgentSessionContinuationPhase) => {
      lastStep.current = step;
      setPhase(pending);
      try {
        await step.run();
        lastStep.current = null;
        setPhase({ kind: "idle" });
      } catch (error) {
        const cause = classifyFailure(error);
        console.warn("[AgentSessionContinuation] step failed", {
          agentSessionId: target.agentSessionId,
          cause,
          code: readErrorCode(error),
        });
        setPhase({
          kind: "failed",
          destination: step.destination,
          cause,
          canRetry: cause === "ambiguous" || cause === "inspection_failed",
        });
      } finally {
        await refreshServerState();
      }
    },
    [refreshServerState, target.agentSessionId],
  );

  const deliver = useCallback(
    (
      continuation: AgentSessionContinuationDto,
      destination: MachineDto,
      confirmSavedHistory: boolean,
    ) =>
      commitAgentSessionContinuation({
        organizationId: target.organizationId,
        projectId: target.projectId,
        agentSessionId: target.agentSessionId,
        continuation,
        destination,
        confirmSavedHistory,
      }),
    [target],
  );

  const continueOn = useCallback(
    (destination: MachineDto) => {
      const expectedSourceMachineId = target.boundMachineId;
      if (!expectedSourceMachineId) {
        return;
      }
      const continuationId = crypto.randomUUID();
      void perform(
        {
          destination,
          run: async () => {
            const inspected = await inspectAgentSessionContinuation({
              organizationId: target.organizationId,
              projectId: target.projectId,
              agentSessionId: target.agentSessionId,
              continuationId,
              expectedSourceMachineId,
              destination,
            });
            // Saved history waits, durably, for the person's confirmation.
            if (inspected.state === AgentSessionContinuationState.Inspected) {
              setPhase({ kind: "committing", destination });
              await deliver(inspected, destination, false);
            }
          },
        },
        { kind: "inspecting", destination },
      );
    },
    [deliver, perform, target],
  );

  const confirmSavedHistory = useCallback(
    (continuation: AgentSessionContinuationDto, destination: MachineDto) => {
      void perform(
        {
          destination,
          run: async () => {
            await deliver(continuation, destination, true);
          },
        },
        { kind: "committing", destination },
      );
    },
    [deliver, perform],
  );

  const retryDelivery = useCallback(
    (continuation: AgentSessionContinuationDto, destination: MachineDto) => {
      void perform(
        {
          destination,
          run: async () => {
            await deliver(continuation, destination, false);
          },
        },
        { kind: "committing", destination },
      );
    },
    [deliver, perform],
  );

  const cancel = useCallback(
    (continuation: AgentSessionContinuationDto | null) => {
      lastStep.current = null;
      setPhase({ kind: "idle" });
      if (!continuation) {
        return;
      }
      void cancelAgentSessionContinuation({
        organizationId: target.organizationId,
        projectId: target.projectId,
        agentSessionId: target.agentSessionId,
        continuationId: continuation.continuationId,
      })
        .catch((error: unknown) => {
          console.warn("[AgentSessionContinuation] cancel failed", {
            agentSessionId: target.agentSessionId,
            continuationId: continuation.continuationId,
            code: readErrorCode(error),
          });
        })
        .finally(() => {
          void refreshServerState();
        });
    },
    [refreshServerState, target],
  );

  const retry = useCallback(() => {
    const step = lastStep.current;
    if (!step) {
      return;
    }
    void perform(step, { kind: "committing", destination: step.destination });
  }, [perform]);

  return {
    phase,
    continueOn,
    confirmSavedHistory,
    cancel,
    retryDelivery,
    retry,
  };
}
