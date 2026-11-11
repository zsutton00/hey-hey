import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { getApiRuntime } from "@hey-hey/ui-common/clients";
import {
  acceptBrowserAuthSession,
  refreshAuthToken,
} from "@hey-hey/ui-common/services";
import { useAuth } from "@hey-hey/ui-common/context";
import type { LocalSetupStatusDto } from "@hey-hey/ui-common/api";
import { ClaimMachine } from "../Settings/ClaimMachine";
import { LocalPairingProgress } from "./LocalPairingProgress";
import {
  heldLocalPairing,
  holdLocalPairing,
  LOCAL_APPROVAL_SECRET_PATTERN,
  parseLocalCodingAgents,
} from "../Settings/localApproval";
import { LocalSetupDiagnostics } from "./LocalSetupDiagnostics";
import {
  describeFragment,
  describeNavigationType,
  recordLocalSetupEvent,
} from "./localSetupEvents";
import "./LocalSetupPage.css";

let mountCount = 0;

/** Pairing normally finishes in seconds; past this the person is told how to recover. */
const CONNECT_TIMEOUT_MS = 60_000;

const describeFailure = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure);

type HandoffExchange = ReturnType<
  ReturnType<typeof getApiRuntime>["clients"]["auth"]["completeLocalHandoff"]
>;

const handoffExchanges = new Map<string, HandoffExchange>();

/**
 * The handoff token is single-use, and a remount (React StrictMode in development) runs the
 * exchange effect again with the same token. Every mount shares the one request per token.
 */
const exchangeHandoffToken = (handoffToken: string): HandoffExchange => {
  const inFlight = handoffExchanges.get(handoffToken);
  if (inFlight) {
    return inFlight;
  }

  const exchange = getApiRuntime().clients.auth.completeLocalHandoff({
    localHandoffRequestDto: { handoffToken },
  });
  handoffExchanges.set(handoffToken, exchange);
  const forget = () => handoffExchanges.delete(handoffToken);
  exchange.then(forget, forget);

  return exchange;
};

interface CliFragment {
  handoffToken: string | null;
  /** Which one-time values the URL carried, by length only. */
  description: string;
}

/** Reads the CLI's one-time fragment values; the pairing details are kept for remounts. */
const readCliFragment = (): CliFragment => {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const code = fragment.get("code");
  const approval = fragment.get("approval");
  if (
    code &&
    approval !== null &&
    LOCAL_APPROVAL_SECRET_PATTERN.test(approval)
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
}): string => {
  if (step === "error") return "error";
  if (step === "loading" || !status) return "loading";
  if (status.nameComplete && status.machineConnected) return "continuing";
  if (!status.nameComplete) return "name";
  if (pairingStarted && pairing) return "passkey-step";
  if (pairingStarted) return "missing-pairing-details";

  return "waiting-for-cli";
};

export function LocalSetupPage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const location = useLocation();
  const [status, setStatus] = useState<LocalSetupStatusDto | null>(null);
  const [name, setName] = useState("");
  const [step, setStep] = useState<"loading" | "name" | "error">("loading");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lastStatus = useRef<string | null>(null);
  const refreshStatusNow = useRef<() => Promise<void>>(() => Promise.resolve());
  const [passkeyCreated, setPasskeyCreated] = useState(false);
  const passkeyCreatedRef = useRef(false);
  const handlePasskeyCreated = useCallback(() => {
    passkeyCreatedRef.current = true;
    setPasskeyCreated(true);
  }, []);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const [connectAttempt, setConnectAttempt] = useState(0);

  useEffect(() => {
    if (!passkeyCreated) {
      return;
    }

    const timer = window.setTimeout(() => {
      recordLocalSetupEvent("connect: timed out waiting for the CLI");
      setConnectionFailed(true);
    }, CONNECT_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [passkeyCreated, connectAttempt]);

  const handleRetry = () => {
    setConnectionFailed(false);
    setConnectAttempt((attempt) => attempt + 1);
    void refreshStatusNow.current();
  };

  const [cliFragment] = useState(readCliFragment);
  const [handoffPending, setHandoffPending] = useState(() =>
    Boolean(cliFragment.handoffToken),
  );

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
      return;
    }

    // Initial renewal must settle before a handoff establishes a new session.
    // Otherwise a late renewal rejection can clear the accepted session.
    if (authLoading) {
      return;
    }

    recordLocalSetupEvent("handoff: exchanging the one-use token");
    void exchangeHandoffToken(handoffToken)
      .then((response) => {
        if ("accessToken" in response.data.data) {
          acceptBrowserAuthSession(response.data.data);
          recordLocalSetupEvent("handoff: browser session accepted");
          return;
        }
        throw new Error(
          "Local browser session did not select its organization.",
        );
      })
      .catch((failure: unknown) => {
        recordLocalSetupEvent(`handoff: failed (${describeFailure(failure)})`);
        setError("Run heyhey local again to restore access to this computer.");
        setStep("error");
      })
      .finally(() => setHandoffPending(false));
  }, [cliFragment, authLoading]);

  useEffect(() => {
    if (!isAuthenticated || authLoading || handoffPending) {
      return;
    }

    let active = true;
    const refreshStatus = async () => {
      try {
        const response =
          await getApiRuntime().clients.auth.getLocalSetupStatus();
        if (!active) return;
        const nextStatus = response.data.data;
        const statusSummary = `name-saved=${String(nextStatus.nameComplete)} cli-connected=${String(nextStatus.machineConnected)} has-projects=${String(nextStatus.hasProjects)} setup-unfinished=${String(nextStatus.setupProjectId !== null)}`;
        if (statusSummary !== lastStatus.current) {
          lastStatus.current = statusSummary;
          recordLocalSetupEvent(`status: ${statusSummary}`);
        }
        setStatus(nextStatus);
        setStep((currentStep) =>
          currentStep === "loading" ? "name" : currentStep,
        );
        // Move on only once the connection is real. The protected routes keep
        // the terms gate, then first-project setup resumes the saved project.
        if (nextStatus.nameComplete && nextStatus.machineConnected) {
          await navigate(destinationAfterConnecting(nextStatus), {
            replace: true,
          });
        }
      } catch (failure: unknown) {
        if (active && passkeyCreatedRef.current) {
          recordLocalSetupEvent(`status: failed (${describeFailure(failure)})`);
          setConnectionFailed(true);
        } else if (active) {
          recordLocalSetupEvent(`status: failed (${describeFailure(failure)})`);
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
  }, [isAuthenticated, authLoading, handoffPending, navigate]);

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
      await refreshAuthToken();
      setStatus(response.data.data);
      setStep("name");
      recordLocalSetupEvent("name: saved and session refreshed");
    } catch (failure: unknown) {
      recordLocalSetupEvent(`name: failed (${describeFailure(failure)})`);
      setError("We couldn't save your name. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const pairingStarted = searchParams.get("pairing") === "started";
  const pairing = heldLocalPairing();
  const view = describeView({ step, status, pairingStarted, pairing });
  useEffect(() => {
    recordLocalSetupEvent(`view: ${view}`);
  }, [view]);

  if (step === "error") {
    return (
      <main className="local-setup">
        <p className="local-setup__wordmark">HEY HEY</p>
        <h1>LOCAL SETUP NEEDS ATTENTION</h1>
        <p role="alert">{error}</p>
        <LocalSetupDiagnostics />
      </main>
    );
  }

  if (!authLoading && !handoffPending && !isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: { pathname: location.pathname, search: location.search },
        }}
      />
    );
  }

  if (authLoading || handoffPending || step === "loading" || !status) {
    return (
      <main className="local-setup" aria-live="polite">
        <p className="local-setup__wordmark">HEY HEY</p>
        <p>Opening your local workspace…</p>
      </main>
    );
  }

  if (status.nameComplete && (status.machineConnected || passkeyCreated)) {
    return (
      <main className="local-setup">
        <p className="local-setup__wordmark">HEY HEY</p>
        <h1>{t("localSetup.progress.title")}</h1>
        <section className="local-setup__card">
          <LocalPairingProgress
            failed={connectionFailed}
            onRetry={handleRetry}
          />
        </section>
      </main>
    );
  }

  if (!status.nameComplete) {
    return (
      <main className="local-setup">
        <p className="local-setup__wordmark">HEY HEY</p>
        <h1>WHAT SHOULD WE CALL YOU?</h1>
        <section className="local-setup__card">
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
        </section>
      </main>
    );
  }

  return (
    <main className="local-setup">
      <p className="local-setup__wordmark">HEY HEY</p>
      {pairingStarted && pairing ? (
        <header>
          <p className="local-setup__eyebrow">
            {t("localSetup.pairing.eyebrow")}
          </p>
          <h1>{t("localSetup.pairing.title")}</h1>
          <p className="local-setup__intro">
            {t("localSetup.pairing.purpose")}
          </p>
        </header>
      ) : null}
      <section className="local-setup__card">
        {pairingStarted && pairing ? (
          <ClaimMachine
            initialCode={pairing.code}
            enrollment="first-use-shared-new"
            localApprovalSecret={pairing.approvalSecret}
            localAgents={pairing.agents}
            onLocalPasskeyCreated={handlePasskeyCreated}
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
      </section>
    </main>
  );
}
