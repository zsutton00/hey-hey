import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  type MachineDto,
} from "@hey-hey/contracts/api";
import {
  useAgentSessionRouting,
  useUserPairedMachines,
} from "@hey-hey/ui-common/data";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsageView } from "./UsageView";

const mockProviderUsageActivityView = vi.fn();

vi.mock("@hey-hey/ui-common/components", async (importOriginal) => ({
  ...(await importOriginal()),
  ProviderUsageActivityView: (props: unknown) => {
    mockProviderUsageActivityView(props);
    return <div>Shared Provider Usage</div>;
  },
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useAgentSessionRouting: vi.fn(),
  useUserPairedMachines: vi.fn(),
}));

const useAgentSessionRoutingMock = vi.mocked(useAgentSessionRouting);
const useUserPairedMachinesMock = vi.mocked(useUserPairedMachines);

const readyMachine = (machineId: string): MachineDto => ({
  machineId,
  name: machineId,
  pairedAt: "2026-08-13T00:00:00.000Z",
  active: true,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness: MachineExecutionReadinessState.Ready,
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
  bindings: [],
});

const setHookResults = (
  routingAgentSessionId: string | null,
  machines: MachineDto[],
) => {
  useAgentSessionRoutingMock.mockReturnValue({
    routingAgentSessionId,
    isLoading: false,
  });
  useUserPairedMachinesMock.mockReturnValue({
    machines,
    isLoading: false,
  } as ReturnType<typeof useUserPairedMachines>);
};

describe("UsageView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("explains provider usage is unavailable when no CLI is paired", () => {
    setHookResults(null, []);

    render(
      <UsageView
        organizationId="org-1"
        projectId="project-1"
        userId="user-1"
      />,
    );

    expect(
      screen.getByTestId("project-usage-host-unavailable"),
    ).toHaveTextContent("Provider usage is unavailable");
    expect(mockProviderUsageActivityView).not.toHaveBeenCalled();
  });

  it("routes the shared Usage view through a session bound to a ready CLI", () => {
    setHookResults("session-1", [readyMachine("machine-1")]);

    render(
      <UsageView
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
    expect(mockProviderUsageActivityView).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      routingAgentSessionId: "session-1",
    });
  });
});
