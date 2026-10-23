import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrackingProvider } from "../../../../../contexts/TrackingContext";
import { useAgentBridgeTelemetry } from "../agent-bridge-telemetry";

const trackerMocks = vi.hoisted(() => ({
  destroy: vi.fn(),
  initialize: vi.fn(),
  registerContextProvider: vi.fn(),
  setUserId: vi.fn(),
  track: vi.fn(),
  updateConfig: vi.fn(),
}));

vi.mock("../../../../../services/userActionTracker", () => ({
  userActionTracker: trackerMocks,
}));

vi.mock("../../../../../clients/serviceClients", () => ({
  analyticsClient: {
    trackAttentionEvents: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../../../../hooks/useAttention", () => ({
  useAttention: vi.fn(),
}));

vi.mock("../../../../../contexts/OrganizationContext", () => ({
  useOrganization: () => ({
    currentOrganization: null,
  }),
}));

vi.mock("../../../../../contexts/AuthContext", () => ({
  useAuth: () => ({
    user: null,
  }),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <TrackingProvider enabled={true}>{children}</TrackingProvider>
);

describe("useAgentBridgeTelemetry integration", () => {
  beforeEach(() => {
    trackerMocks.track.mockClear();
  });

  it("emits submit prompt telemetry through TrackingProvider into userActionTracker", () => {
    const { result } = renderHook(() => useAgentBridgeTelemetry(), { wrapper });

    act(() => {
      result.current.trackSubmitPromptTelemetry({
        agentInvocation: {
          sessionId: "session-1",
          invocationId: "invocation-9",
          latencyMs: 890,
          provider: "codex",
          status: "success",
          errorCount: 0,
        },
      });
    });

    expect(trackerMocks.track).toHaveBeenCalledWith({
      category: "cli_telemetry",
      action: "agent_invocation",
      data: {
        sessionId: "session-1",
        invocationId: "invocation-9",
        latencyMs: 890,
        provider: "codex",
        status: "success",
        errorCount: 0,
      },
    });
  });
});
