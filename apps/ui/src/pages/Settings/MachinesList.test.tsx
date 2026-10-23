import {
  AuthorizationProtocolVersion,
  ControllerEnrollmentEligibilityState,
  MachineExecutionReadinessState,
  type ControllerInventoryResponseDto,
  type MachineDto,
} from "@hey-hey/ui-common/api";
import {
  useControllerInventory,
  useRevokeMachine,
  useUserPairedMachines,
} from "@hey-hey/ui-common/data";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MachinesList } from "./MachinesList";

vi.mock("@hey-hey/ui-common/data", () => ({
  useUserPairedMachines: vi.fn(),
  useRevokeMachine: vi.fn(),
  useControllerInventory: vi.fn(() => ({
    data: null,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
  })),
  useRevokeController: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  })),
}));

const useUserPairedMachinesMock = vi.mocked(useUserPairedMachines);
const useRevokeMachineMock = vi.mocked(useRevokeMachine);
const useControllerInventoryMock = vi.mocked(useControllerInventory);

const buildMachine = (overrides: Partial<MachineDto> = {}): MachineDto => ({
  machineId: "machine-1",
  name: "Zac's MacBook",
  pairedAt: "2026-05-10T00:00:00.000Z",
  lastSeen: "2026-05-17T12:00:00.000Z",
  active: true,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness: MachineExecutionReadinessState.Ready,
  ...overrides,
});

const buildQueryReturn = (
  overrides: Partial<ReturnType<typeof useUserPairedMachines>> = {},
): ReturnType<typeof useUserPairedMachines> => ({
  machines: [],
  data: [],
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn(),
  markStale: vi.fn(),
  ...overrides,
});

const buildMutationReturn = (
  overrides: Partial<ReturnType<typeof useRevokeMachine>> = {},
): ReturnType<typeof useRevokeMachine> => ({
  mutate: vi.fn().mockResolvedValue(undefined),
  isPending: false,
  isSuccess: false,
  isError: false,
  error: null,
  ...overrides,
});

const buildControllerQueryReturn = (
  data: ControllerInventoryResponseDto | null,
): ReturnType<typeof useControllerInventory> => ({
  data,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn(),
  markStale: vi.fn(),
});

describe("MachinesList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useControllerInventoryMock.mockReturnValue(
      buildControllerQueryReturn(null),
    );
  });

  it("shows a loading indicator while machines are loading", () => {
    useUserPairedMachinesMock.mockReturnValue(
      buildQueryReturn({ isLoading: true }),
    );
    useRevokeMachineMock.mockReturnValue(buildMutationReturn());
    render(<MachinesList />);
    expect(screen.getByTestId("settings-machines-loading")).toBeInTheDocument();
  });

  it("shows an error alert when the machines query errors", () => {
    useUserPairedMachinesMock.mockReturnValue(
      buildQueryReturn({ error: new Error("boom") }),
    );
    useRevokeMachineMock.mockReturnValue(buildMutationReturn());
    render(<MachinesList />);
    const alert = screen.getByTestId("settings-machines-error");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("boom");
  });

  it("renders pairing guidance in the empty state", () => {
    useUserPairedMachinesMock.mockReturnValue(buildQueryReturn());
    useRevokeMachineMock.mockReturnValue(buildMutationReturn());
    render(<MachinesList />);
    const empty = screen.getByTestId("settings-machines-empty");
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toContain("No Agent Bridges yet.");
    expect(empty.textContent).toContain("heyhey pair");
  });

  it("renders one row per machine when populated", () => {
    const machines = [
      buildMachine({ machineId: "m-1", name: "Laptop" }),
      buildMachine({ machineId: "m-2", name: "Workstation", lastSeen: null }),
    ];
    useUserPairedMachinesMock.mockReturnValue(
      buildQueryReturn({ machines, data: machines }),
    );
    useRevokeMachineMock.mockReturnValue(buildMutationReturn());
    render(<MachinesList />);
    expect(screen.getByTestId("settings-machines-list")).toBeInTheDocument();
    const rows = screen.getAllByTestId("settings-agent-bridge-card");
    expect(rows).toHaveLength(2);
    expect(
      within(rows[0]).getByTestId("settings-agent-bridge-name"),
    ).toHaveTextContent("Laptop");
    expect(
      within(rows[1]).getByTestId("settings-agent-bridge-name"),
    ).toHaveTextContent("Workstation");
    expect(
      within(rows[1]).getByTestId("settings-agent-bridge-last-seen"),
    ).toHaveTextContent("Last seen Never");
  });

  it("opens the revoke dialog when the revoke button is clicked", () => {
    const machines = [buildMachine({ machineId: "m-1", name: "Laptop" })];
    useUserPairedMachinesMock.mockReturnValue(
      buildQueryReturn({ machines, data: machines }),
    );
    useRevokeMachineMock.mockReturnValue(buildMutationReturn());
    render(<MachinesList />);
    expect(screen.queryByTestId("revoke-machine-dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("settings-remove-agent-bridge"));
    const dialog = screen.getByTestId("revoke-machine-dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/Laptop/)).toBeInTheDocument();
  });

  it("calls mutate with the right machineId on confirm", () => {
    const machines = [buildMachine({ machineId: "m-1" })];
    useUserPairedMachinesMock.mockReturnValue(
      buildQueryReturn({ machines, data: machines }),
    );
    const mutate = vi.fn().mockResolvedValue(undefined);
    useRevokeMachineMock.mockReturnValue(buildMutationReturn({ mutate }));
    render(<MachinesList />);
    fireEvent.click(screen.getByTestId("settings-remove-agent-bridge"));
    fireEvent.click(screen.getByTestId("revoke-machine-confirm"));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ machineId: "m-1" });
  });

  it("closes the dialog on cancel without calling mutate", async () => {
    const machines = [buildMachine({ machineId: "m-1" })];
    useUserPairedMachinesMock.mockReturnValue(
      buildQueryReturn({ machines, data: machines }),
    );
    const mutate = vi.fn();
    useRevokeMachineMock.mockReturnValue(buildMutationReturn({ mutate }));
    render(<MachinesList />);
    fireEvent.click(screen.getByTestId("settings-remove-agent-bridge"));
    const dialog = screen.getByTestId("revoke-machine-dialog");
    expect(dialog).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("revoke-machine-cancel"));
    expect(mutate).not.toHaveBeenCalled();
    await waitForElementToBeRemoved(() =>
      screen.queryByTestId("revoke-machine-dialog"),
    );
  });

  it("shows an inline error when revocation fails", async () => {
    const machines = [buildMachine({ machineId: "m-1" })];
    useUserPairedMachinesMock.mockReturnValue(
      buildQueryReturn({ machines, data: machines }),
    );
    let capturedOnError: ((error: Error) => void) | undefined;
    useRevokeMachineMock.mockImplementation((opts) => {
      capturedOnError = opts?.onError;
      return buildMutationReturn({
        mutate: vi.fn().mockImplementation(() => {
          capturedOnError?.(new Error("revoke failed"));
          return Promise.reject(new Error("revoke failed"));
        }),
      });
    });
    render(<MachinesList />);
    fireEvent.click(screen.getByTestId("settings-remove-agent-bridge"));
    fireEvent.click(screen.getByTestId("revoke-machine-confirm"));
    await waitFor(() => {
      expect(
        screen.getByTestId("settings-machines-revoke-error"),
      ).toHaveTextContent("revoke failed");
    });
  });

  it("keeps Passkey status and recovery guidance inside the affected Agent Bridge card", () => {
    const machines = [
      buildMachine({ machineId: "active-bridge", name: "MacBook-Pro" }),
      buildMachine({
        machineId: "legacy-bridge",
        name: "Paired machine",
        active: false,
        authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_1,
        executionReadiness: MachineExecutionReadinessState.LegacyProtocol,
      }),
    ];
    useUserPairedMachinesMock.mockReturnValue(
      buildQueryReturn({ machines, data: machines }),
    );
    useRevokeMachineMock.mockReturnValue(buildMutationReturn());
    useControllerInventoryMock.mockImplementation((machineId) =>
      buildControllerQueryReturn({
        machineId,
        authorizationProtocolVersion:
          machineId === "active-bridge"
            ? AuthorizationProtocolVersion.NUMBER_2
            : AuthorizationProtocolVersion.NUMBER_1,
        enrollmentState:
          machineId === "active-bridge"
            ? ControllerEnrollmentEligibilityState.Ready
            : ControllerEnrollmentEligibilityState.NoController,
        executionReadiness:
          machineId === "active-bridge"
            ? MachineExecutionReadinessState.Ready
            : MachineExecutionReadinessState.LegacyProtocol,
        controllers:
          machineId === "active-bridge"
            ? [
                {
                  credentialId: "passkey-1",
                  label: "MacBook passkey",
                  fingerprint: "sha256:macbook",
                  createdAt: "2026-08-01T12:00:00.000Z",
                  lastUsedAt: "2026-08-17T11:00:00.000Z",
                  backupEligible: true,
                  backupState: true,
                  revocationState: "ACTIVE",
                  revokedAt: null,
                },
              ]
            : [],
      }),
    );

    render(<MachinesList />);

    const cards = screen.getAllByTestId("settings-agent-bridge-card");
    const activeCard = cards[0];
    const legacyCard = cards[1];
    expect(within(activeCard).getByText("MacBook passkey")).toBeInTheDocument();
    expect(
      within(activeCard).queryByTestId("settings-controller-recovery"),
    ).not.toBeInTheDocument();
    expect(
      within(legacyCard).getByTestId("settings-controller-recovery"),
    ).toHaveTextContent("“Paired machine” can’t run work");
    expect(
      within(legacyCard).getByTestId("settings-controller-recovery"),
    ).toHaveTextContent("offline, uses an older Hey Hey CLI");
    expect(
      within(legacyCard).getByTestId("settings-controller-recovery"),
    ).toHaveTextContent("remove this Agent Bridge");
    expect(
      within(legacyCard).getByTestId("settings-remove-agent-bridge"),
    ).toBeEnabled();
  });
});
