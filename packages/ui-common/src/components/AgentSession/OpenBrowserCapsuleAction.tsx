import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser";
import { useCallback, useMemo } from "react";
import { CapsuleAction } from "../ActionsCapsule/CapsuleAction";
import type { CapsuleActionUnavailableFeedback } from "../ActionsCapsule/types";
import { useRunBrowserOpener } from "./runtime/hooks/useRunBrowserOpener";

export interface OpenBrowserCapsuleActionProps {
  /** The CLI Run the tab is opened for. */
  runId: string | null;
  /** The paired machine that owns the session's Run. */
  sessionMachineId: string | null;
  order: number;
}

/**
 * Opens a Run-owned tab in the Shared Browser. The call is same-machine
 * loopback only, so the action is disabled unless the reachable CLI is the
 * session's owning machine.
 */
export const OpenBrowserCapsuleAction: React.FC<
  OpenBrowserCapsuleActionProps
> = ({ runId, sessionMachineId, order }) => {
  const { localCli, opening, failure, blockedReason, open } =
    useRunBrowserOpener(runId, sessionMachineId);
  const handleOpen = useCallback(() => void open(), [open]);

  // The capsule shows feedback as the button's tooltip, which explains a disabled button too.
  const feedback = useMemo<CapsuleActionUnavailableFeedback | undefined>(
    () =>
      blockedReason !== null
        ? {
            status: "unavailable",
            presentationScope: "action",
            reason: blockedReason,
            errorCode: null,
            retryable: false,
            failureIdentity: { reason: blockedReason },
            retry: () => undefined,
            isRetrying: false,
          }
        : failure
        ? {
            status: "unavailable",
            presentationScope: "action",
            reason: failure.reason,
            errorCode: null,
            retryable: true,
            failureIdentity: {
              reason: `open-browser:${String(failure.attempt)}`,
            },
            retry: handleOpen,
            isRetrying: opening,
          }
        : undefined,
    [blockedReason, failure, handleOpen, opening]
  );

  return (
    <CapsuleAction
      behavior="click"
      id="open-browser"
      label="Browser"
      icon={OpenInBrowserIcon}
      disabled={blockedReason !== null || localCli.status === "checking"}
      inProgress={opening}
      feedback={feedback}
      onClick={handleOpen}
      actionGroup="page"
      tier="page"
      order={order}
    />
  );
};
