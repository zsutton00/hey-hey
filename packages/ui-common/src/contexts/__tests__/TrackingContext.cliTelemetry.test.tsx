import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSessionId,
  InvocationId,
} from "../../types/userTracking";
import { TrackingProvider, useUserAction } from "../TrackingContext";

const trackerMocks = vi.hoisted(() => ({
  destroy: vi.fn(),
  initialize: vi.fn(),
  registerContextProvider: vi.fn(() => vi.fn()),
  setUserId: vi.fn(),
  track: vi.fn(),
  updateConfig: vi.fn(),
}));

vi.mock("../../services/userActionTracker", () => ({
  userActionTracker: trackerMocks,
}));

vi.mock("../../clients/serviceClients", () => ({
  analyticsClient: {
    trackAttentionEvents: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../hooks/useAttention", () => ({
  useAttention: vi.fn(),
}));

vi.mock("../OrganizationContext", () => ({
  useOrganization: () => ({
    currentOrganization: {
      id: "org-123",
      name: "Test Org",
    },
  }),
}));

vi.mock("../AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "user-123",
      email: "test@example.com",
    },
  }),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <TrackingProvider enabled={true}>{children}</TrackingProvider>
);

describe("TrackingContext - CLI telemetry", () => {
  beforeEach(() => {
    trackerMocks.track.mockClear();
  });

  it("exposes trackCliTelemetry through useUserAction", () => {
    const { result } = renderHook(() => useUserAction(), { wrapper });

    expect(result.current.trackCliTelemetry).toBeDefined();
    expect(typeof result.current.trackCliTelemetry).toBe("function");
  });

  it("keeps failure payload metadata for agent invocation telemetry", () => {
    const { result } = renderHook(() => useUserAction(), { wrapper });

    act(() => {
      result.current.trackCliTelemetry({
        eventType: "agent.invocation",
        data: {
          sessionId: "agent-session-7" as AgentSessionId,
          invocationId: "inv-11" as InvocationId,
          latencyMs: 900,
          provider: "codex",
          status: "failure",
          errorMessage: "provider timeout",
        },
      });
    });

    expect(trackerMocks.track).toHaveBeenCalledWith({
      category: "cli_telemetry",
      action: "agent_invocation",
      data: {
        sessionId: "agent-session-7",
        invocationId: "inv-11",
        latencyMs: 900,
        provider: "codex",
        status: "failure",
        errorMessage: "provider timeout",
      },
    });
  });
});
