/**
 * A short, non-secret timeline of what the local setup page did in this tab.
 * Local setup involves a redirect-prone handoff, and the page can remount while
 * the session refreshes, so the timeline survives both and is shown on screen
 * when something goes wrong. Entries never contain secrets: the pairing code,
 * approval secret and handoff token are reported by length only.
 */

const STORAGE_KEY = "heyhey.local-setup.diagnostics";
const MAX_EVENTS = 60;
const FRAGMENT_KEYS = ["handoff", "code", "approval"] as const;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const listeners = new Set<() => void>();

/** The stored timeline exactly as persisted; a stable value for subscribers. */
export const readStoredLocalSetupEvents = (): string | null =>
  sessionStorage.getItem(STORAGE_KEY);

export const subscribeToLocalSetupEvents = (
  listener: () => void,
): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

export const parseLocalSetupEvents = (stored: string | null): string[] => {
  if (stored === null) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(stored);
    return isStringArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const recordLocalSetupEvent = (message: string): void => {
  const time = new Date().toISOString().slice(11, 23);
  const events = [
    ...parseLocalSetupEvents(readStoredLocalSetupEvents()),
    `${time} ${message}`,
  ];

  console.info("[local-setup]", message);
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(events.slice(-MAX_EVENTS)),
  );
  listeners.forEach((listener) => listener());
};

/** Which one-time values a URL fragment carried, by length only. */
export const describeFragment = (hash: string): string => {
  const params = new URLSearchParams(hash.slice(1));
  const described = FRAGMENT_KEYS.map(
    (key) => `${key}=${params.get(key)?.length ?? "absent"}`,
  );

  return described.join(" ");
};

/** How this document was loaded: navigate, reload or back_forward. */
export const describeNavigationType = (): string => {
  const entry = performance.getEntriesByType("navigation")[0];

  return entry !== undefined && "type" in entry
    ? String(entry.type)
    : "unknown";
};
