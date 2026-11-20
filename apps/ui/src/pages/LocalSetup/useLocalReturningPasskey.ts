import { useCallback, useEffect, useState } from "react";
import { LocalPasskeyRepairState } from "@hey-hey/ui-common/api";
import { getApiRuntime } from "@hey-hey/ui-common/clients";
import {
  listAccountPasskeys,
  recordLocalStartupDiagnostic,
  diagnosticFailureFacts,
} from "@hey-hey/ui-common/services";
import { getErrorMessage } from "@hey-hey/ui-common/utils";
import { recordLocalSetupEvent } from "./localSetupEvents";

const REPAIR_POLL_MS = 2_000;

/** What the Repair panel shows; "none" until the existing passkey proves unusable. */
export type LocalRepairView = "none" | "offered" | "requested" | "declined";

export interface LocalReturningPasskey {
  /** The account already has a passkey, so pairing proves with it. */
  returning: boolean;
  /** A Repair just revoked the old passkeys; the next passkey is a new first one. */
  repaired: boolean;
  repair: LocalRepairView;
  /** Why the last Repair request was refused, in the API's own words. */
  repairError: string | null;
  /** The existing passkey could not be produced in this browser. */
  offerRepair: () => void;
  /** The API refused a proofless passkey: the account does have one. */
  requireExistingPasskey: () => void;
  requestRepair: () => Promise<void>;
}

const describeFailure = (failure: unknown): string =>
  getErrorMessage(failure, "Unknown local setup failure");

/**
 * Local setup on a computer that was set up before. The account's live
 * passkeys decide the path: none means a first passkey, otherwise the person
 * proves with the existing one. When that passkey can't be used here, Repair
 * is asked for and the terminal confirms it; this follows the answer.
 */
export function useLocalReturningPasskey(
  enabled: boolean,
): LocalReturningPasskey {
  const [returning, setReturning] = useState(false);
  const [repaired, setRepaired] = useState(false);
  const [repair, setRepair] = useState<LocalRepairView>("none");
  const [repairError, setRepairError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let active = true;
    listAccountPasskeys()
      .then((passkeys) => {
        if (!active) return;
        recordLocalSetupEvent(
          `passkeys: account has ${String(passkeys.length)}`,
        );
        recordLocalStartupDiagnostic("passkey_inventory", {
          passkeyCount: passkeys.length,
        });
        setReturning(passkeys.length > 0);
      })
      .catch((failure: unknown) => {
        // Not fatal: a proofless attempt is refused with its real cause, which
        // switches this page to the existing-passkey path.
        recordLocalSetupEvent(
          `passkeys: list failed (${describeFailure(failure)})`,
          diagnosticFailureFacts(failure),
        );
      });

    return () => {
      active = false;
    };
  }, [enabled]);

  useEffect(() => {
    if (repair !== "requested") {
      return;
    }

    let active = true;
    const follow = async () => {
      try {
        const response =
          await getApiRuntime().clients.auth.getLocalPasskeyRepair();
        if (!active) return;
        setRepairError(null);
        const { state } = response.data.data;
        if (state === LocalPasskeyRepairState.Requested) {
          return;
        }

        recordLocalSetupEvent(`repair: ${state}`);
        if (state === LocalPasskeyRepairState.Completed) {
          setReturning(false);
          setRepaired(true);
          setRepair("none");
          return;
        }

        // Declined at the terminal, or the request lapsed unanswered.
        setRepair(
          state === LocalPasskeyRepairState.Declined ? "declined" : "offered",
        );
      } catch (failure: unknown) {
        if (!active) {
          return;
        }
        recordLocalSetupEvent(
          `repair: status failed (${describeFailure(failure)})`,
          diagnosticFailureFacts(failure),
        );
        setRepairError(
          getErrorMessage(
            failure,
            "We couldn't check the repair. Keep heyhey local running; this page will check again.",
          ),
        );
      }
    };

    const interval = window.setInterval(() => void follow(), REPAIR_POLL_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [repair]);

  const offerRepair = useCallback(() => {
    recordLocalSetupEvent("repair: offered, existing passkey unavailable");
    setRepair((current) => (current === "none" ? "offered" : current));
  }, []);

  const requireExistingPasskey = useCallback(() => {
    recordLocalSetupEvent("passkeys: API requires the existing passkey");
    setReturning(true);
  }, []);

  const requestRepair = useCallback(async () => {
    setRepairError(null);
    try {
      await getApiRuntime().clients.auth.requestLocalPasskeyRepair();
      recordLocalSetupEvent("repair: requested");
      setRepair("requested");
    } catch (failure: unknown) {
      recordLocalSetupEvent(
        `repair: request failed (${describeFailure(failure)})`,
        diagnosticFailureFacts(failure),
      );
      setRepairError(
        getErrorMessage(
          failure,
          "Repair couldn't be started. Run heyhey local again.",
        ),
      );
    }
  }, []);

  return {
    returning,
    repaired,
    repair,
    repairError,
    offerRepair,
    requireExistingPasskey,
    requestRepair,
  };
}
