import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionContinuationMode,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  type AgentSessionContinuationDto,
  type MachineDto,
} from "../../../api";

const inspectAgentSessionContinuation = vi.hoisted(() => vi.fn());
const commitAgentSessionContinuation = vi.hoisted(() => vi.fn());
const cancelAgentSessionContinuation = vi.hoisted(() => vi.fn());

vi.mock(
  "../../../data/collections/agentSessionContinuation",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../data/collections/agentSessionContinuation")
    >()),
    inspectAgentSessionContinuation,
    commitAgentSessionContinuation,
    cancelAgentSessionContinuation,
  }),
);

import { AgentSessionContinuationCard } from "../AgentSessionContinuationCard";
import type {
  AgentSessionRecoveryState,
  ContinuationOfferState,
} from "../agentSessionContinuationRecoveryState";
import { useAgentSessionContinuation } from "../useAgentSessionContinuation";

const REVOKED_ID = "11111111-1111-4111-8111-111111111111";

const machine = (name: string): MachineDto => ({
  machineId: `machine-${name}`,
  name,
  pairedAt: "2026-11-01T00:00:00.000Z",
  active: true,
  authorizationProtocolVersion: 2,
  executionReadiness: MachineExecutionReadinessState.Ready,
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
});

const inspected = (
  destination: MachineDto,
  mode: AgentSessionContinuationMode,
  continuationId: string,
): AgentSessionContinuationDto =>
  ({
    continuationId,
    agentSessionId: "session",
    previousMachineId: REVOKED_ID,
    destinationMachineId: destination.machineId,
    state:
      mode === "NATIVE_RESUME" ? "INSPECTED" : "AWAITING_HISTORY_CONFIRMATION",
    nativeState: mode === "NATIVE_RESUME" ? "USABLE" : "ABSENT",
    inspectionReason:
      mode === "NATIVE_RESUME" ? "PROVIDER_STATE_PRESENT" : "NO_LOCAL_RUN",
    mode,
    startRunInputs: { kind: "START_RUN", payload: {} },
    inspectedAt: "2026-11-16T00:00:00.000Z",
    historyConfirmedAt: null,
    nativeResumeRejectedAt: null,
    bindingMovedAt: null,
    bindingRevertedAt: null,
    deliveryGeneration: 0,
    deliveryOperationId: null,
    deliveredAt: null,
    providerStartedAt: null,
    terminalAt: null,
    outcomeCode: null,
  }) as unknown as AgentSessionContinuationDto;

type CardState = Extract<
  AgentSessionRecoveryState,
  {
    type:
      | "continuation_offer"
      | "continuation_pending"
      | "continuation_failed"
      | "continuation_uncertain"
      | "continuation_confirm_history";
  }
>;

const offerOf = (destinations: MachineDto[]): ContinuationOfferState => ({
  type: "continuation_offer",
  boundMachineId: REVOKED_ID,
  destinations,
  unavailable: [],
});

const Harness = ({
  destinations,
  state,
}: {
  destinations: MachineDto[];
  state: CardState;
}) => {
  const controls = useAgentSessionContinuation({
    organizationId: "org",
    projectId: "project",
    agentSessionId: "session",
    conversationId: "conversation",
    boundMachineId: REVOKED_ID,
  });
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <AgentSessionContinuationCard
      state={state}
      controls={controls}
      selectedDestinationId={selected}
      onSelectDestination={setSelected}
      pairingHref="/pairing?returnTo=%2Fprojects%2Fp%2Fconversations%2Fc"
      machineNames={new Map(destinations.map((m) => [m.machineId, m.name]))}
    />
  );
};

const renderCard = (
  destinations: MachineDto[],
  state: CardState = offerOf(destinations),
) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness destinations={destinations} state={state} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  commitAgentSessionContinuation.mockImplementation(
    async ({ continuation }) => ({
      ...continuation,
      state: "PENDING",
    }),
  );
  cancelAgentSessionContinuation.mockImplementation(
    async ({ continuationId }) => ({ continuationId, state: "CANCELLED" }),
  );
});

describe("Agent Session continuation card", () => {
  it("names the sole destination and resumes natively without an extra confirmation", async () => {
    const mac = machine("Mac");
    inspectAgentSessionContinuation.mockImplementation(
      async ({ continuationId }) =>
        inspected(mac, "NATIVE_RESUME", continuationId),
    );
    renderCard([mac]);

    expect(
      screen.queryByTestId("agent-session-continuation-destination"),
    ).toBeNull();
    const action = screen.getByTestId("agent-session-continuation-continue");
    expect(action).toHaveAttribute("data-machine-id", mac.machineId);
    fireEvent.click(action);

    await waitFor(() =>
      expect(commitAgentSessionContinuation).toHaveBeenCalledOnce(),
    );
    expect(inspectAgentSessionContinuation).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedSourceMachineId: REVOKED_ID,
        destination: mac,
      }),
    );
    expect(commitAgentSessionContinuation).toHaveBeenCalledWith(
      expect.objectContaining({ confirmSavedHistory: false, destination: mac }),
    );
  });

  it("lets the person pick among several ready computers", async () => {
    const mac = machine("Mac");
    const mini = machine("Mini");
    inspectAgentSessionContinuation.mockImplementation(
      async ({ continuationId }) =>
        inspected(mini, "NATIVE_RESUME", continuationId),
    );
    renderCard([mac, mini]);

    const picker = screen.getByTestId("agent-session-continuation-destination");
    fireEvent.change(picker, { target: { value: mini.machineId } });
    expect(
      screen.getByTestId("agent-session-continuation-continue"),
    ).toHaveAttribute("data-machine-id", mini.machineId);
    fireEvent.click(screen.getByTestId("agent-session-continuation-continue"));
    await waitFor(() =>
      expect(inspectAgentSessionContinuation).toHaveBeenCalledWith(
        expect.objectContaining({ destination: mini }),
      ),
    );
  });

  it("offers pairing that returns to this conversation when no computer is paired", () => {
    renderCard([]);
    const pair = screen.getByTestId("agent-session-continuation-pair-button");
    expect(pair).toHaveAttribute(
      "href",
      "/pairing?returnTo=%2Fprojects%2Fp%2Fconversations%2Fc",
    );
    expect(inspectAgentSessionContinuation).not.toHaveBeenCalled();
  });

  it("waits for confirmation before starting a new agent session from saved history", async () => {
    const mac = machine("Mac");
    inspectAgentSessionContinuation.mockImplementation(
      async ({ continuationId }) =>
        inspected(mac, "SAVED_HISTORY", continuationId),
    );
    renderCard([mac]);

    fireEvent.click(screen.getByTestId("agent-session-continuation-continue"));
    await waitFor(() =>
      expect(inspectAgentSessionContinuation).toHaveBeenCalledOnce(),
    );
    // The confirmation is durable server state; nothing is delivered first.
    expect(commitAgentSessionContinuation).not.toHaveBeenCalled();
  });

  it("confirms a restored saved-history attempt on its own computer, and cancel records the refusal", async () => {
    const mac = machine("Mac");
    const continuation = inspected(mac, "SAVED_HISTORY", "attempt-1");
    renderCard([mac], {
      type: "continuation_confirm_history",
      continuation,
      destination: mac,
    });

    fireEvent.click(screen.getByTestId("agent-session-continuation-cancel"));
    await waitFor(() =>
      expect(cancelAgentSessionContinuation).toHaveBeenCalledWith(
        expect.objectContaining({ continuationId: "attempt-1" }),
      ),
    );
    expect(commitAgentSessionContinuation).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByTestId("agent-session-continuation-confirm-history"),
    );
    await waitFor(() =>
      expect(commitAgentSessionContinuation).toHaveBeenCalledWith(
        expect.objectContaining({
          continuation,
          destination: mac,
          confirmSavedHistory: true,
        }),
      ),
    );
  });

  it("retries a failed delivery on the same attempt and computer", async () => {
    const mac = machine("Mac");
    const continuation = {
      ...inspected(mac, "NATIVE_RESUME", "attempt-2"),
      state: "FAILED",
      bindingMovedAt: "2026-11-16T00:00:01.000Z",
      deliveryGeneration: 1,
      outcomeCode: "CLI_OFFLINE",
    } as AgentSessionContinuationDto;
    renderCard([mac], {
      type: "continuation_failed",
      continuation,
      destination: mac,
    });

    expect(
      screen.getByTestId("agent-session-continuation-outcome-code"),
    ).toHaveAttribute("data-code", "CLI_OFFLINE");
    expect(
      screen.queryByTestId("agent-session-continuation-continue"),
    ).toBeNull();
    fireEvent.click(
      screen.getByTestId("agent-session-continuation-retry-delivery"),
    );
    await waitFor(() =>
      expect(commitAgentSessionContinuation).toHaveBeenCalledWith(
        expect.objectContaining({
          continuation,
          destination: mac,
          confirmSavedHistory: false,
        }),
      ),
    );
    expect(inspectAgentSessionContinuation).not.toHaveBeenCalled();
  });

  it("releases a failed attempt so the person can choose another computer", async () => {
    const mac = machine("Mac");
    const continuation = {
      ...inspected(mac, "NATIVE_RESUME", "attempt-3"),
      state: "FAILED",
      bindingMovedAt: "2026-11-16T00:00:01.000Z",
      deliveryGeneration: 1,
      outcomeCode: "PROVIDER_INVALID_CREDENTIAL",
    } as AgentSessionContinuationDto;
    renderCard([mac], {
      type: "continuation_failed",
      continuation,
      destination: mac,
    });

    fireEvent.click(screen.getByTestId("agent-session-continuation-release"));
    await waitFor(() =>
      expect(cancelAgentSessionContinuation).toHaveBeenCalledWith(
        expect.objectContaining({ continuationId: "attempt-3" }),
      ),
    );
    expect(commitAgentSessionContinuation).not.toHaveBeenCalled();
  });

  it("checks an uncertain attempt again on its own computer and offers no release", async () => {
    const mac = machine("Mac");
    const continuation = {
      ...inspected(mac, "NATIVE_RESUME", "attempt-4"),
      state: "UNCERTAIN",
      bindingMovedAt: "2026-11-16T00:00:01.000Z",
      deliveryGeneration: 1,
      outcomeCode: "STARTUP_ACKNOWLEDGEMENT_TIMEOUT",
    } as AgentSessionContinuationDto;
    renderCard([mac], {
      type: "continuation_uncertain",
      continuation,
      destination: mac,
    });

    expect(
      screen.queryByTestId("agent-session-continuation-release"),
    ).toBeNull();
    fireEvent.click(
      screen.getByTestId("agent-session-continuation-check-again"),
    );
    await waitFor(() =>
      expect(commitAgentSessionContinuation).toHaveBeenCalledWith(
        expect.objectContaining({ continuation, destination: mac }),
      ),
    );
    expect(cancelAgentSessionContinuation).not.toHaveBeenCalled();
  });

  it("retries an ambiguous step with the same continuation identity", async () => {
    const mac = machine("Mac");
    inspectAgentSessionContinuation
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockImplementation(async ({ continuationId }) =>
        inspected(mac, "NATIVE_RESUME", continuationId),
      );
    renderCard([mac]);

    fireEvent.click(screen.getByTestId("agent-session-continuation-continue"));
    const failure = await screen.findByTestId(
      "agent-session-continuation-failure",
    );
    expect(failure).toHaveAttribute("data-cause", "ambiguous");
    fireEvent.click(
      within(failure).getByTestId("agent-session-continuation-retry"),
    );

    await waitFor(() =>
      expect(commitAgentSessionContinuation).toHaveBeenCalledOnce(),
    );
    const [first, second] = inspectAgentSessionContinuation.mock.calls.map(
      ([call]) => call.continuationId,
    );
    expect(second).toBe(first);
  });
});
