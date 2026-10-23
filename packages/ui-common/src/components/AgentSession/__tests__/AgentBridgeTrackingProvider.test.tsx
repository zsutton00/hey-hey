import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EntityActivationProvider,
  type EntityActivationSink,
} from "../../../contexts/EntityActivationContext";
import { useAttention } from "../../../hooks/useAttention";
import { createNavigationLineageEntry } from "../../../types/userTracking";
import { AgentBridgeTrackingProvider } from "../AgentBridgeTrackingProvider";

const trackerMocks = vi.hoisted(() => ({
  destroy: vi.fn(),
  initialize: vi.fn(),
  registerContextProvider: vi.fn(() => vi.fn()),
  setUserId: vi.fn(),
  track: vi.fn(),
  updateConfig: vi.fn(),
}));

vi.mock("../../../services/userActionTracker", () => ({
  userActionTracker: trackerMocks,
}));

vi.mock("../../../clients/serviceClients", () => ({
  analyticsClient: {
    trackAttentionEvents: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../../hooks/useAttention", () => ({
  useAttention: vi.fn(),
}));

vi.mock("jotai", async () => {
  const actual = await vi.importActual<typeof import("jotai")>("jotai");
  return {
    ...actual,
    useSetAtom: () => vi.fn(),
  };
});

vi.mock("../../../contexts/OrganizationContext", () => ({
  useOrganization: () => ({ currentOrganization: null }),
}));

vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: null }),
}));

describe("AgentBridgeTrackingProvider", () => {
  beforeEach(() => {
    vi.mocked(useAttention).mockClear();
  });

  it("keeps route attention independent from activation across lineage changes", () => {
    const sink: EntityActivationSink = { onEntityActivated: vi.fn() };
    const standaloneTaskLineage = [
      createNavigationLineageEntry("task", "task-123"),
    ] as const;
    const planStepLineage = [
      createNavigationLineageEntry("plan", "plan-123"),
      createNavigationLineageEntry("plan_stage", "stage-123"),
      createNavigationLineageEntry("plan_step", "step-123"),
    ] as const;
    const renderTree = (
      lineage: typeof standaloneTaskLineage | typeof planStepLineage
    ) => (
      <EntityActivationProvider sink={sink}>
        <AgentBridgeTrackingProvider
          agentSessionId="session-123"
          lineage={lineage}
          pagePath="/coding/session-123"
        >
          <div />
        </AgentBridgeTrackingProvider>
      </EntityActivationProvider>
    );

    const { rerender } = render(renderTree(standaloneTaskLineage));
    expect(useAttention).toHaveBeenLastCalledWith({
      entityType: "agent_session",
      entityId: "session-123",
      tab: undefined,
    });

    rerender(renderTree(planStepLineage));
    expect(sink.onEntityActivated).not.toHaveBeenCalled();
  });

  it("does not turn attention-only canonical metadata into activation", () => {
    const sink: EntityActivationSink = { onEntityActivated: vi.fn() };

    render(
      <EntityActivationProvider sink={sink}>
        <AgentBridgeTrackingProvider
          agentSessionId="session-123"
          lineage={null}
          pagePath="/coding/session-123"
        >
          <div />
        </AgentBridgeTrackingProvider>
      </EntityActivationProvider>
    );

    expect(useAttention).toHaveBeenCalledWith({
      entityType: "agent_session",
      entityId: "session-123",
      tab: undefined,
    });
    expect(sink.onEntityActivated).not.toHaveBeenCalled();
  });

  it("keeps preview-shaped compositions observational when lineage is omitted", () => {
    expect(() =>
      render(
        <AgentBridgeTrackingProvider
          agentSessionId="session-123"
          pagePath="/preview/session-123"
        >
          <div />
        </AgentBridgeTrackingProvider>
      )
    ).not.toThrow();

    expect(useAttention).toHaveBeenCalledWith({
      entityType: undefined,
      entityId: undefined,
      tab: undefined,
    });
  });
});
