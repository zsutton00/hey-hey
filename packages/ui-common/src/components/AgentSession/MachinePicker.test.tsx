import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  type MachineDto,
} from "../../api";
import { MachinePicker } from "./MachinePicker";

const originalMatchMedia = window.matchMedia;

const setViewport = (mobile: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: mobile && query.includes("max-width"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

const machine = (
  machineId: string,
  executionReadiness: MachineDto["executionReadiness"],
  currentControllerEligibility: MachineDto["currentControllerEligibility"] =
    CurrentControllerMachineEligibilityState.Eligible
): MachineDto => ({
  machineId,
  name: machineId,
  pairedAt: "2026-08-13T00:00:00.000Z",
  active: executionReadiness === MachineExecutionReadinessState.Ready,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness,
  currentControllerEligibility,
  bindings: [],
});

describe("MachinePicker", () => {
  it("allows a ready paired CLI regardless of browser locality", async () => {
    const onSelect = vi.fn();
    render(
      <MachinePicker
        machines={[
          machine("mac", MachineExecutionReadinessState.Ready),
          machine("linux", MachineExecutionReadinessState.Ready),
        ]}
        selectedMachineId="mac"
        onSelect={onSelect}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox"));

    const remoteOption = screen.getByRole("option", {
      name: "linux — Ready",
    });
    expect(remoteOption).not.toHaveAttribute("aria-disabled", "true");

    await user.click(remoteOption);
    expect(onSelect).toHaveBeenCalledWith("linux");
  });

  it("shows every paired machine with an action for every ineligible state", () => {
    render(
      <MachinePicker
        machines={[
          machine("ready", MachineExecutionReadinessState.Ready),
          machine(
            "enroll",
            MachineExecutionReadinessState.ControllerEnrollmentRequired
          ),
          machine("revoked", MachineExecutionReadinessState.MachineRevoked),
          machine("legacy", MachineExecutionReadinessState.LegacyProtocol),
          machine("offline", MachineExecutionReadinessState.Disconnected),
        ]}
        selectedMachineId={null}
        onSelect={vi.fn()}
      />
    );

    fireEvent.mouseDown(screen.getByRole("combobox"));
    const options = screen.getAllByTestId("machine-picker-option");
    expect(options).toHaveLength(5);
    expect(screen.getByText("ready — Ready")).not.toHaveAttribute(
      "aria-disabled",
      "true"
    );
    for (const action of [
      "View controller setup",
      "View details",
      "View update steps",
      "How to reconnect",
    ]) {
      expect(screen.getByRole("button", { name: action })).toBeInTheDocument();
    }
    for (const reason of [
      "Begin controller enrollment locally from this machine before running local work.",
      "This machine was revoked and cannot run local work.",
      "Update the CLI and begin controller enrollment locally on this machine.",
      "Start the CLI on this machine and wait for it to connect.",
    ]) {
      expect(screen.getByText(reason)).toBeInTheDocument();
    }
  });

  it("forwards only classifier-selected machines", async () => {
    const onSelect = vi.fn();
    render(
      <MachinePicker
        machines={[
          machine("ready", MachineExecutionReadinessState.Ready),
          machine("offline", MachineExecutionReadinessState.Disconnected),
        ]}
        selectedMachineId={null}
        onSelect={onSelect}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "ready — Ready" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("ready");
  });

  it("opens target-specific browser authorization from an unavailable option", async () => {
    render(
      <MachinePicker
        machines={[
          machine(
            "remote",
            MachineExecutionReadinessState.Ready,
            CurrentControllerMachineEligibilityState.NotEnrolled
          ),
        ]}
        selectedMachineId={null}
        onSelect={vi.fn()}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox"));
    await user.click(
      screen.getByRole("option", { name: "remote — Authorize this browser" })
    );

    expect(
      screen.getByRole("dialog", {
        name: "Authorize this browser — remote",
      })
    ).toBeInTheDocument();
    expect(screen.getByText("heyhey controllers add")).toBeInTheDocument();
  });

  it("never selects an ineligible machine when opening its recovery action", async () => {
    const onSelect = vi.fn();
    render(
      <MachinePicker
        machines={[
          machine("offline", MachineExecutionReadinessState.Disconnected),
        ]}
        selectedMachineId={null}
        onSelect={onSelect}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox"));
    await user.click(
      screen.getByRole("option", { name: "offline — Disconnected" })
    );
    fireEvent.change(
      screen.getByTestId("machine-picker-select").querySelector("input"),
      {
        target: { value: "offline" },
      }
    );

    expect(onSelect).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Disconnected — offline" })
    ).toBeInTheDocument();
  });

  it("renders a single-line selected-machine value", () => {
    render(
      <MachinePicker
        machines={[machine("ready", MachineExecutionReadinessState.Ready)]}
        selectedMachineId="ready"
        onSelect={vi.fn()}
      />
    );

    const select = screen.getByTestId("machine-picker-select");
    expect(select).toHaveTextContent("ready — Ready");
    expect(select).not.toHaveTextContent(
      "Connected and authorized for local work."
    );
  });

  it("collapses to a mobile summary and opens the vertical picker editor", async () => {
    setViewport(true);
    render(
      <MachinePicker
        machines={[machine("ready", MachineExecutionReadinessState.Ready)]}
        selectedMachineId="ready"
        onSelect={vi.fn()}
      />
    );

    expect(
      screen.getByTestId("machine-picker-mobile-summary")
    ).toHaveTextContent("ready — Ready");
    expect(screen.queryByTestId("machine-picker")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByTestId("machine-picker-mobile-edit"));

    expect(
      screen.getByRole("dialog", { name: "Edit CLI machine" })
    ).toBeInTheDocument();
    expect(screen.getByTestId("machine-picker")).toBeVisible();
  });
});
