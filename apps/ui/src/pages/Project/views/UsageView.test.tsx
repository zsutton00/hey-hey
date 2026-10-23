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
  useAgentSessions: vi.fn(),
  useUserPairedMachines: vi.fn(),
}));

const useAgentSessionsMock = vi.mocked(useAgentSessions);
const useUserPairedMachinesMock = vi.mocked(useUserPairedMachines);

const session = (id: string, machineId: string | null): AgentSessionDto =>
  ({
    id,
    machineId,
    updatedAt: "2026-10-01T00:00:00.000Z",
    sessionDate: "2026-10-01T00:00:00.000Z",
  }) as AgentSessionDto;

const readyMachine = (machineId: string): MachineDto => ({
  machineId,
  name: machineId,
  pairedAt: "2026-08-13T00:00:00.000Z",
  active: true,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness: MachineExecutionReadinessState.Ready,
  currentControllerEligibility: CurrentControllerMachineEligibilityState.Eligible,
  bindings: [],
});

const setHookResults = (
  sessions: AgentSessionDto[],
  machines: MachineDto[],
) => {
  useAgentSessionsMock.mockReturnValue({
    agentSessions: sessions,
    isLoading: false,
  } as ReturnType<typeof useAgentSessions>);
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
    setHookResults([], []);

    render(
      <UsageView organizationId="org-1" projectId="project-1" userId="user-1" />,
    );

    expect(screen.getByTestId("project-usage-host-unavailable")).toHaveTextContent(
      "Provider usage is unavailable",
    );
    expect(mockProviderUsageActivityView).not.toHaveBeenCalled();
  });

  it("routes the shared Usage view through a session bound to a ready CLI", () => {
    setHookResults([session("session-1", "machine-1")], [readyMachine("machine-1")]);

    render(
      <UsageView organizationId="org-1" projectId="project-1" userId="user-1" />,
    );

    expect(mockProviderUsageActivityView).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      routingAgentSessionId: "session-1",
    });
  });
});
