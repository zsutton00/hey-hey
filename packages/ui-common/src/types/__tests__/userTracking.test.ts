import { describe, it, expect } from "vitest";
import type {
  AttentionEvent,
  CliTelemetryEvent,
  AgentSessionId,
  HintId,
  InvocationId,
  RecommendationId,
  SessionId,
  TrackingEventId,
} from "../userTracking";
import {
  getCliTelemetryEventType,
  mapCliTelemetryInputToTrackingEvent,
} from "../userTracking";

describe("AttentionEvent", () => {
  it("should create a valid navigation attention event", () => {
    const event: AttentionEvent = {
      eventType: "attention",
      entity: {
        type: "task",
        id: "task-123",
      },
      timestamp: Date.now(),
    };

    expect(event.eventType).toBe("attention");
    expect(event.entity.type).toBe("task");
    expect(event.entity.id).toBe("task-123");
  });

  it("should create attention event with optional tab field", () => {
    const event: AttentionEvent = {
      eventType: "attention",
      entity: {
        type: "initiative",
        id: "init-456",
      },
      tab: "editor",
      timestamp: Date.now(),
    };

    expect(event.tab).toBe("editor");
  });

  it("should support various entity types", () => {
    const taskEvent: AttentionEvent = {
      eventType: "attention",
      entity: { type: "task", id: "t1" },
      timestamp: Date.now(),
    };

    const initiativeEvent: AttentionEvent = {
      eventType: "attention",
      entity: { type: "initiative", id: "i1" },
      timestamp: Date.now(),
    };

    const projectEvent: AttentionEvent = {
      eventType: "attention",
      entity: { type: "project", id: "p1" },
      timestamp: Date.now(),
    };

    const planEvent: AttentionEvent = {
      eventType: "attention",
      entity: { type: "plan", id: "pl1" },
      timestamp: Date.now(),
    };

    expect(taskEvent.entity.type).toBe("task");
    expect(initiativeEvent.entity.type).toBe("initiative");
    expect(projectEvent.entity.type).toBe("project");
    expect(planEvent.entity.type).toBe("plan");
  });
});

describe("CLI telemetry translation", () => {
  it("round-trips category/action back to dotted event type", () => {
    const event: CliTelemetryEvent = {
      eventId: "evt-1" as TrackingEventId,
      sessionId: "tracker-session-1" as SessionId,
      timestamp: Date.now(),
      url: "https://localhost/test",
      userAgent: "vitest",
      viewport: { width: 1280, height: 720 },
      context: {
        page: {
          name: "cli",
          path: "/cli",
        },
      },
      category: "cli_telemetry",
      action: "implementation_hint_written",
      data: {
        sessionId: "agent-session-1" as AgentSessionId,
        hintId: "hint-1" as HintId,
        latencyMs: 480,
        idempotencyCollisionCount: 2,
        status: "failure",
        errorMessage: "failed to persist hint",
      },
    };

    expect(getCliTelemetryEventType(event)).toBe("implementation_hint.written");
  });

  it("supports all required per-event IDs", () => {
    const recommendation = mapCliTelemetryInputToTrackingEvent({
      eventType: "final_recommendation.stored",
      data: {
        sessionId: "agent-session-2" as AgentSessionId,
        recommendationId: "rec-3" as RecommendationId,
        latencyMs: 95,
        status: "success",
      },
    });

    const invocation = mapCliTelemetryInputToTrackingEvent({
      eventType: "agent.invocation",
      data: {
        sessionId: "agent-session-2" as AgentSessionId,
        invocationId: "inv-7" as InvocationId,
        latencyMs: 6200,
        provider: "codex",
        status: "success",
        errorCount: 0,
      },
    });

    expect(recommendation.action).toBe("final_recommendation_stored");
    expect(invocation.action).toBe("agent_invocation");
  });
});
