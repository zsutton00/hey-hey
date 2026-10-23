import { describe, expect, it, vi } from "vitest";
import { createAgentBridgeTelemetry } from "../agent-bridge-telemetry";

describe("createAgentBridgeTelemetry", () => {
  it("emits agent invocation events from submit telemetry", () => {
    const trackCliTelemetry = vi.fn();
    const telemetry = createAgentBridgeTelemetry(trackCliTelemetry);

    telemetry.trackSubmitPromptTelemetry({
      agentInvocation: {
        sessionId: "session-1",
        invocationId: "invocation-1",
        latencyMs: 1020,
        provider: "codex",
        status: "success",
        errorCount: 0,
      },
    });

    expect(trackCliTelemetry).toHaveBeenCalledOnce();
    expect(trackCliTelemetry).toHaveBeenCalledWith({
      eventType: "agent.invocation",
      data: {
        sessionId: "session-1",
        invocationId: "invocation-1",
        latencyMs: 1020,
        provider: "codex",
        status: "success",
        errorCount: 0,
      },
    });
  });

  it("emits failure payloads with optional ids when write-backs fail", () => {
    const trackCliTelemetry = vi.fn();
    const telemetry = createAgentBridgeTelemetry(trackCliTelemetry);

    telemetry.trackImplementationHintWritten({
      sessionId: "session-2",
      latencyMs: 410,
      status: "failure",
      errorMessage: "hint write failed",
      errorCode: "write_failed",
      idempotencyCollisionCount: 2,
    });

    telemetry.trackFinalRecommendationStored({
      sessionId: "session-2",
      latencyMs: 221,
      status: "failure",
      errorMessage: "report create failed",
    });

    expect(trackCliTelemetry).toHaveBeenNthCalledWith(1, {
      eventType: "implementation_hint.written",
      data: {
        sessionId: "session-2",
        latencyMs: 410,
        idempotencyCollisionCount: 2,
        status: "failure",
        errorMessage: "hint write failed",
        errorCode: "write_failed",
      },
    });
    expect(trackCliTelemetry).toHaveBeenNthCalledWith(2, {
      eventType: "final_recommendation.stored",
      data: {
        sessionId: "session-2",
        latencyMs: 221,
        status: "failure",
        errorMessage: "report create failed",
      },
    });
  });

  it("emits coding session create failure even when session id is unavailable", () => {
    const trackCliTelemetry = vi.fn();
    const telemetry = createAgentBridgeTelemetry(trackCliTelemetry);

    telemetry.trackAgentSessionCreated({
      latencyMs: 44,
      status: "failure",
      errorMessage: "create session payload missing",
      errorCode: "missing_session_payload",
    });

    expect(trackCliTelemetry).toHaveBeenCalledWith({
      eventType: "agent_session.created",
      data: {
        latencyMs: 44,
        status: "failure",
        errorMessage: "create session payload missing",
        errorCode: "missing_session_payload",
      },
    });
  });

  it("drops events that are missing required identifiers", () => {
    const trackCliTelemetry = vi.fn();
    const telemetry = createAgentBridgeTelemetry(trackCliTelemetry);

    telemetry.trackAgentSessionCreated({
      sessionId: "",
      latencyMs: 50,
      status: "success",
    });

    telemetry.trackSubmitPromptTelemetry({
      agentInvocation: {
        sessionId: "session-3",
        invocationId: "",
        latencyMs: 20,
        provider: "codex",
        status: "success",
        errorCount: 0,
      },
    });

    expect(trackCliTelemetry).not.toHaveBeenCalled();
  });
});
