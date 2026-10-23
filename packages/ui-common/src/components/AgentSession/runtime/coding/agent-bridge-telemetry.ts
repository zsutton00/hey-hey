import { useMemo } from "react";
import { useUserAction } from "../../../../contexts/TrackingContext";
import type {
  CliTelemetryEventInput,
  AgentSessionId,
  HintId,
  InvocationId,
  RecommendationId,
} from "../../../../types/userTracking";
import type { SubmitPromptTelemetrySummary } from "../hooks/usePromptRunSubmission";

type TelemetrySuccess = { status: "success" };

type TelemetryFailure = {
  status: "failure";
  errorMessage: string;
  errorCode?: string;
};

export type AgentSessionCreatedTelemetry = {
  latencyMs: number;
} & (
  | (TelemetrySuccess & {
      sessionId: string;
    })
  | (TelemetryFailure & {
      sessionId?: string;
    })
);

export type ImplementationHintWrittenTelemetry = {
  sessionId: string;
  latencyMs: number;
  idempotencyCollisionCount: number;
} & (
  | (TelemetrySuccess & {
      hintId: string;
    })
  | (TelemetryFailure & {
      hintId?: string;
    })
);

export type FinalRecommendationStoredTelemetry = {
  sessionId: string;
  latencyMs: number;
} & (
  | (TelemetrySuccess & {
      recommendationId: string;
    })
  | (TelemetryFailure & {
      recommendationId?: string;
    })
);

const readNonEmptyString = (
  value: string | null | undefined
): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toAgentSessionId = (
  sessionId: string | null | undefined
): AgentSessionId | null => {
  const parsed = readNonEmptyString(sessionId);
  return parsed ? (parsed as AgentSessionId) : null;
};

const toHintId = (hintId: string | null | undefined): HintId | null => {
  const parsed = readNonEmptyString(hintId);
  return parsed ? (parsed as HintId) : null;
};

const toRecommendationId = (
  recommendationId: string | null | undefined
): RecommendationId | null => {
  const parsed = readNonEmptyString(recommendationId);
  return parsed ? (parsed as RecommendationId) : null;
};

const toInvocationId = (
  invocationId: string | null | undefined
): InvocationId | null => {
  const parsed = readNonEmptyString(invocationId);
  return parsed ? (parsed as InvocationId) : null;
};

const withFailure = <T extends Record<string, unknown>>(
  input: T,
  failure: TelemetryFailure
): T &
  Pick<TelemetryFailure, "status" | "errorMessage"> & {
    errorCode?: string;
  } => ({
  ...input,
  status: failure.status,
  errorMessage: failure.errorMessage,
  ...(failure.errorCode ? { errorCode: failure.errorCode } : {}),
});

const toAgentInvocationEvent = (
  telemetry: NonNullable<SubmitPromptTelemetrySummary["agentInvocation"]>
): CliTelemetryEventInput | null => {
  const sessionId = toAgentSessionId(telemetry.sessionId);
  if (!sessionId) {
    return null;
  }

  if (telemetry.status === "success") {
    const invocationId = toInvocationId(telemetry.invocationId);
    if (!invocationId) {
      return null;
    }

    return {
      eventType: "agent.invocation",
      data: {
        sessionId,
        invocationId,
        latencyMs: telemetry.latencyMs,
        provider: telemetry.provider,
        status: "success",
        errorCount: telemetry.errorCount,
      },
    };
  }

  const invocationId = toInvocationId(telemetry.invocationId);
  return {
    eventType: "agent.invocation",
    data: withFailure(
      {
        sessionId,
        latencyMs: telemetry.latencyMs,
        provider: telemetry.provider,
        ...(invocationId ? { invocationId } : {}),
      },
      telemetry
    ),
  };
};

export interface AgentBridgeTelemetry {
  trackAgentSessionCreated: (telemetry: AgentSessionCreatedTelemetry) => void;
  trackAgentInvocation: (
    telemetry: NonNullable<SubmitPromptTelemetrySummary["agentInvocation"]>
  ) => void;
  trackSubmitPromptTelemetry: (telemetry: SubmitPromptTelemetrySummary) => void;
  trackImplementationHintWritten: (
    telemetry: ImplementationHintWrittenTelemetry
  ) => void;
  trackFinalRecommendationStored: (
    telemetry: FinalRecommendationStoredTelemetry
  ) => void;
}

export const createAgentBridgeTelemetry = (
  trackCliTelemetry: (event: CliTelemetryEventInput) => void
): AgentBridgeTelemetry => {
  const trackAgentSessionCreated = (
    telemetry: AgentSessionCreatedTelemetry
  ): void => {
    if (telemetry.status === "success") {
      const sessionId = toAgentSessionId(telemetry.sessionId);
      if (!sessionId) {
        return;
      }

      trackCliTelemetry({
        eventType: "agent_session.created",
        data: {
          sessionId,
          latencyMs: telemetry.latencyMs,
          status: "success",
        },
      });
      return;
    }

    const sessionId = toAgentSessionId(telemetry.sessionId);

    trackCliTelemetry({
      eventType: "agent_session.created",
      data: withFailure(
        {
          latencyMs: telemetry.latencyMs,
          ...(sessionId ? { sessionId } : {}),
        },
        telemetry
      ),
    });
  };

  const trackSubmitPromptTelemetry = (
    telemetry: SubmitPromptTelemetrySummary
  ): void => {
    if (telemetry.agentInvocation) {
      const invocationEvent = toAgentInvocationEvent(telemetry.agentInvocation);
      if (invocationEvent) {
        trackCliTelemetry(invocationEvent);
      }
    }
  };

  const trackAgentInvocation = (
    telemetry: NonNullable<SubmitPromptTelemetrySummary["agentInvocation"]>
  ): void => {
    const invocationEvent = toAgentInvocationEvent(telemetry);
    if (invocationEvent) {
      trackCliTelemetry(invocationEvent);
    }
  };

  const trackImplementationHintWritten = (
    telemetry: ImplementationHintWrittenTelemetry
  ): void => {
    const sessionId = toAgentSessionId(telemetry.sessionId);
    if (!sessionId) {
      return;
    }

    if (telemetry.status === "success") {
      const hintId = toHintId(telemetry.hintId);
      if (!hintId) {
        return;
      }

      trackCliTelemetry({
        eventType: "implementation_hint.written",
        data: {
          sessionId,
          hintId,
          latencyMs: telemetry.latencyMs,
          idempotencyCollisionCount: telemetry.idempotencyCollisionCount,
          status: "success",
        },
      });
      return;
    }

    const hintId = toHintId(telemetry.hintId);
    trackCliTelemetry({
      eventType: "implementation_hint.written",
      data: withFailure(
        {
          sessionId,
          latencyMs: telemetry.latencyMs,
          idempotencyCollisionCount: telemetry.idempotencyCollisionCount,
          ...(hintId ? { hintId } : {}),
        },
        telemetry
      ),
    });
  };

  const trackFinalRecommendationStored = (
    telemetry: FinalRecommendationStoredTelemetry
  ): void => {
    const sessionId = toAgentSessionId(telemetry.sessionId);
    if (!sessionId) {
      return;
    }

    if (telemetry.status === "success") {
      const recommendationId = toRecommendationId(telemetry.recommendationId);
      if (!recommendationId) {
        return;
      }

      trackCliTelemetry({
        eventType: "final_recommendation.stored",
        data: {
          sessionId,
          recommendationId,
          latencyMs: telemetry.latencyMs,
          status: "success",
        },
      });
      return;
    }

    const recommendationId = toRecommendationId(telemetry.recommendationId);
    trackCliTelemetry({
      eventType: "final_recommendation.stored",
      data: withFailure(
        {
          sessionId,
          latencyMs: telemetry.latencyMs,
          ...(recommendationId ? { recommendationId } : {}),
        },
        telemetry
      ),
    });
  };

  return {
    trackAgentSessionCreated,
    trackAgentInvocation,
    trackSubmitPromptTelemetry,
    trackImplementationHintWritten,
    trackFinalRecommendationStored,
  };
};

export const useAgentBridgeTelemetry = (): AgentBridgeTelemetry => {
  const { trackCliTelemetry } = useUserAction();

  return useMemo(
    () => createAgentBridgeTelemetry(trackCliTelemetry),
    [trackCliTelemetry]
  );
};
