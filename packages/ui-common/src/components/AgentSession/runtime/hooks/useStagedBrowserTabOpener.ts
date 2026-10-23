import { useCallback, useRef, useState } from "react";
import type { StagedBrowserTabReference } from "../../../../local-agent-api/generated/api";
import {
  createDirectoryBindingApi,
  LocalStagedBrowserTabOpenError,
  resolveLocalDirectoryRuntimeBaseUrl,
} from "../directoryBindingApi";
import { useLocalCliForSession } from "./useLocalCliForSession";
import { sharedBrowserOpenFailureReason } from "./useRunBrowserOpener";

const NOT_LOCAL_REASON =
  "Open browser works only from a browser on the same computer as the selected CLI machine.";

const stagedOpenFailureReason = (error: unknown): string =>
  (error instanceof LocalStagedBrowserTabOpenError
    ? sharedBrowserOpenFailureReason(error.code, NOT_LOCAL_REASON)
    : null) ??
  (error instanceof Error && error.message
    ? error.message
    : "The browser tab could not be opened.");

interface StagedTab {
  scopeKey: string;
  machineId: string;
  reference: StagedBrowserTabReference;
}

/**
 * Opens a Shared Browser tab before the session exists, on the selected
 * machine only when loopback confirms it is this computer's CLI, and holds
 * the reference the start request carries. A new scope (modal closed) or
 * another machine drops the reference; the tab itself stays open.
 */
export const useStagedBrowserTabOpener = (
  machineId: string | null,
  projectId: string | null,
  scopeKey: string,
) => {
  const localCli = useLocalCliForSession(machineId);
  const [staged, setStaged] = useState<StagedTab | null>(null);
  const [opening, setOpening] = useState(false);
  const [failure, setFailure] = useState<{
    reason: string;
    attempt: number;
  } | null>(null);
  const attemptRef = useRef(0);
  const blockedReason =
    localCli.status === "unavailable"
      ? NOT_LOCAL_REASON
      : localCli.status === "local" && !projectId
        ? "Open browser needs a project."
        : null;
  const stagedBrowserTab =
    staged && staged.scopeKey === scopeKey && staged.machineId === machineId
      ? staged.reference
      : null;

  const open = useCallback(async (): Promise<void> => {
    if (localCli.status !== "local" || !projectId) return;
    const nextAttempt = ++attemptRef.current;
    setOpening(true);
    setFailure(null);
    try {
      const { stagedBrowserTab: reference } = await createDirectoryBindingApi(
        resolveLocalDirectoryRuntimeBaseUrl(),
      ).openStagedBrowserTab({ machineId: localCli.machineId, projectId });
      setStaged({ scopeKey, machineId: localCli.machineId, reference });
    } catch (error) {
      setFailure({
        reason: stagedOpenFailureReason(error),
        attempt: nextAttempt,
      });
    } finally {
      setOpening(false);
    }
  }, [localCli, projectId, scopeKey]);

  /** Forgets a reference an accepted start has handed to its session. */
  const clearSubmitted = useCallback(
    (submitted: StagedBrowserTabReference | null) => {
      if (!submitted) return;
      setStaged((current) =>
        current?.reference.stagedTabId === submitted.stagedTabId
          ? null
          : current,
      );
    },
    [],
  );

  return {
    localCli,
    opening,
    failure,
    blockedReason,
    stagedBrowserTab,
    open,
    clearSubmitted,
  };
};
