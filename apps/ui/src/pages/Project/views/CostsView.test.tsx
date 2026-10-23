import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  type AgentSessionDto,
  type MachineDto,
} from "@hey-hey/ui-common/api";
import {
  useAgentSessions,
  useUserPairedMachines,
} from "@hey-hey/ui-common/data";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CostsView,
  getCostsRoutingUnavailableMessage,
  selectCostsRoutingSession,
} from "./CostsView";

const mockCostsActivityView = vi.fn();

vi.mock("@hey-hey/ui-common/components", async (importOriginal) => ({
  ...(await importOriginal()),
  CostsActivityView: (props: unknown) => {
    mockCostsActivityView(props);
    return <div>Shared Costs Activity</div>;
  },
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useAgentSessions: vi.fn(),
  useUserPairedMachines: vi.fn(),
}));

const useAgentSessionsMock = vi.mocked(useAgentSessions);
const useUserPairedMachinesMock = vi.mocked(useUserPairedMachines);

const session = (
  id: string,
  machineId: string | null,
  updatedAt: string,
): AgentSessionDto =>
  ({
    id,
    machineId,
    updatedAt,
    sessionDate: updatedAt,
  }) as AgentSessionDto;

const machine = (
  machineId: string,
  executionReadiness: MachineDto["executionReadiness"],
): MachineDto => ({
  machineId,
  name: machineId,
  pairedAt: "2026-08-13T00:00:00.000Z",
  active: executionReadiness === MachineExecutionReadinessState.Ready,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness,
  currentControllerEligibility: CurrentControllerMachineEligibilityState.Eligible,
  bindings: [],
});

const setHookResults = ({
  sessions = [],
  machines = [],
  sessionsLoading = false,
  machinesLoading = false,
}: {
  sessions?: AgentSessionDto[];
  machines?: MachineDto[];
  sessionsLoading?: boolean;
  machinesLoading?: boolean;
} = {}) => {
  useAgentSessionsMock.mockReturnValue({
    agentSessions: sessions,
    isLoading: sessionsLoading,
  } as ReturnType<typeof useAgentSessions>);
  useUserPairedMachinesMock.mockReturnValue({
    machines,
    isLoading: machinesLoading,
  } as ReturnType<typeof useUserPairedMachines>);
};

describe("CostsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setHookResults();
  });

  it("shows routing progress while sessions or paired machines are loading", () => {
    setHookResults({ sessionsLoading: true });

    render(
      <CostsView organizationId="org-1" projectId="project-1" userId="user-1" />,
    );

    expect(screen.getByTestId("project-costs-routing-loading")).toBeInTheDocument();
    expect(mockCostsActivityView).not.toHaveBeenCalled();
  });

  it("shows connected-host unavailability when no machine-bound session exists", () => {
    setHookResults({
      sessions: [session("unbound", null, "2026-07-28T12:00:00.000Z")],
      machines: [machine("machine-1", MachineExecutionReadinessState.Ready)],
    });

    render(
      <CostsView organizationId="org-1" projectId="project-1" userId="user-1" />,
    );

    expect(screen.getByTestId("project-costs-host-unavailable")).toBeInTheDocument();
    expect(mockCostsActivityView).not.toHaveBeenCalled();
  });

  it("prefers the most recent session bound to an execution-ready machine", () => {
    const selected = selectCostsRoutingSession(
      [
        session("inactive-newer", "machine-2", "2026-07-28T14:00:00.000Z"),
        session("active-older", "machine-1", "2026-07-28T13:00:00.000Z"),
        session("active-newer", "machine-1", "2026-07-28T13:30:00.000Z"),
      ],
      [
        machine("machine-1", MachineExecutionReadinessState.Ready),
        machine("machine-2", MachineExecutionReadinessState.Disconnected),
      ],
    );

    expect(selected?.id).toBe("active-newer");
  });

  it("makes no CLI route when bound machines are ineligible", () => {
    const selected = selectCostsRoutingSession(
      [
        session("session-a", "machine-1", "2026-07-28T13:00:00.000Z"),
        session("session-b", "machine-2", "2026-07-28T13:00:00.000Z"),
        session("session-old", "machine-3", "2026-07-28T12:00:00.000Z"),
      ],
      [
        machine("machine-1", MachineExecutionReadinessState.Disconnected),
        machine(
          "machine-2",
          MachineExecutionReadinessState.ControllerEnrollmentRequired,
        ),
      ],
    );

    expect(selected).toBeNull();
  });

  it("shows local enrollment guidance when no ready route exists", () => {
    expect(
      getCostsRoutingUnavailableMessage([], [
        machine(
          "machine-1",
          MachineExecutionReadinessState.ControllerEnrollmentRequired,
        ),
      ], "Cost data"),
    ).toContain("Begin controller enrollment locally");
  });

  it("forwards project identity and the routing session to the shared Costs view", () => {
    setHookResults({
      sessions: [session("session-1", "machine-1", "2026-07-28T13:00:00.000Z")],
      machines: [machine("machine-1", MachineExecutionReadinessState.Ready)],
    });

    render(
      <CostsView organizationId="org-1" projectId="project-1" userId="user-1" />,
    );

    expect(useAgentSessionsMock).toHaveBeenCalledWith("org-1", "project-1", {
      userId: "user-1",
    });
    expect(mockCostsActivityView).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      routingAgentSessionId: "session-1",
    });
    expect(screen.getByText("Shared Costs Activity")).toBeInTheDocument();
  });
});
