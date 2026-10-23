/**
 * Cross-tab location registry.
 *
 * Each tab writes its current pathname+search to a shared localStorage key
 * keyed by a per-tab UUID (stored in sessionStorage so it resets on tab
 * close). Entries expire after REGISTRY_TTL_MS to self-heal against tabs that
 * closed without firing pagehide.
 *
 * A BroadcastChannel carries `highlight:<pathname>` signals so the matching
 * tab can draw attention to itself without requiring window.focus().
 */

const REGISTRY_KEY = "heyhey:tabLocations";
const HIGHLIGHT_CHANNEL = "heyhey:tabHighlight";
const REGISTRY_TTL_MS = 30_000;

interface TabEntry {
  pathname: string;
  search: string;
  updatedAt: number;
}

type Registry = Record<string, TabEntry>;

const readRegistry = (): Registry => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(REGISTRY_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Registry;
  } catch {
    return {};
  }
};

const writeRegistry = (registry: Registry): void => {
  try {
    window.localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry));
  } catch {
    // Ignore quota / privacy-mode errors.
  }
};

const pruneStale = (registry: Registry): Registry => {
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(registry).filter(
      ([, entry]) => now - entry.updatedAt < REGISTRY_TTL_MS,
    ),
  );
};

const getTabId = (): string => {
  const KEY = "heyhey:tabId";
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(KEY, id);
  }
  return id;
};

export const writeMyLocation = (pathname: string, search: string): void => {
  const registry = pruneStale(readRegistry());
  registry[getTabId()] = { pathname, search, updatedAt: Date.now() };
  writeRegistry(registry);
};

export const removeMyLocation = (): void => {
  const registry = readRegistry();
  delete registry[getTabId()];
  writeRegistry(registry);
};

/**
 * Returns true when any other open tab is currently at `pathname` (ignoring
 * search params — agent-session URLs carry no meaningful search state).
 */
export const hasOtherTabAt = (pathname: string): boolean => {
  const myId = getTabId();
  const registry = pruneStale(readRegistry());
  const now = Date.now();
  return Object.entries(registry).some(
    ([id, entry]) =>
      id !== myId &&
      now - entry.updatedAt < REGISTRY_TTL_MS &&
      entry.pathname === pathname,
  );
};

// Singleton channel — created once per page load, closed by the browser on unload.
const _highlightChannel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(HIGHLIGHT_CHANNEL)
    : null;

const HIGHLIGHT_PREFIX = "highlight:";

export const broadcastHighlight = (pathname: string): void => {
  _highlightChannel?.postMessage(`${HIGHLIGHT_PREFIX}${pathname}`);
};

export const subscribeToHighlight = (
  onHighlight: (pathname: string) => void,
): (() => void) => {
  if (!_highlightChannel) return () => {};
  const handler = (event: MessageEvent): void => {
    const data: unknown = event.data;
    if (typeof data !== "string" || !data.startsWith(HIGHLIGHT_PREFIX)) return;
    onHighlight(data.slice(HIGHLIGHT_PREFIX.length));
  };
  _highlightChannel.addEventListener("message", handler);
  return () => _highlightChannel.removeEventListener("message", handler);
};

// Inject highlight ring styles once at module load.
if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = `
    @keyframes hhTabHighlightRing {
      0%   { opacity: 1; box-shadow: inset 0 0 0 3px rgba(99,102,241,0.85); }
      100% { opacity: 0; box-shadow: inset 0 0 0 3px rgba(99,102,241,0); }
    }
    .hh-tab-highlight-ring {
      position: fixed; inset: 0; z-index: 99999;
      pointer-events: none;
      animation: hhTabHighlightRing 1.5s ease-out forwards;
    }
  `;
  document.head.appendChild(style);
}

export const triggerHighlightEffect = (): void => {
  // Title ping
  const original = document.title;
  document.title = `● ${original}`;
  setTimeout(() => {
    document.title = original;
  }, 3000);

  // In-page ring flash
  const ring = document.createElement("div");
  ring.className = "hh-tab-highlight-ring";
  document.body.appendChild(ring);
  ring.addEventListener("animationend", () => ring.remove(), { once: true });
};
