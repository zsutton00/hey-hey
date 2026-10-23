export const REQUEST_INITIATOR_TRACKING_STORAGE_KEY =
  "hey-hey:request-initiator-tracking";

export function isInitiatorTrackingEnabled(): boolean {
  if (typeof window === "undefined") return false;

  try {
    return (
      window.localStorage.getItem(REQUEST_INITIATOR_TRACKING_STORAGE_KEY) ===
      "true"
    );
  } catch {
    return false;
  }
}

/** Capture during render, before effects and the fetch queue sever the stack. */
export function captureInitiator(): string | undefined {
  if (!isInitiatorTrackingEnabled()) return undefined;
  return new Error().stack;
}
