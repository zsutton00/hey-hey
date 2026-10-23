import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
} from "../../../api";
import { AgentBridgeRecoveryNotice } from "../AgentBridgeRecoveryNotice";
import type {
  AgentBridgeMachine,
  AgentBridgeRecoveryState,
} from "../agentBridgeRecoveryState";

const orbit: AgentBridgeMachine = {
  machineId: "machine-orbit",
  name: "Orbit",
  executionReadiness: MachineExecutionReadinessState.Disconnected,
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
};

describe("AgentBridgeRecoveryNotice", () => {
  it("renders one actionable row per unavailable Agent Bridge", () => {
    render(
      <AgentBridgeRecoveryNotice
        state={{
          type: "paired_none_ready",
          machines: [
            { type: "disconnected", machine: orbit },
            {
              type: "machine_revoked",
              machine: { ...orbit, machineId: "machine-nova", name: "Nova" },
            },
          ],
        }}
      />
    );

    expect(
      screen.getAllByTestId("agent-bridge-recovery-machine-row")
    ).toHaveLength(2);
    expect(screen.getByText("Orbit")).toBeInTheDocument();
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(screen.getByText("Nova")).toBeInTheDocument();
    expect(screen.getByText("Agent Bridge revoked")).toBeInTheDocument();
  });

  it("does not duplicate prose for multiple Agent Bridges with the same problem", () => {
    render(
      <AgentBridgeRecoveryNotice
        state={{
          type: "paired_none_ready",
          machines: [
            { type: "disconnected", machine: orbit },
            {
              type: "disconnected",
              machine: {
                ...orbit,
                machineId: "machine-orbit-repaired",
                name: "Orbit 2",
              },
            },
          ],
        }}
      />
    );

    expect(screen.getAllByText("Disconnected")).toHaveLength(2);
    expect(
      screen.queryByText(/No paired Agent Bridge can currently run/)
    ).not.toBeInTheDocument();
  });

  it("opens target-specific browser authorization guidance", () => {
    render(
      <AgentBridgeRecoveryNotice
        state={{
          type: "browser_authorization_required",
          machine: {
            ...orbit,
            executionReadiness: MachineExecutionReadinessState.Ready,
            currentControllerEligibility:
              CurrentControllerMachineEligibilityState.NotEnrolled,
          },
        }}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Authorize this browser" })
    );

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Authorize this browser — Orbit"
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "heyhey controllers add"
    );
    expect(
      screen.getByTestId("agent-bridge-authorize-browser-continue")
    ).toHaveAttribute(
      "href",
      "/pairing?section=pairing&intent=authorize-browser&machineId=machine-orbit&machineName=Orbit"
    );
  });

  it("routes missing browser controller context through a new controller claim", () => {
    render(
      <AgentBridgeRecoveryNotice
        state={{
          type: "controller_context_unavailable",
          machine: {
            ...orbit,
            executionReadiness: MachineExecutionReadinessState.Ready,
            currentControllerEligibility: null,
          },
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "How to restore" }));

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Refreshing cannot restore it"
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "heyhey controllers add"
    );
    expect(
      screen.getByTestId("agent-bridge-authorize-browser-continue")
    ).toHaveAttribute(
      "href",
      "/pairing?section=pairing&intent=authorize-browser&machineId=machine-orbit&machineName=Orbit"
    );
  });

  it("opens guidance in a full-screen dialog on mobile", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    render(
      <AgentBridgeRecoveryNotice
        state={{ type: "disconnected", machine: orbit }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "How to reconnect" }));
    expect(screen.getByRole("dialog")).toHaveClass("MuiDialog-paperFullScreen");
    vi.unstubAllGlobals();
  });

  it("keeps legacy history guidance and offers a new session", () => {
    const onStartNewSession = vi.fn();
    render(
      <AgentBridgeRecoveryNotice
        state={{ type: "legacy_non_resumable" }}
        onStartNewSession={onStartNewSession}
      />
    );

    expect(
      screen.getByText(/conversation history remains available/i)
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Start a new session" })
    );
    expect(onStartNewSession).toHaveBeenCalledOnce();
  });

  it.each(["loading", "ready"] as const)("renders nothing for %s", (type) => {
    const state: AgentBridgeRecoveryState =
      type === "loading" ? { type } : { type, machine: orbit };
    const { container } = render(<AgentBridgeRecoveryNotice state={state} />);
    expect(container).toBeEmptyDOMElement();
  });
});
