import { RunToolCallsLatestTurnApi } from "../../../../local-agent-api/generated/api";
import { Configuration } from "../../../../local-agent-api/generated/configuration";
import { resolveLocalDirectoryRuntimeBaseUrl } from "../directoryBindingApi";
import { useLocalCliForSession } from "./useLocalCliForSession";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { isAxiosError, type AxiosResponse } from "axios";
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
 * Remote reads are controller-authorized; verified local reads use loopback. At most one read is
 * in flight (ticks that land mid-read are skipped), and reading halts for the
 * rest of the Turn after a disabled result or a declined/cancelled
 * authorization. Each response is a whole snapshot and replaces the last.
 */
export const useLatestTurnToolCalls = (params: {
  organizationId: string;
  projectId: string;
  agentSessionId: string | undefined;
  activityKey: string;
  /**
   * True once the Turn is running; reading stops when it turns false. Must be
   * false while the Turn is still starting, since the CLI's latest Turn is then
   * the previous one.
   */
  enabled: boolean;
}): LatestTurnToolCallsState => {
  const { organizationId, projectId, agentSessionId, activityKey, enabled } =
    params;
  const [state, setState] = useState<LatestTurnToolCallsState>(idleState);
  const inFlightRef = useRef(false);
  const haltedRef = useRef(false);
  const generationRef = useRef(0);
  const previousSessionRef = useRef(agentSessionId);
  const previousActiveRef = useRef(false);
  const mountedRef = useRef(true);
  const active = enabled && agentSessionId !== undefined;

  const { agentSession } = useAgentSession(
    organizationId,
    projectId,
    agentSessionId ?? "",
    { enabled: active },
  );
  const localCli = useLocalCliForSession(
    active ? (agentSession?.machineId ?? null) : null,
  );
  const localCliRef = useRef(localCli);
  localCliRef.current = localCli;
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
    const local = localCliRef.current;
    if (
      !agentSessionId ||
      !currentMachine ||
      local.status === "checking" ||
      (local.status === "unavailable" && local.reason === "no-session-machine")
    )
      return;
    if (
      (local.status === "unavailable" && local.reason !== "cli-unreachable") ||
      (local.status === "local" && local.machineId !== currentMachine.machineId)
    ) {
      haltedRef.current = true;
      setState({
        status: "unavailable",
        error: "The local CLI machine identity does not match the Run owner.",
      });
      return;
    }
    if (haltedRef.current || inFlightRef.current) return;
    inFlightRef.current = true;
    const generation = generationRef.current;
    const isCurrent = () =>
      mountedRef.current && generation === generationRef.current;
    // The run id is the agent session id (see useAgentRunLifecycle).
    const runId = agentSessionId;
    const controllerReadInputs = {
      operation:
        CliReadRunToolCallsLatestTurnRequestOperationEnum.RunToolCallsLatestTurn,
      runId,
    } as const;
    const readRemote = () =>
      authorize({
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
      });
    const readResult = async () => {
      if (local.status === "local") {
        const api = new RunToolCallsLatestTurnApi(
          new Configuration({
            basePath: `${resolveLocalDirectoryRuntimeBaseUrl()}/api/local`,
          }),
        );
        try {
          const response = await api.readLocalRunToolCallsLatestTurn({
            runId,
            localRunToolCallsLatestTurnRequest: { machineId: local.machineId },
          });
          return response.data;
        } catch (error) {
          if (isCurrent()) {
            if (isAxiosError(error) && !error.response) {
              // Keep the selected local transport across a network interruption.
              setState(idleState);
            } else {
              haltedRef.current = true;
            }
          }
          throw new Error("The local tool-call read failed.");
        }
      }
      const response = await readRemote();
      if (response.outcome === "DENIED") {
        if (isCurrent() && !response.retryable) haltedRef.current = true;
        throw new Error("The controller denied this protected read.");
      }
      return response.data.data.data;
    };
    void readResult()
      .then((result): LatestTurnToolCallsState => {
        if (!isCurrent()) return idleState;
        if (!result || result.operation !== "run.tool_calls.latest_turn") {
          haltedRef.current = true;
          return {
            status: "unavailable",
            error: "The CLI returned a different read result.",
          };
        }
        if ("error" in result) {
          haltedRef.current = true;
          return { status: "unavailable", error: result.error.message };
        }
        if (result.result.runId !== runId) {
          haltedRef.current = true;
          return {
            status: "unavailable",
            error: "The CLI returned a different Run.",
          };
        }
        if (result.result.state === "disabled") {
          haltedRef.current = true;
          return { status: "disabled" };
        }
        return { status: "available", result: result.result };
      })
      .catch((error: unknown): LatestTurnToolCallsState => {
        if (!isCurrent()) return idleState;
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
        if (!isCurrent()) return;
        // Keep the last good list on a transient failure.
        setState((previous) =>
          next.status === "unavailable" &&
          !haltedRef.current &&
          previous.status === "available"
            ? previous
            : next,
        );
      });
  }, [agentSessionId, authorize, organizationId, projectId]);

  // Clear both consumers before paint and invalidate outstanding reads when the
  // Turn becomes active or the session changes, so a snapshot requested for an
  // earlier Turn can never land in this one.
  useLayoutEffect(() => {
    generationRef.current += 1;
    const sessionChanged = previousSessionRef.current !== agentSessionId;
    const becameActive = active && !previousActiveRef.current;
    previousSessionRef.current = agentSessionId;
    previousActiveRef.current = active;
    if (sessionChanged || becameActive || !active) {
      haltedRef.current = false;
      setState(idleState);
    }
    return () => {
      generationRef.current += 1;
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
  }, [active, machineId, localCli.status, readNow]);

  // Reconnecting must reread transient content; never keep a pre-reconnect snapshot.
  useEffect(() => {
    const clear = () => {
      generationRef.current += 1;
      setState(idleState);
    };
    const reconnect = () => {
      clear();
      if (active && !haltedRef.current) readNow();
    };
    window.addEventListener("offline", clear);
    window.addEventListener("online", reconnect);
    return () => {
      window.removeEventListener("offline", clear);
      window.removeEventListener("online", reconnect);
    };
  }, [active, readNow]);

  useLayoutEffect(() => {
    generationRef.current += 1;
    setState(idleState);
  }, [machine?.active]);

  const lastActivityKeyRef = useRef(activityKey);
  useEffect(() => {
    if (lastActivityKeyRef.current === activityKey) return;
    lastActivityKeyRef.current = activityKey;
    if (!active || !machineId) return;
    const timer = setTimeout(readNow, LATEST_TURN_TOOL_CALLS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [active, activityKey, machineId, readNow]);

  return active ? state : idleState;
};
