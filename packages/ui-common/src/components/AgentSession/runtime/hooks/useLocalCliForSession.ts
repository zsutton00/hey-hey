import { useEffect, useState } from "react";
import {
  createDirectoryBindingApi,
  resolveLocalDirectoryRuntimeBaseUrl,
} from "../directoryBindingApi";

export type LocalCliForSessionState =
  | { status: "checking" }
  | { status: "local"; machineId: string }
  | {
      status: "unavailable";
      reason: "no-session-machine" | "cli-unreachable" | "different-machine";
    };

/**
 * Confirms over loopback that the CLI reachable from this browser is the
 * session's owning machine. There is no platform relay fallback: same-machine
 * actions are simply unavailable when the check fails.
 */
export const useLocalCliForSession = (
  sessionMachineId: string | null,
): LocalCliForSessionState => {
  const [scoped, setScoped] = useState<{
    machineId: string | null;
    state: LocalCliForSessionState;
  }>({ machineId: sessionMachineId, state: { status: "checking" } });

  useEffect(() => {
    const setState = (state: LocalCliForSessionState) =>
      setScoped({ machineId: sessionMachineId, state });
    if (!sessionMachineId) {
      setState({ status: "unavailable", reason: "no-session-machine" });
      return;
    }
    let cancelled = false;
    setState({ status: "checking" });
    const localApi = createDirectoryBindingApi(
      resolveLocalDirectoryRuntimeBaseUrl(),
    );
    localApi.listRepos().then(
      ({ machineId }) => {
        if (cancelled) return;
        setState(
          machineId === sessionMachineId
            ? { status: "local", machineId }
            : { status: "unavailable", reason: "different-machine" },
        );
      },
      () => {
        if (!cancelled)
          setState({ status: "unavailable", reason: "cli-unreachable" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sessionMachineId]);

  // A newly addressed Run must never use the preceding Run's discovery result.
  return scoped.machineId === sessionMachineId
    ? scoped.state
    : { status: "checking" };
};
