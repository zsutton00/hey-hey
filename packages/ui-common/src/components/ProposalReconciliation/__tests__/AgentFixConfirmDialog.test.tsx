import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProposalResponseDto } from "../../../api";
import { AgentFixConfirmDialog } from "../AgentFixConfirmDialog";

const { navigate, launch, launchState } = vi.hoisted(() => ({
  navigate: vi.fn(),
  launch: vi.fn(),
  launchState: { error: null as string | null },
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("../../../contexts/PathServiceContext", () => ({
  usePathService: () => ({
    agentSession: ({ agentSessionId }: { agentSessionId: string }) =>
      `/session/${agentSessionId}`,
  }),
}));
vi.mock("../../../hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "org" }),
}));
vi.mock("../useProposalAgentFixLaunch", () => ({
  useProposalAgentFixLaunch: () => ({
    launch,
    isPending: false,
    error: launchState.error,
  }),
}));
vi.mock("../../AgentSession/runtime/coding/useMachineResolution", () => ({
  useMachineResolution: () => ({
    machines: [],
    isReady: true,
    mode: "single",
    selectedMachine: { machineId: "machine" },
    setSelectedMachineId: vi.fn(),
  }),
}));
vi.mock("../../AgentSession/useSurfaceSelection", () => ({
  useSurfaceSelection: () => ({
    selection: { provider: "claude", model: "model", reasoningEffort: "high" },
    updateSelection: vi.fn(),
  }),
}));
vi.mock("../../AgentSession/surfaceSelectionMemory", () => ({
  PROPOSAL_AGENT_FIX_SURFACE_ID: "proposal-agent-fix",
  writeSurfaceSelection: vi.fn(),
}));
vi.mock("../../AgentSession/RuntimeModelSelector", () => ({
  RuntimeModelSelector: () => null,
}));
vi.mock("../../ProjectReports/ProjectReportLaunchStatus", () => ({
  ProjectReportMachineSection: () => null,
}));
vi.mock("../../AgentSession/agentBridgeRecoveryState", () => ({
  resolveAgentBridgeRecoveryState: () => ({}),
}));

const proposal = {
  id: "proposal",
  organizationId: "org",
  projectId: "project",
} as ProposalResponseDto;

beforeEach(() => {
  vi.clearAllMocks();
  launchState.error = null;
});

describe("AgentFixConfirmDialog", () => {
  it("warns, launches on confirm and returns the recorded session to the conflict panel", async () => {
    launch.mockResolvedValue({ projectId: "project", agentSessionId: "s1" });
    const onClose = vi.fn();
    const onStarted = vi.fn();
    render(
      <AgentFixConfirmDialog
        proposal={proposal}
        onClose={onClose}
        onStarted={onStarted}
      />,
    );
    expect(
      screen.getByText(/Agent fix starts an agent session on your machine/),
    ).toBeVisible();
    expect(launch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("proposal-agent-fix-start"));
    await waitFor(() =>
      expect(onStarted).toHaveBeenCalledWith({
        projectId: "project",
        agentSessionId: "s1",
      }),
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledWith(proposal, {
      machineId: "machine",
      provider: "claude",
      model: "model",
      reasoningEffort: "high",
      fastMode: undefined,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("stays open with the error and a Retry when the launch fails", async () => {
    launch.mockResolvedValue(null);
    launchState.error = "No CLI picked up the launch.";
    const onClose = vi.fn();
    const onStarted = vi.fn();
    render(
      <AgentFixConfirmDialog
        proposal={proposal}
        onClose={onClose}
        onStarted={onStarted}
      />,
    );
    expect(screen.getByTestId("proposal-agent-fix-error")).toHaveTextContent(
      "No CLI picked up the launch.",
    );
    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() => expect(launch).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
  });
});
