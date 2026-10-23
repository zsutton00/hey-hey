import {
  AuthorizationProtocolVersion,
  ControllerEnrollmentEligibilityState,
  MachineExecutionReadinessState,
  type ControllerCredentialSummaryDto,
  type ControllerInventoryResponseDto,
  type MachineDto,
} from "@hey-hey/ui-common/api";
import {
  useControllerInventory,
  useRevokeController,
} from "@hey-hey/ui-common/data";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ControllerInventory } from "./ControllerInventory";

vi.mock("@hey-hey/ui-common/data", () => ({
  ControllerManagementDenialError: class ControllerManagementDenialError extends Error {},
  useControllerInventory: vi.fn(),
  useRevokeController: vi.fn(),
}));

const useControllerInventoryMock = vi.mocked(useControllerInventory);
const useRevokeControllerMock = vi.mocked(useRevokeController);

const machine: MachineDto = {
  machineId: "machine-1",
  name: "Zac's MacBook",
  pairedAt: "2026-05-10T00:00:00.000Z",
  lastSeen: "2026-08-17T12:00:00.000Z",
  active: true,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness: MachineExecutionReadinessState.Ready,
};

const controller = (
  overrides: Partial<ControllerCredentialSummaryDto> = {},
): ControllerCredentialSummaryDto => ({
  credentialId: "controller-1",
  label: "MacBook passkey",
  fingerprint: "sha256:short",
  createdAt: "2026-08-01T12:00:00.000Z",
  lastUsedAt: "2026-08-17T11:00:00.000Z",
  backupEligible: true,
  backupState: true,
  revocationState: "ACTIVE",
  revokedAt: null,
  ...overrides,
});

const inventory = (
  overrides: Partial<ControllerInventoryResponseDto> = {},
): ControllerInventoryResponseDto => ({
  machineId: "machine-1",
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  enrollmentState: ControllerEnrollmentEligibilityState.Ready,
  executionReadiness: MachineExecutionReadinessState.Ready,
  controllers: [controller()],
  ...overrides,
});

const queryReturn = (
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

const mutationReturn = (
  overrides: Partial<ReturnType<typeof useRevokeController>> = {},
): ReturnType<typeof useRevokeController> => ({
  mutate: vi.fn().mockResolvedValue(undefined),
  isPending: false,
  isSuccess: false,
  isError: false,
  error: null,
  ...overrides,
});

describe("ControllerInventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useControllerInventoryMock.mockReturnValue(queryReturn(inventory()));
    useRevokeControllerMock.mockReturnValue(mutationReturn());
  });

  it("renders safe evidence and mixed backup states", () => {
    useControllerInventoryMock.mockReturnValue(
      queryReturn(
        inventory({
          controllers: [
            controller(),
            controller({
              credentialId: "controller-2",
              label: "Phone passkey",
              fingerprint: "sha256:phone",
              backupEligible: false,
              backupState: false,
              lastUsedAt: null,
            }),
          ],
        }),
      ),
    );

    render(<ControllerInventory machine={machine} />);

    expect(screen.getByTestId("settings-passkeys-heading")).toHaveClass(
      "MuiTypography-subtitle1",
    );
    expect(screen.getByTestId("settings-controller-list")).toHaveStyle({
      paddingLeft: "16px",
    });
    expect(screen.getAllByTestId("settings-controller-row")).toHaveLength(2);
    expect(screen.getByText("MacBook passkey")).toBeInTheDocument();
    expect(
      screen.getAllByTestId("settings-controller-fingerprint")[0],
    ).toHaveTextContent("sha256:short");
    expect(screen.getAllByTestId("settings-controller-backup")[0]).toHaveTextContent(
      "Eligible for backup · Backed up",
    );
    expect(screen.getAllByTestId("settings-controller-backup")[1]).toHaveTextContent(
      "Not eligible for backup · Not backed up",
    );
    expect(screen.getAllByTestId("settings-controller-last-used")[1]).toHaveTextContent(
     "Never",
   );
    expect(screen.getByTestId("settings-controller-passkey-copy")).toHaveTextContent(
      "authorize this Agent Bridge",
    );
    expect(screen.queryByText("controller-1")).not.toBeInTheDocument();
  });

  it("requires explicit confirmation and sends the selected controller", () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    useRevokeControllerMock.mockReturnValue(mutationReturn({ mutate }));

    render(<ControllerInventory machine={machine} />);

    fireEvent.click(screen.getByTestId("settings-controller-revoke"));
    expect(screen.getByTestId("revoke-controller-dialog")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("revoke-controller-confirm"));

    expect(mutate).toHaveBeenCalledWith({
      machineId: "machine-1",
      controllerCredentialId: "controller-1",
    });
  });

  it("disables controller controls while revocation is pending", () => {
    useRevokeControllerMock.mockReturnValue(
      mutationReturn({ isPending: true }),
    );

    render(<ControllerInventory machine={machine} />);

    expect(screen.getByTestId("settings-controller-revoke")).toBeDisabled();
  });

  it("shows local-only recovery guidance after the last controller is gone", () => {
    useControllerInventoryMock.mockReturnValue(
      queryReturn(
        inventory({
          controllers: [],
          enrollmentState: ControllerEnrollmentEligibilityState.NoController,
          executionReadiness:
            MachineExecutionReadinessState.ControllerEnrollmentRequired,
        }),
      ),
    );

    render(<ControllerInventory machine={machine} />);

    const recovery = screen.getByTestId("settings-controller-recovery");
    expect(recovery).toHaveTextContent(
      "“Zac's MacBook” can’t run work",
    );
    expect(recovery).toHaveTextContent(
      "This Agent Bridge has no active Passkey",
    );
    expect(recovery).toHaveTextContent("heyhey controllers add");
    expect(recovery).toHaveTextContent("remove this Agent Bridge");
    expect(recovery).toHaveAttribute("data-machine-id", "machine-1");
  });

  it("does not show recovery guidance while an active controller exists", () => {
    render(<ControllerInventory machine={machine} />);

    expect(
      screen.queryByTestId("settings-controller-recovery"),
    ).not.toBeInTheDocument();
  });
});
