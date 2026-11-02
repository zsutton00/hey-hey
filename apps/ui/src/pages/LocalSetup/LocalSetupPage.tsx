import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getApiRuntime } from "@hey-hey/ui-common/clients";
import {
  acceptBrowserAuthSession,
  refreshAuthToken,
} from "@hey-hey/ui-common/services";
import { useAuth } from "@hey-hey/ui-common/context";
import type { LocalSetupStatusDto } from "@hey-hey/ui-common/api";
import "./LocalSetupPage.css";

const readHandoffToken = (): string | null => {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get("handoff");
  if (token) {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  }
  return token;
};

export function LocalSetupPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated } = useAuth();
  const [status, setStatus] = useState<LocalSetupStatusDto | null>(null);
  const [name, setName] = useState("");
  const [step, setStep] = useState<"loading" | "start" | "name" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handoffToken = readHandoffToken();
    if (!handoffToken) return;

    void getApiRuntime()
      .clients.auth.completeLocalHandoff({
        localHandoffRequestDto: { handoffToken },
      })
      .then((response) => {
        if ("accessToken" in response.data.data) {
          acceptBrowserAuthSession(response.data.data);
          return;
        }
        throw new Error(
          "Local browser session did not select its organization.",
        );
      })
      .catch(() => {
        setError("Run heyhey local again to restore access to this computer.");
        setStep("error");
      });
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    let active = true;
    const refreshStatus = async () => {
      try {
        const response =
          await getApiRuntime().clients.auth.getLocalSetupStatus();
        if (!active) return;
        const nextStatus = response.data.data;
        setStatus(nextStatus);
        setStep((currentStep) =>
          currentStep === "loading"
            ? nextStatus.nameComplete
              ? "name"
              : "start"
            : currentStep,
        );
        if (
          nextStatus.nameComplete &&
          nextStatus.hasProjects &&
          nextStatus.machineConnected
        ) {
          await navigate("/home", { replace: true });
        }
      } catch {
        if (active) {
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
    try {
      const response = await getApiRuntime().clients.auth.saveLocalDisplayName({
        localNameRequestDto: { name: displayName },
      });
      await refreshAuthToken();
      setStatus(response.data.data);
      setStep("name");
    } catch {
      setError("We couldn't save your name. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const pairingStarted = searchParams.get("pairing") === "started";
  if (step === "error") {
    return (
      <main className="local-setup">
        <p className="local-setup__wordmark">HEY HEY</p>
        <h1>LOCAL SETUP NEEDS ATTENTION</h1>
        <p role="alert">{error}</p>
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

  if (!status.nameComplete && step === "start") {
    return (
      <main className="local-setup">
        <p className="local-setup__wordmark">HEY HEY</p>
        <h1>GET STARTED</h1>
        <ol className="local-setup__steps">
          <li className="is-current">
            <span>1</span>
            <strong>Tell us your name</strong>
            <button onClick={() => setStep("name")}>Get started</button>
          </li>
          <li>
            <span>2</span>
            <strong>Connect Hey Hey to your coding plans</strong>
          </li>
          <li>
            <span>3</span>
            <strong>Bootstrap your first project and get going</strong>
          </li>
        </ol>
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
        <h2>Continue with your CLI</h2>
        {pairingStarted ? (
          <>
            <p>
              Keep the terminal running <code>heyhey local</code> open. It
              starts pairing and opens this page for you.
            </p>
            <ol>
              <li>
                <strong>Enter the code from your terminal</strong>
                <span>Use the code shown by your CLI on the pairing page.</span>
              </li>
              <li>
                <strong>Create a pairing passkey</strong>
                <span>Review this computer and follow the browser prompt.</span>
              </li>
              <li>
                <strong>Confirm in your terminal</strong>
                <span>Return to the original CLI to finish pairing.</span>
              </li>
            </ol>
            <button onClick={() => void navigate("/pairing?returnTo=local")}>
              Continue to pairing
            </button>
          </>
        ) : (
          <p>Waiting for the local CLI to connect to Hey Hey…</p>
        )}
        <p className="local-setup__status" role="status">
          {pairingStarted ? "Pairing started" : "Connecting"}
        </p>
      </section>
    </main>
  );
}
