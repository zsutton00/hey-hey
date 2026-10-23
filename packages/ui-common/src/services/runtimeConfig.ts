export interface RuntimeConfigShape {
  apiProtocol?: string;
  apiHost?: string;
  apiPort?: string;
  localAgentPort?: string;
  botCheckSiteKey?: string;
  apiBasePath?: string;
  apiUrl?: string;
  wsUrl?: string;
  env?: string;
}

const DEFAULT_API_PROTOCOL = "http";
const DEFAULT_API_HOST = "localhost";
const DEFAULT_API_PORT = "3000";
const DEFAULT_API_BASE_PATH = "/api/v1";

const normalizeOptional = (value?: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeBasePath = (value?: string): string => {
  const normalized = normalizeOptional(value) || DEFAULT_API_BASE_PATH;
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
};

const stripApiVersionSuffix = (path: string): string =>
  path.replace(/\/api(?:\/v\d+)?\/?$/, "");

const formatUrl = (url: URL): string => {
  const normalizedPath =
    url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return `${url.protocol}//${url.host}${normalizedPath}`;
};

const formatRelativeUrl = (url: URL): string => {
  const normalizedPath =
    url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return `${normalizedPath}${url.search}${url.hash}` || "/";
};

const hasScheme = (value: string): boolean =>
  /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value);

const isIpAddress = (hostname: string): boolean =>
  /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
  hostname === "::1" ||
  hostname.includes(":");

const isLikelyInternalHostname = (hostname: string): boolean =>
  hostname.length > 0 &&
  !hostname.includes(".") &&
  hostname !== "localhost" &&
  hostname !== "0.0.0.0" &&
  !isIpAddress(hostname);

const parseAgainstBrowserOrigin = (value: string): URL | null => {
  try {
    if (typeof window === "undefined") {
      return new URL(value);
    }
    return new URL(value, window.location.origin);
  } catch {
    return null;
  }
};

const shouldUseBrowserOrigin = (url: URL): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    hasScheme(url.href) &&
    isLikelyInternalHostname(url.hostname) &&
    url.hostname !== window.location.hostname
  );
};

const normalizeBrowserApiUrl = (value: string): string => {
  const parsed = parseAgainstBrowserOrigin(value);
  if (!parsed) {
    return value;
  }

  if (!hasScheme(value) || shouldUseBrowserOrigin(parsed)) {
    return formatRelativeUrl(parsed);
  }

  return formatUrl(parsed);
};

const normalizeBrowserWsUrl = (value: string): string => {
  const parsed = parseAgainstBrowserOrigin(value);
  if (!parsed) {
    return value;
  }

  if (!hasScheme(value)) {
    parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  }

  if (typeof window !== "undefined" && shouldUseBrowserOrigin(parsed)) {
    parsed.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    parsed.hostname = window.location.hostname;
    parsed.port = window.location.port;
  }

  return formatUrl(parsed);
};

const deriveWsServerUrlFromApiUrl = (apiUrl: string): string | null => {
  const url = parseAgainstBrowserOrigin(apiUrl);
  if (!url) {
    return null;
  }

  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = stripApiVersionSuffix(url.pathname);
  url.search = "";
  url.hash = "";

  if (typeof window !== "undefined" && shouldUseBrowserOrigin(url)) {
    url.hostname = window.location.hostname;
    url.port = window.location.port;
  }

  return formatUrl(url);
};

const readRuntimeString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const resolveRuntimeConfig = (): RuntimeConfigShape => {
  if (typeof window === "undefined") {
    return {};
  }
  if (!("__HEY_HEY_RUNTIME_CONFIG__" in window)) {
    return {};
  }
  const value: unknown = window.__HEY_HEY_RUNTIME_CONFIG__;
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return {
    botCheckSiteKey:
      "botCheckSiteKey" in value
        ? readRuntimeString(value.botCheckSiteKey)
        : undefined,
    localAgentPort:
      "localAgentPort" in value
        ? readRuntimeString(value.localAgentPort)
        : undefined,
    apiUrl: "apiUrl" in value ? readRuntimeString(value.apiUrl) : undefined,
    wsUrl: "wsUrl" in value ? readRuntimeString(value.wsUrl) : undefined,
    env: "env" in value ? readRuntimeString(value.env) : undefined,
    apiProtocol:
      "apiProtocol" in value ? readRuntimeString(value.apiProtocol) : undefined,
    apiHost: "apiHost" in value ? readRuntimeString(value.apiHost) : undefined,
    apiPort: "apiPort" in value ? readRuntimeString(value.apiPort) : undefined,
    apiBasePath:
      "apiBasePath" in value ? readRuntimeString(value.apiBasePath) : undefined,
  };
};

const buildHttpUrl = (
  protocol: string,
  host: string,
  port: string,
  basePath: string
): string => `${protocol}://${host}:${port}${basePath}`;

const buildWsUrl = (
  protocol: string,
  host: string,
  port: string,
  basePath: string
): string => {
  const wsProtocol = protocol === "https" ? "wss" : "ws";
  return buildHttpUrl(wsProtocol, host, port, basePath);
};

export const getApiBaseUrl = (): string => {
  const runtime = resolveRuntimeConfig();
  const runtimeUrl = normalizeOptional(runtime.apiUrl);
  if (runtimeUrl) {
    return normalizeBrowserApiUrl(runtimeUrl);
  }

  const envUrl = normalizeOptional(import.meta.env?.VITE_API_URL);
  if (envUrl) {
    return normalizeBrowserApiUrl(envUrl);
  }

  const protocol =
    normalizeOptional(runtime.apiProtocol) || DEFAULT_API_PROTOCOL;
  const host = normalizeOptional(runtime.apiHost) || DEFAULT_API_HOST;
  const port = normalizeOptional(runtime.apiPort) || DEFAULT_API_PORT;
  const basePath = normalizeBasePath(runtime.apiBasePath);
  return normalizeBrowserApiUrl(buildHttpUrl(protocol, host, port, basePath));
};

export const getWsUrl = (): string => {
  const runtime = resolveRuntimeConfig();
  const runtimeWsUrl = normalizeOptional(runtime.wsUrl);
  if (runtimeWsUrl) {
    return normalizeBrowserWsUrl(runtimeWsUrl);
  }

  const envWsUrl = normalizeOptional(import.meta.env?.VITE_WS_URL);
  if (envWsUrl) {
    return normalizeBrowserWsUrl(envWsUrl);
  }

  const apiUrl = getApiBaseUrl();
  const derivedWsUrl = deriveWsServerUrlFromApiUrl(apiUrl);
  if (derivedWsUrl) {
    return derivedWsUrl;
  }

  const protocol =
    normalizeOptional(runtime.apiProtocol) || DEFAULT_API_PROTOCOL;
  const host = normalizeOptional(runtime.apiHost) || DEFAULT_API_HOST;
  const port = normalizeOptional(runtime.apiPort) || DEFAULT_API_PORT;
  const basePath = stripApiVersionSuffix(
    normalizeBasePath(runtime.apiBasePath)
  );
  return buildWsUrl(protocol, host, port, basePath);
};

export const getRuntimeEnvironment = (): string => {
  const runtime = resolveRuntimeConfig();
  return (
    normalizeOptional(runtime.env) ||
    normalizeOptional(import.meta.env?.VITE_ENV) ||
    import.meta.env?.MODE ||
    "production"
  );
};

export const getLocalAgentPort = (): string | undefined =>
  normalizeOptional(resolveRuntimeConfig().localAgentPort) ||
  normalizeOptional(import.meta.env?.VITE_LOCAL_AGENT_PORT);

/** Public site key of the bot-check widget shown before a demo is provisioned. */
export const getBotCheckSiteKey = (): string | undefined =>
  normalizeOptional(resolveRuntimeConfig().botCheckSiteKey) ||
  normalizeOptional(import.meta.env?.VITE_BOT_CHECK_SITE_KEY);
