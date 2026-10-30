import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  type MachineDto,
} from "@hey-hey/ui-common/api";
import {
  useAgentSessionRouting,
  useUserPairedMachines,
} from "@hey-hey/ui-common/data";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CostsView, getCostsRoutingUnavailableMessage } from "./CostsView";

const mockCostsActivityView = vi.fn();

vi.mock("@hey-hey/ui-common/components", async (importOriginal) => ({
  ...(await importOriginal()),
  CostsActivityView: (props: unknown) => {
    mockCostsActivityView(props);
    return <div>Shared Costs Activity</div>;
  },
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useAgentSessionRouting: vi.fn(),
  useUserPairedMachines: vi.fn(),
}));

const useAgentSessionRoutingMock = vi.mocked(useAgentSessionRouting);
const useUserPairedMachinesMock = vi.mocked(useUserPairedMachines);

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
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
  bindings: [],
});

const setHookResults = ({
  routingAgentSessionId = null,
  machines = [],
  routingLoading = false,
  machinesLoading = false,
}: {
  routingAgentSessionId?: string | null;
  machines?: MachineDto[];
  routingLoading?: boolean;
  machinesLoading?: boolean;
} = {}) => {
  useAgentSessionRoutingMock.mockReturnValue({
    routingAgentSessionId,
    isLoading: routingLoading,
  });
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

  it("shows routing progress while the routing session or paired machines are loading", () => {
    setHookResults({ routingLoading: true });

    render(
      <CostsView
        organizationId="org-1"
        projectId="project-1"
        userId="user-1"
      />,
    );

    expect(
      screen.getByTestId("project-costs-routing-loading"),
    ).toBeInTheDocument();
    expect(mockCostsActivityView).not.toHaveBeenCalled();
  });

  it("shows connected-host unavailability when no session is bound to a ready machine", () => {
    setHookResults({
      machines: [machine("machine-1", MachineExecutionReadinessState.Ready)],
    });

    render(
      <CostsView
        organizationId="org-1"
        projectId="project-1"
        userId="user-1"
      />,
    );

    expect(
      screen.getByTestId("project-costs-host-unavailable"),
    ).toBeInTheDocument();
    expect(mockCostsActivityView).not.toHaveBeenCalled();
  });

  it("shows local enrollment guidance when no ready route exists", () => {
    expect(
      getCostsRoutingUnavailableMessage(
        [
          machine(
            "machine-1",
            MachineExecutionReadinessState.ControllerEnrollmentRequired,
          ),
        ],
        "Cost data",
      ),
    ).toContain("Begin controller enrollment locally");
  });

  it("asks for the routing session of ready machines only, without loading the session list", () => {
    setHookResults({
      routingAgentSessionId: "session-1",
      machines: [
        machine("machine-1", MachineExecutionReadinessState.Ready),
        machine("machine-2", MachineExecutionReadinessState.Disconnected),
      ],
    });

    render(
      <CostsView
        organizationId="org-1"
        projectId="project-1"
        userId="user-1"
      />,
    );

    expect(useAgentSessionRoutingMock).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "user-1",
      ["machine-1"],
    );
    expect(mockCostsActivityView).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      routingAgentSessionId: "session-1",
    });
    expect(screen.getByText("Shared Costs Activity")).toBeInTheDocument();
  });
});
