import {
  AuthorizationProtocolVersion,
  MachineExecutionReadinessState,
  type MachineDto,
} from "@hey-hey/ui-common/api";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@hey-hey/ui-common/data", () => ({
  useControllerInventory: () => ({
    data: {
      machineId: "machine-1",
      authorizationProtocolVersion: 2,
      enrollmentState: "READY",
      executionReadiness: "READY",
      controllers: [],
    },
    isLoading: false,
    error: null,
  }),
  useRevokeController: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));
import { MachineListItem } from "./MachineListItem";

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

describe("MachineListItem", () => {
  it("renders the machine name", () => {
    const machine = buildMachine();
    render(<MachineListItem machine={machine} onRevoke={vi.fn()} />);
    expect(
      screen.getByTestId("settings-agent-bridge-name"),
    ).toHaveTextContent("Zac's MacBook");
  });

  it("keeps enrollment-required machines visible, directs enrollment locally, and allows revocation", () => {
    const machine = buildMachine({
      active: false,
      executionReadiness:
        MachineExecutionReadinessState.ControllerEnrollmentRequired,
    });

    render(<MachineListItem machine={machine} onRevoke={vi.fn()} />);

    expect(
      screen.getByTestId("settings-agent-bridge-readiness"),
    ).toHaveTextContent(
      "Needs a Passkey",
    );
    expect(
      screen.getByTestId("settings-agent-bridge-readiness"),
    ).toHaveTextContent(
      "heyhey controllers add",
    );
    expect(screen.getByTestId("settings-remove-agent-bridge")).toBeEnabled();
  });

  it("renders a relative last-seen label when lastSeen is set", () => {
    const machine = buildMachine();
    render(<MachineListItem machine={machine} onRevoke={vi.fn()} />);
    const label = screen.getByTestId("settings-agent-bridge-last-seen");
    expect(label.textContent).toMatch(/Last seen/i);
    expect(label.textContent).not.toMatch(/Never/);
  });

  it("renders 'Never' when lastSeen is null", () => {
    const machine = buildMachine({ lastSeen: null });
    render(<MachineListItem machine={machine} onRevoke={vi.fn()} />);
    expect(
      screen.getByTestId("settings-agent-bridge-last-seen"),
    ).toHaveTextContent("Last seen Never");
  });

  it("renders 'Never' when lastSeen is undefined", () => {
    const machine = buildMachine({ lastSeen: undefined });
    render(<MachineListItem machine={machine} onRevoke={vi.fn()} />);
    expect(
      screen.getByTestId("settings-agent-bridge-last-seen"),
    ).toHaveTextContent("Last seen Never");
  });

  it("invokes onRevoke with the machine when the revoke button is clicked", () => {
    const machine = buildMachine();
    const handleRevoke = vi.fn();
    render(<MachineListItem machine={machine} onRevoke={handleRevoke} />);
    fireEvent.click(
      screen.getByTestId("settings-remove-agent-bridge"),
    );
    expect(handleRevoke).toHaveBeenCalledTimes(1);
    expect(handleRevoke).toHaveBeenCalledWith(machine);
  });

  it("keeps revocation available across non-ready readiness states", () => {
    const readinessStates = [
      MachineExecutionReadinessState.Disconnected,
      MachineExecutionReadinessState.LegacyProtocol,
      MachineExecutionReadinessState.ControllerEnrollmentRequired,
      MachineExecutionReadinessState.ControllerRevoked,
    ];

    for (const executionReadiness of readinessStates) {
      const { unmount } = render(
        <MachineListItem
          machine={buildMachine({ executionReadiness })}
          onRevoke={vi.fn()}
        />,
      );
      expect(screen.getByTestId("settings-remove-agent-bridge")).toBeEnabled();
      unmount();
    }
  });

  it("renders an offline legacy Agent Bridge in user-facing language", () => {
    render(
      <MachineListItem
        machine={buildMachine({
          active: false,
          executionReadiness: MachineExecutionReadinessState.LegacyProtocol,
        })}
        onRevoke={vi.fn()}
      />,
    );

    expect(
      screen.getByTestId("settings-agent-bridge-connection"),
    ).toHaveTextContent("Offline");
    expect(
      screen.getByTestId("settings-agent-bridge-readiness"),
    ).toHaveTextContent("Update needed");
    expect(
      screen.getByTestId("settings-agent-bridge-readiness"),
    ).toHaveTextContent("older Hey Hey CLI");
  });
});
