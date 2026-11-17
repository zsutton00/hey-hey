import { LocalStartupBrowserEvent } from "@hey-hey/contracts/agent-bridge";

const KEY = "heyhey.local-startup.transport";
const tokenPattern = /^[A-Za-z0-9_-]{43}$/u;

/** Capture before the handoff clears the fragment. This capability only records diagnostics. */
export function holdStartupDiagnosticTransport(hash: string): void {
  const fragment = new URLSearchParams(hash.slice(1));
  const port = Number(fragment.get("diagnosticPort"));
  const token = fragment.get("diagnosticToken");
  if (
    Number.isInteger(port) &&
    port > 0 &&
    port <= 65535 &&
    token &&
    tokenPattern.test(token)
  ) {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ port, token }));
    } catch {
      console.warn("[local-setup] diagnostic transport storage unavailable");
    }
  }
}

// The existing on-screen timeline can contain server messages. Only these deliberate
// categories cross the offline persistence boundary; message text never does.
export function startupBrowserEvent(
  message: string,
): LocalStartupBrowserEvent | undefined {
  if (message.startsWith("mounted #")) {
    return LocalStartupBrowserEvent.Mounted;
  }
  if (message.startsWith("unmounted #")) {
    return LocalStartupBrowserEvent.Unmounted;
  }
  if (message === "handoff: exchanging the one-use token") {
    return LocalStartupBrowserEvent.HandoffStarted;
  }
  if (message === "handoff: browser session accepted") {
    return LocalStartupBrowserEvent.HandoffAccepted;
  }
  if (message === "handoff: no token in the address") {
    return LocalStartupBrowserEvent.HandoffMissing;
  }
  if (message.startsWith("handoff: failed (")) {
    return LocalStartupBrowserEvent.HandoffFailed;
  }
  if (message.startsWith("status: failed (")) {
    return LocalStartupBrowserEvent.StatusFailed;
  }
  if (message === "name: saving") {
    return LocalStartupBrowserEvent.NameSaving;
  }
  if (message === "name: saved and session refreshed") {
    return LocalStartupBrowserEvent.NameSaved;
  }
  if (message.startsWith("name: failed (")) {
    return LocalStartupBrowserEvent.NameFailed;
  }
  if (message === "connect: timed out waiting for the CLI") {
    return LocalStartupBrowserEvent.ConnectionTimeout;
  }
  if (message === "repair: requested") {
    return LocalStartupBrowserEvent.RepairRequested;
  }
  if (message.startsWith("repair: offered")) {
    return LocalStartupBrowserEvent.RepairOffered;
  }
  if (/^repair: (?:status |request )?failed\b/u.test(message)) {
    return LocalStartupBrowserEvent.RepairFailed;
  }
  if (message.startsWith("passkeys: list failed")) {
    return LocalStartupBrowserEvent.PasskeyFailed;
  }
  return undefined;
}

export function sendStartupBrowserEvent(message: string): void {
  const event = startupBrowserEvent(message);
  if (!event) {
    return;
  }
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (!isTransport(stored)) {
      return;
    }
    void fetch(`http://127.0.0.1:${stored.port}/local-startup/events`, {
      method: "POST",
      headers: {
        "X-HeyHey-Diagnostic": stored.token,
        "Content-Type": "text/plain",
      },
      body: event,
      keepalive: true,
      signal: AbortSignal.timeout(3000),
      credentials: "omit",
    })
      .then((response) => {
        if (!response.ok) {
          console.warn(
            "[local-setup] diagnostic event refused",
            response.status,
          );
        }
      })
      .catch(() => {
        console.warn("[local-setup] diagnostic listener unavailable");
      });
  } catch {
    console.warn("[local-setup] diagnostic transport unavailable");
  }
}

function isTransport(value: unknown): value is { port: number; token: string } {
  if (
    typeof value !== "object" ||
    value === null ||
    !("port" in value) ||
    !("token" in value)
  ) {
    return false;
  }
  return (
    typeof value.port === "number" &&
    Number.isInteger(value.port) &&
    value.port > 0 &&
    value.port <= 65535 &&
    typeof value.token === "string" &&
    tokenPattern.test(value.token)
  );
}
