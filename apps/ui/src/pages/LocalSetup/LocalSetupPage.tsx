import type { LocalStartupBrowserRecord } from "@hey-hey/contracts/agent-bridge";
import { holdStartupDiagnosticTransport } from "./localStartupDiagnosticTransport";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiRuntime } from "@hey-hey/ui-common/clients";
import {
  recordLocalStartupDiagnostic,
  diagnosticFailureFacts,
} from "@hey-hey/ui-common/services";
import {
  BrandedCard,
  BrandedHeadline,
  BrandedPage,
  BrandedWordmark,
} from "@hey-hey/ui-common/components";
import type { LocalSetupStatusDto } from "@hey-hey/ui-common/api";
import { LocalPairingProgress } from "./LocalPairingProgress";
import {
  heldLocalPairing,
  holdLocalPairing,
  LOCAL_APPROVAL_SECRET_PATTERN,
  parseLocalCodingAgents,
} from "../Settings/localApproval";
import { LocalSetupDiagnostics } from "./LocalSetupDiagnostics";
import { LocalRepairPanel } from "./LocalRepairPanel";
import { useLocalReturningPasskey } from "./useLocalReturningPasskey";
import {
  describeFragment,
  describeNavigationType,
  recordLocalSetupEvent,
} from "./localSetupEvents";
import { LocalPairingClaim } from "../../localSetup/LocalPairingClaim";
import { loadDocument } from "../../localSetup/loadDocument";
import {
  openSetupSession,
  renewSetupSession,
  useSetupSession,
} from "../../localSetup/setupSession";
import "./LocalSetupPage.css";

let mountCount = 0;

/** The setup card is wider and roomier than the default branded card. */
const LOCAL_CARD_SX = {
  maxWidth: "31rem",
  padding: "clamp(1.25rem, 4vw, 2rem)",
} as const;

/** Pairing normally finishes in seconds; past this the person is told how to recover. */
const CONNECT_TIMEOUT_MS = 60_000;

const describeFailure = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure);

interface CliFragment {
  handoffToken: string | null;
  /** Which one-time values the URL carried, by length only. */
  description: string;
}

/** Reads the CLI's one-time fragment values; the pairing details are kept for remounts. */
const readCliFragment = (): CliFragment => {
  holdStartupDiagnosticTransport(window.location.hash);
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const code = fragment.get("code");
  const approval = fragment.get("approval");
  // No approval value means the CLI will confirm this pairing in the terminal.
  if (
    code &&
    (approval === null || LOCAL_APPROVAL_SECRET_PATTERN.test(approval))
  ) {
    holdLocalPairing({
      code,
      approvalSecret: approval,
      agents: parseLocalCodingAgents(fragment.get("agents")),
    });
  }

  return {
    handoffToken: fragment.get("handoff"),
    description: describeFragment(window.location.hash),
  };
};

const clearAddressBarFragment = (): void => {
  if (!window.location.hash) {
    return;
  }
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
};

/** Where a connected installation continues: unfinished setup first, then the workspace. */
const destinationAfterConnecting = (status: LocalSetupStatusDto): string => {
  if (status.setupProjectId) {
    return `/welcome?projectId=${encodeURIComponent(status.setupProjectId)}`;
  }

  return status.hasProjects ? "/home" : "/welcome";
};

const describeView = ({
  step,
  status,
  pairingStarted,
  pairing,
}: {
  step: "loading" | "name" | "error";
  status: LocalSetupStatusDto | null;
  pairingStarted: boolean;
  pairing: unknown;
}): NonNullable<NonNullable<LocalStartupBrowserRecord["facts"]>["view"]> => {
  if (step === "error") return "error";
  if (step === "loading" || !status) return "loading";
  if (status.nameComplete && status.machineConnected) return "continuing";
  if (!status.nameComplete) return "name";
  if (pairingStarted && pairing) return "passkey-step";
  if (pairingStarted) return "missing-pairing-details";

  return "waiting-for-cli";
};

/** Where setup sends a browser whose session is gone: local passkey sign-in, then back here. */
const LOGIN_FOR_SETUP = (returnTo: string): string =>
  `/login?returnTo=${encodeURIComponent(returnTo)}`;

/** Local first-time setup: name, passkey, then the CLI's confirmation, in that order. */
export function LocalSetupPage(): React.JSX.Element {
  const { t } = useTranslation();
  const session = useSetupSession();
  const [status, setStatus] = useState<LocalSetupStatusDto | null>(null);
  const [name, setName] = useState("");
  const [step, setStep] = useState<"loading" | "name" | "error">("loading");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [cliFragment] = useState(readCliFragment);
  const [opening, setOpening] = useState(true);
  const lastStatus = useRef<string | null>(null);
  const leaving = useRef(false);
  const refreshStatusNow = useRef<() => Promise<void>>(() => Promise.resolve());
  const [passkeyCreated, setPasskeyCreated] = useState(false);
  const passkeyCreatedRef = useRef(false);
  const [enrollmentId, setEnrollmentId] = useState<string>();
  const handlePasskeyCreated = useCallback((id: string) => {
    recordLocalStartupDiagnostic("passkey_registration_succeeded");
    setEnrollmentId(id);
    passkeyCreatedRef.current = true;
    setPasskeyCreated(true);
  }, []);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const [connectAttempt, setConnectAttempt] = useState(0);
  const hasSession = session !== null;

  useEffect(() => {
    recordLocalStartupDiagnostic("auth_state", {
      authenticated: hasSession,
      loading: opening,
      handoffPending: opening && cliFragment.handoffToken !== null,
    });
  }, [hasSession, opening, cliFragment]);

  const pairingStarted =
    new URLSearchParams(window.location.search).get("pairing") === "started";
  const pairing = heldLocalPairing();
  const hasPairingHandoff = pairingStarted && pairing !== null;
  const confirmAtTerminal = pairing !== null && pairing.approvalSecret === null;
  const returningPasskey = useLocalReturningPasskey(
    pairingStarted && pairing !== null && hasSession,
  );

  useEffect(() => {
    if (
      !passkeyCreated ||
      status?.pairingState === "REJECTED" ||
      status?.pairingState === "EXPIRED" ||
      status?.pairingState === "UNAVAILABLE"
    ) {
      return;
    }

    const timer = window.setTimeout(
      () => {
        recordLocalSetupEvent("connect: timed out waiting for the CLI");
        setConnectionFailed(true);
      },
      confirmAtTerminal && status?.pairingState !== "ACTIVE"
        ? 5 * 60_000
        : CONNECT_TIMEOUT_MS,
    );

    return () => window.clearTimeout(timer);
  }, [passkeyCreated, confirmAtTerminal, connectAttempt, status?.pairingState]);

  const handleRetry = () => {
    setConnectionFailed(false);
    setConnectAttempt((attempt) => attempt + 1);
    void refreshStatusNow.current();
  };

  useEffect(() => {
    mountCount += 1;
    const mountNumber = mountCount;
    recordLocalSetupEvent(
      `mounted #${String(mountNumber)} ${window.location.pathname}${window.location.search} fragment[${cliFragment.description}] navigation=${describeNavigationType()} history=${String(window.history.length)} pairing-held=${String(heldLocalPairing() !== null)}`,
    );

    return () => {
      recordLocalSetupEvent(`unmounted #${String(mountNumber)}`);
    };
  }, [cliFragment]);

  useEffect(() => {
    clearAddressBarFragment();
    const { handoffToken } = cliFragment;
    if (!handoffToken) {
      recordLocalSetupEvent("handoff: no token in the address");
    }

    let active = true;
    openSetupSession(handoffToken)
      .then(() => {
        if (active) setOpening(false);
      })
      .catch((failure: unknown) => {
        if (!active) return;
        if (!handoffToken) {
          // No handoff and no usable cookie: sign in with the passkey, then return here.
          recordLocalStartupDiagnostic("setup_redirect", {
            destination: "login",
            reason: "unauthenticated",
          });
          leaving.current = true;
          loadDocument(
            LOGIN_FOR_SETUP(
              `${window.location.pathname}${window.location.search}`,
            ),
          );
          return;
        }
        recordLocalSetupEvent(
          `handoff: failed (${describeFailure(failure)})`,
          diagnosticFailureFacts(failure),
        );
        setError("Run heyhey local again to restore access to this computer.");
        setStep("error");
        setOpening(false);
      });

    return () => {
      active = false;
    };
  }, [cliFragment]);

  useEffect(() => {
    if (!hasSession || opening) {
      return;
    }

    let active = true;
    const refreshStatus = async () => {
      if (leaving.current) return;
      try {
        const response = await getApiRuntime().clients.auth.getLocalSetupStatus(
          { enrollmentId },
        );
        if (!active || leaving.current) return;
        const nextStatus = response.data.data;
        const statusSummary = `name-saved=${String(nextStatus.nameComplete)} cli-connected=${String(nextStatus.machineConnected)} pairing=${nextStatus.pairingState ?? "none"} has-projects=${String(nextStatus.hasProjects)} setup-unfinished=${String(nextStatus.setupProjectId !== null)}`;
        if (statusSummary !== lastStatus.current) {
          lastStatus.current = statusSummary;
          recordLocalSetupEvent(`status: ${statusSummary}`);
          recordLocalStartupDiagnostic("setup_status", {
            nameSaved: nextStatus.nameComplete,
            machineConnected: nextStatus.machineConnected,
            hasProjects: nextStatus.hasProjects,
            setupUnfinished: nextStatus.setupProjectId !== null,
          });
        }
        setStatus(nextStatus);
        setStep((currentStep) =>
          currentStep === "loading" ? "name" : currentStep,
        );
        // Move on only once the connection is real. The main app starts fresh
        // from here with this session's cookie, keeps the terms gate, then
        // first-project setup resumes the saved project.
        if (
          nextStatus.nameComplete &&
          nextStatus.machineConnected &&
          (!hasPairingHandoff || enrollmentId !== undefined)
        ) {
          recordLocalStartupDiagnostic("setup_redirect", {
            destination:
              nextStatus.setupProjectId || !nextStatus.hasProjects
                ? "welcome"
                : "home",
            reason: "connected",
          });
          leaving.current = true;
          loadDocument(destinationAfterConnecting(nextStatus));
        }
      } catch (failure: unknown) {
        if (active && passkeyCreatedRef.current) {
          recordLocalSetupEvent(
            `status: failed (${describeFailure(failure)})`,
            diagnosticFailureFacts(failure),
          );
          setConnectionFailed(true);
        } else if (active) {
          recordLocalSetupEvent(
            `status: failed (${describeFailure(failure)})`,
            diagnosticFailureFacts(failure),
          );
          setError(
            "Local account status is unavailable. Run heyhey local and retry.",
          );
          setStep("error");
        }
      }
    };

    refreshStatusNow.current = refreshStatus;
    void refreshStatus();
    const interval = window.setInterval(() => void refreshStatus(), 2000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [hasSession, opening, enrollmentId, hasPairingHandoff]);

  const saveName = async () => {
    const displayName = name.trim();
    if (!displayName || saving) return;

    setSaving(true);
    setError("");
    recordLocalSetupEvent("name: saving");
    try {
      const response = await getApiRuntime().clients.auth.saveLocalDisplayName({
        localNameRequestDto: { name: displayName },
      });
      // The one renewal during setup, in sequence, so pairing shows the saved name.
      await renewSetupSession();
      setStatus(response.data.data);
      setStep("name");
      recordLocalSetupEvent("name: saved and session refreshed");
    } catch (failure: unknown) {
      recordLocalSetupEvent(
        `name: failed (${describeFailure(failure)})`,
        diagnosticFailureFacts(failure),
      );
      setError("We couldn't save your name. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const view = describeView({ step, status, pairingStarted, pairing });
  useEffect(() => {
    recordLocalSetupEvent(`view: ${view}`);
    recordLocalStartupDiagnostic("setup_view", { view });
  }, [view]);

  if (step === "error") {
    return (
      <BrandedPage className="local-setup">
        <BrandedWordmark>HEY HEY</BrandedWordmark>
        <BrandedHeadline>LOCAL SETUP NEEDS ATTENTION</BrandedHeadline>
        <p role="alert">{error}</p>
        <LocalSetupDiagnostics />
      </BrandedPage>
    );
  }

  if (opening || !session || step === "loading" || !status) {
    return (
      <BrandedPage className="local-setup" aria-live="polite">
        <BrandedWordmark>HEY HEY</BrandedWordmark>
        <p>Opening your local workspace…</p>
      </BrandedPage>
    );
  }

  if (
    status.nameComplete &&
    ((!hasPairingHandoff && status.machineConnected) || passkeyCreated)
  ) {
    return (
      <BrandedPage className="local-setup">
        <BrandedWordmark>HEY HEY</BrandedWordmark>
        <BrandedHeadline>{t("localSetup.progress.title")}</BrandedHeadline>
        <BrandedCard className="local-setup__card" sx={LOCAL_CARD_SX}>
          <LocalPairingProgress
            failed={connectionFailed}
            pairingState={status.pairingState}
            onRetry={handleRetry}
            confirmAtTerminal={
              confirmAtTerminal &&
              !status.machineConnected &&
              status.pairingState !== "ACTIVE"
            }
          />
        </BrandedCard>
      </BrandedPage>
    );
  }

  if (!status.nameComplete) {
    return (
      <BrandedPage className="local-setup">
        <BrandedWordmark>HEY HEY</BrandedWordmark>
        <BrandedHeadline>WHAT SHOULD WE CALL YOU?</BrandedHeadline>
        <BrandedCard className="local-setup__card" sx={LOCAL_CARD_SX}>
          <label htmlFor="local-display-name">Name</label>
          <input
            id="local-display-name"
            autoComplete="name"
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          {error && <p role="alert">{error}</p>}
          <button
            disabled={!name.trim() || saving}
            onClick={() => void saveName()}
          >
            {saving ? "Saving…" : "Continue"}
          </button>
        </BrandedCard>
      </BrandedPage>
    );
  }

  return (
    <BrandedPage className="local-setup">
      <BrandedWordmark>HEY HEY</BrandedWordmark>
      {pairingStarted && pairing ? (
        <header>
          <p className="local-setup__eyebrow">
            {t("localSetup.pairing.eyebrow")}
          </p>
          <BrandedHeadline
            line={
              returningPasskey.returning
                ? t("localSetup.pairing.returning.purpose")
                : returningPasskey.repaired
                  ? t("localSetup.repair.completed")
                  : t("localSetup.pairing.purpose")
            }
          >
            {returningPasskey.returning
              ? t("localSetup.pairing.returning.title")
              : t("localSetup.pairing.title")}
          </BrandedHeadline>
        </header>
      ) : null}
      <BrandedCard className="local-setup__card" sx={LOCAL_CARD_SX}>
        {pairingStarted && pairing ? (
          <LocalPairingClaim
            code={pairing.code}
            approvalSecret={pairing.approvalSecret}
            agents={pairing.agents}
            user={session.user}
            returning={returningPasskey.returning}
            onPasskeyCreated={handlePasskeyCreated}
            onPasskeyUnavailable={returningPasskey.offerRepair}
            onAccountProofRequired={returningPasskey.requireExistingPasskey}
            repair={
              returningPasskey.returning &&
              returningPasskey.repair !== "none" ? (
                <LocalRepairPanel
                  view={returningPasskey.repair}
                  error={returningPasskey.repairError}
                  onRepair={() => void returningPasskey.requestRepair()}
                />
              ) : null
            }
          />
        ) : pairingStarted ? (
          <>
            <p role="alert">
              This page did not receive its pairing details. Run heyhey local
              again.
            </p>
            <LocalSetupDiagnostics />
          </>
        ) : (
          <p>Waiting for the local CLI to connect to Hey Hey…</p>
        )}
      </BrandedCard>
    </BrandedPage>
  );
}
