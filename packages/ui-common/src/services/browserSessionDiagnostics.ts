import axios from "axios";
import type {
  LocalStartupBrowserEvent,
  LocalStartupBrowserRecord,
} from "@hey-hey/contracts/agent-bridge";

type DiagnosticListener = (
  event: LocalStartupBrowserEvent,
  facts?: LocalStartupBrowserRecord["facts"],
) => void;

const listeners = new Set<DiagnosticListener>();

/** Shared authentication emits observations; the local setup owns their storage and delivery. */
export const observeBrowserSessionDiagnostics = (
  listener: DiagnosticListener,
): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const recordBrowserSessionDiagnostic: DiagnosticListener = (
  event,
  facts,
) => {
  for (const listener of listeners) {
    try {
      listener(event, facts);
    } catch (error) {
      console.warn("Browser session diagnostic listener failed", {
        event,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
};

export function diagnosticFailureFacts(
  error: unknown,
): NonNullable<LocalStartupBrowserRecord["facts"]> {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  const errorNames = [
    "Error",
    "TypeError",
    "SyntaxError",
    "AxiosError",
    "AbortError",
    "TimeoutError",
    "SecurityError",
    "InvalidStateError",
    "NotAllowedError",
    "NotSupportedError",
    "WebAuthnCancelledError",
    "WebAuthnUnsupportedError",
    "PasskeyCeremonyCancelledError",
    "PasskeyUnsupportedError",
    "MachineEnrollmentClaimError",
    "UnknownError",
  ] as const satisfies readonly NonNullable<
    LocalStartupBrowserRecord["facts"]
  >["errorName"][];
  const errorName = error instanceof Error ? error.name : undefined;
  const transportCodes = [
    "ERR_NETWORK",
    "ERR_BAD_REQUEST",
    "ERR_BAD_RESPONSE",
    "ECONNABORTED",
    "ETIMEDOUT",
    "ERR_CANCELED",
  ] as const satisfies readonly NonNullable<
    LocalStartupBrowserRecord["facts"]
  >["transportCode"][];
  const transportCode = axios.isAxiosError(error)
    ? transportCodes.find((code) => code === error.code)
    : undefined;
  return {
    reason: status !== undefined ? "request_failed" : "unknown_failure",
    errorName: errorNames.find((name) => name === errorName) ?? "UnknownError",
    ...(transportCode !== undefined ? { transportCode } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}
