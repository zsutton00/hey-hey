import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getApiRuntime } from "@hey-hey/ui-common/clients";
import {
  acceptBrowserAuthSession,
  refreshAuthToken,
} from "@hey-hey/ui-common/services";
import { useAuth } from "@hey-hey/ui-common/context";
import type { LocalSetupStatusDto } from "@hey-hey/ui-common/api";
import { ClaimMachine } from "../Settings/ClaimMachine";
import {
  heldLocalPairing,
  holdLocalPairing,
  LOCAL_APPROVAL_SECRET_PATTERN,
} from "../Settings/localApproval";
import { LocalSetupDiagnostics } from "./LocalSetupDiagnostics";
import {
  describeFragment,
  describeNavigationType,
  recordLocalSetupEvent,
} from "./localSetupEvents";
import "./LocalSetupPage.css";

let mountCount = 0;

const describeFailure = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure);

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
    holdLocalPairing({ code, approvalSecret: approval });
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
  if (status.nameComplete && status.machineConnected) return "connected";
  if (!status.nameComplete) return "name";
  if (pairingStarted && pairing) return "passkey-step";
  if (pairingStarted) return "missing-pairing-details";

  return "waiting-for-cli";
};

export function LocalSetupPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated } = useAuth();
  const [status, setStatus] = useState<LocalSetupStatusDto | null>(null);
  const [name, setName] = useState("");
  const [step, setStep] = useState<"loading" | "name" | "error">("loading");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lastStatus = useRef<string | null>(null);

  const [cliFragment] = useState(readCliFragment);

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

    recordLocalSetupEvent("handoff: exchanging the one-use token");
    void getApiRuntime()
      .clients.auth.completeLocalHandoff({
        localHandoffRequestDto: { handoffToken },
      })
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
      });
  }, [cliFragment]);

  useEffect(() => {
    if (!isAuthenticated) return;

    let active = true;
    const refreshStatus = async () => {
      try {
        const response =
          await getApiRuntime().clients.auth.getLocalSetupStatus();
        if (!active) return;
        const nextStatus = response.data.data;
        const statusSummary = `name-saved=${String(nextStatus.nameComplete)} cli-connected=${String(nextStatus.machineConnected)} has-projects=${String(nextStatus.hasProjects)}`;
        if (statusSummary !== lastStatus.current) {
          lastStatus.current = statusSummary;
          recordLocalSetupEvent(`status: ${statusSummary}`);
        }
        setStatus(nextStatus);
        setStep((currentStep) =>
          currentStep === "loading" ? "name" : currentStep,
        );
        if (
          nextStatus.nameComplete &&
          nextStatus.hasProjects &&
          nextStatus.machineConnected
        ) {
          await navigate("/home", { replace: true });
        }
      } catch (failure: unknown) {
        if (active) {
          recordLocalSetupEvent(`status: failed (${describeFailure(failure)})`);
          setError(
            "Local account status is unavailable. Run heyhey local and retry.",
          );
          setStep("error");
        }
      }
    };

    void refreshStatus();
    const interval = window.setInterval(() => void refreshStatus(), 2000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [isAuthenticated, navigate]);

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

  if (step === "loading" || !status) {
    return (
      <main className="local-setup" aria-live="polite">
        <p className="local-setup__wordmark">HEY HEY</p>
        <p>Opening your local workspace…</p>
      </main>
    );
  }

  if (status.nameComplete && status.machineConnected) {
    return (
      <main className="local-setup">
        <p className="local-setup__wordmark">HEY HEY</p>
        <p className="local-setup__eyebrow">LOCAL SETUP · CONNECTED</p>
        <h1>CONNECTED TO YOUR CODING PLANS</h1>
        <section className="local-setup__card">
          <p>
            Your CLI is connected. Host actions still require the existing
            controller authorization checks.
          </p>
          <button onClick={() => void navigate("/welcome")}>
            Bootstrap your first project
          </button>
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
      <p className="local-setup__eyebrow">LOCAL SETUP · CONNECT</p>
      <h1>CONNECT THIS COMPUTER</h1>
      <p className="local-setup__intro">
        Pair your CLI to connect this computer to Hey Hey.
      </p>
      <section className="local-setup__card">
        {pairingStarted && pairing ? (
          <ClaimMachine
            initialCode={pairing.code}
            localApprovalSecret={pairing.approvalSecret}
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
