import { useCallback, useRef, useState } from "react";
import { LocalRunBrowserOpenErrorCode } from "../../../../local-agent-api/generated/api";
import {
  createDirectoryBindingApi,
  LocalRunBrowserOpenError,
  resolveLocalDirectoryRuntimeBaseUrl,
} from "../directoryBindingApi";
import {
  useLocalCliForSession,
  type LocalCliForSessionState,
} from "./useLocalCliForSession";

const NOT_LOCAL_REASON =
  "Open browser works only from a browser on the same computer as this session's CLI.";

/** Why the CLI refused an open, for the codes every loopback Open browser shares. */
export const sharedBrowserOpenFailureReason = (
  code: string | null,
  notLocalReason: string,
): string | null => {
  if (code === LocalRunBrowserOpenErrorCode.SharedBrowserDisabled)
    return "The shared browser is turned off on this computer.";
  if (code === LocalRunBrowserOpenErrorCode.MachineMismatch)
    return notLocalReason;
  return null;
};

const runBrowserUnavailableReason = (
  localCli: LocalCliForSessionState,
  runId: string | null,
): string | null => {
  if (localCli.status === "unavailable") return NOT_LOCAL_REASON;
  if (localCli.status === "local" && !runId)
    return "Start this session before opening its browser.";
  return null;
};

const runBrowserFailureReason = (error: unknown): string => {
  if (error instanceof LocalRunBrowserOpenError) {
    const shared = sharedBrowserOpenFailureReason(error.code, NOT_LOCAL_REASON);
    if (shared) return shared;
    if (error.code === LocalRunBrowserOpenErrorCode.RunNotFound)
      return "The CLI on this computer does not know this session's Run.";
  }
  return error instanceof Error && error.message
    ? error.message
    : "The browser tab could not be opened.";
};

/**
 * The single path for opening a Run-owned tab in the Shared Browser: confirms
 * over loopback that the CLI is the session's machine, then asks it to open the
 * tab (at `url` when given, a blank tab otherwise).
 */
export const useRunBrowserOpener = (
  runId: string | null,
  sessionMachineId: string | null,
) => {
  const localCli = useLocalCliForSession(sessionMachineId);
  const [opening, setOpening] = useState(false);
  const [failure, setFailure] = useState<{
    reason: string;
    attempt: number;
  } | null>(null);
  const attemptRef = useRef(0);
  const blockedReason = runBrowserUnavailableReason(localCli, runId);

  const open = useCallback(
    async (url?: string): Promise<void> => {
      if (localCli.status !== "local" || !runId) return;
      const nextAttempt = ++attemptRef.current;
      setOpening(true);
      setFailure(null);
      try {
        await createDirectoryBindingApi(
          resolveLocalDirectoryRuntimeBaseUrl(),
        ).openRunBrowserTab(runId, { machineId: localCli.machineId, url });
      } catch (error) {
        setFailure({
          reason: runBrowserFailureReason(error),
          attempt: nextAttempt,
        });
      } finally {
        setOpening(false);
      }
    },
    [localCli, runId],
  );

  return { localCli, opening, failure, blockedReason, open };
};
