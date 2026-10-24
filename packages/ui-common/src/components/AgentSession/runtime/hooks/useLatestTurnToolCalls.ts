import { useCallback, useEffect, useRef, useState } from "react";
import type { AxiosResponse } from "axios";
import {
  CliReadRunToolCallsLatestTurnRequestOperationEnum,
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
  type CliReadToolCallsLatestTurnAvailable,
  type ReadAgentSessionCliState200Response,
} from "../../../../api";
import { unifiedApiClient } from "../../../../clients/serviceClients";
import { useAgentSession } from "../../../../data/hooks/useAgentSession";
import { useControllerAuthorizedAction } from "../../../../data/hooks/useControllerAuthorizedAction";
import { useUserPairedMachines } from "../../../../data/hooks/useUserPairedMachines";
import {
  ControllerAuthorizationClientError,
  ControllerAuthorizationClientFailureCode,
} from "../../../../data/controllerAuthorization/webauthnAssertion";

export const LATEST_TURN_TOOL_CALLS_DEBOUNCE_MS = 1500;
export const LATEST_TURN_TOOL_CALLS_POLL_INTERVAL_MS = 2000;

const HALTING_CONTROLLER_FAILURE_CODES: readonly ControllerAuthorizationClientFailureCode[] =
  [
    ControllerAuthorizationClientFailureCode.InvalidCredential,
    ControllerAuthorizationClientFailureCode.UnsupportedWebAuthn,
    ControllerAuthorizationClientFailureCode.UserCancelled,
    ControllerAuthorizationClientFailureCode.ConfirmationDeclined,
  ];

export type LatestTurnToolCallsState =
  | { status: "idle" }
  | { status: "disabled" }
  | { status: "available"; result: CliReadToolCallsLatestTurnAvailable }
  | { status: "unavailable"; error: string };

const idleState: LatestTurnToolCallsState = { status: "idle" };

/**
 * Reads the active Turn's tool calls from the session's CLI. Tool calls are
 * transient telemetry: results live only in this hook's state (no query cache,
 * storage or logging) and vanish on unmount or refresh.
 *
 * While `enabled` (the Turn is active) the hook reads immediately and then on
 * a fixed interval; `activityKey` changes trigger an extra debounced read.
 * Every read is controller-authorized and may prompt, so at most one read is
 * in flight (ticks that land mid-read are skipped), and reading halts for the
 * rest of the Turn after a disabled result or a declined/cancelled
 * authorization. Each response is a whole snapshot and replaces the last.
 */
export const useLatestTurnToolCalls = (params: {
  organizationId: string;
  projectId: string;
  agentSessionId: string | undefined;
  activityKey: string;
  /** True while the Turn is active; reading stops when it turns false. */
  enabled: boolean;
}): LatestTurnToolCallsState => {
  const { organizationId, projectId, agentSessionId, activityKey, enabled } =
    params;
  const [state, setState] = useState<LatestTurnToolCallsState>(idleState);
  const inFlightRef = useRef(false);
  const haltedRef = useRef(false);
  const mountedRef = useRef(true);
  const active = enabled && agentSessionId !== undefined;

  const { agentSession } = useAgentSession(
    organizationId,
    projectId,
    agentSessionId ?? "",
    { enabled: active },
  );
  const { machines } = useUserPairedMachines();
  const { mutate: authorize } =
    useControllerAuthorizedAction<
      AxiosResponse<ReadAgentSessionCliState200Response>
    >();
  const machine = machines.find(
    (candidate) => candidate.machineId === agentSession?.machineId,
  );
  const machineId = machine?.machineId;
  const machineRef = useRef(machine);
  machineRef.current = machine;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const readNow = useCallback(() => {
    const currentMachine = machineRef.current;
    if (!agentSessionId || !currentMachine) return;
    if (haltedRef.current || inFlightRef.current) return;
    inFlightRef.current = true;
    // The run id is the agent session id (see useAgentRunLifecycle).
    const runId = agentSessionId;
    const controllerReadInputs = {
      operation:
        CliReadRunToolCallsLatestTurnRequestOperationEnum.RunToolCallsLatestTurn,
      runId,
    } as const;
    void authorize({
      cause: {
        operation:
          "read the current Turn's tool calls from the connected computer",
        purpose: "Show what the agent is doing in this coding session.",
      },
      organizationId,
      projectId,
      machine: currentMachine,
      action: {
        requestId: crypto.randomUUID(),
        actionCategory: HostActionCategory.CliRead,
        actionType: HostAffectingActionType.CliRead,
        targetKind: HostActionTargetKind.AgentSession,
        targetId: agentSessionId,
        inputs: {
          kind: "CLI_READ",
          body: {
            requestId: crypto.randomUUID(),
            agentSessionId: agentSessionId,
            ...controllerReadInputs,
          },
        },
      },
      submit: ({ authorization }) =>
        unifiedApiClient.readAgentSessionCliState({
          organizationId,
          projectId,
          agentSessionId,
          cliReadRequestDto: { ...controllerReadInputs, authorization },
        }),
    })
      .then((response): LatestTurnToolCallsState => {
        if (response.outcome === "DENIED") {
          if (!response.retryable) haltedRef.current = true;
          return {
            status: "unavailable",
            error: "The controller denied this protected read.",
          };
        }
        const result = response.data.data.data;
        if (!result || result.operation !== "run.tool_calls.latest_turn") {
          return {
            status: "unavailable",
            error: "The CLI returned a different read result.",
          };
        }
        if ("error" in result) {
          return { status: "unavailable", error: result.error.message };
        }
        if (result.result.state === "disabled") {
          haltedRef.current = true;
          return { status: "disabled" };
        }
        return { status: "available", result: result.result };
      })
      .catch((error: unknown): LatestTurnToolCallsState => {
        if (
          error instanceof ControllerAuthorizationClientError &&
          HALTING_CONTROLLER_FAILURE_CODES.includes(error.code)
        ) {
          haltedRef.current = true;
        }
        return {
          status: "unavailable",
          error:
            error instanceof Error ? error.message : "The CLI read failed.",
        };
      })
      .then((next) => {
        inFlightRef.current = false;
        if (!mountedRef.current) return;
        // Keep the last good list on a transient failure.
        setState((previous) =>
          next.status === "unavailable" && previous.status === "available"
            ? previous
            : next,
        );
      });
  }, [agentSessionId, authorize, organizationId, projectId]);

  // A new Turn starts from a clean slate and may read again.
  useEffect(() => {
    if (!active) return;
    haltedRef.current = false;
    setState(idleState);
    return () => {
      haltedRef.current = false;
    };
  }, [active, agentSessionId]);

  useEffect(() => {
    if (!active || !machineId) return;
    readNow();
    const interval = setInterval(
      readNow,
      LATEST_TURN_TOOL_CALLS_POLL_INTERVAL_MS,
    );
    return () => clearInterval(interval);
  }, [active, machineId, readNow]);

  const lastActivityKeyRef = useRef(activityKey);
  useEffect(() => {
    if (lastActivityKeyRef.current === activityKey) return;
    lastActivityKeyRef.current = activityKey;
    if (!active || !machineId) return;
    const timer = setTimeout(readNow, LATEST_TURN_TOOL_CALLS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [active, activityKey, machineId, readNow]);

  return state;
};
