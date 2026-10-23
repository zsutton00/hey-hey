const DEMO_SESSION_MARKER_KEY = "heyhey.demoSandbox.session";

/**
 * Remembers that this browser's signed-in session belongs to a demo sandbox so
 * that, once the session ends, the app can send the visitor to the demo page
 * (which tells them their demo expired) instead of the member sign-in. The
 * marker is a routing hint only; the API remains the authority on expiry.
 */
export function markDemoSandboxSession(isDemoSession: boolean): void {
  try {
    if (isDemoSession) {
      window.localStorage.setItem(DEMO_SESSION_MARKER_KEY, "1");
    } else {
      window.localStorage.removeItem(DEMO_SESSION_MARKER_KEY);
    }
  } catch {
    // Storage can be unavailable (private mode); the hint is optional.
  }
}

export function hasDemoSandboxSession(): boolean {
  try {
    return window.localStorage.getItem(DEMO_SESSION_MARKER_KEY) === "1";
  } catch {
    return false;
  }
}
