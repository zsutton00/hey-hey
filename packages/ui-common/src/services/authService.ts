import Ajv from "ajv";
import addFormats from "ajv-formats";
import { browserSessionSchema } from "../generated/browser-session-contract";
import axios, { AxiosError } from "axios";
import type {
  BrowserSessionResponseDto,
  BrowserOrganizationSelectionDto,
  PasswordRecoveryAcknowledgementDto,
} from "../api/api";
import {
  createAccessToken,
  type ApiAuthAdapter,
} from "../clients/createApiRuntime";
import type { UnifiedApiClient } from "../clients/serviceClients";
import { getApiClient, getApiRuntime } from "../clients/runtime";
import memoize from "lodash/memoize.js";
import { markDemoSandboxSession } from "../data/demoSandboxSession";

// Memory storage for tokens (cleared on page refresh for security)
let authToken: string | null = null;
let browserAuthUser: BrowserSessionResponseDto["user"] | null = null;
let cachedClient: UnifiedApiClient | null = null;
let renewalPromise: Promise<BrowserSessionResponseDto> | null = null;
let logoutPromise: Promise<void> | null = null;

const BROWSER_RENEWAL_LOCK_NAME = "hey-hey-browser-session-renewal";
const BROWSER_RENEWAL_CHANNEL_NAME = "hey-hey-browser-session-renewal-result";

let browserRenewalChannel: BroadcastChannel | null = null;
let latestReceivedRenewal: BrowserSessionResponseDto | null = null;
let receivedRenewalVersion = 0;

export const BrowserSessionContinuityDecision = {
  RenewFromServer: "renew-from-server",
  RemainSignedOut: "remain-signed-out",
} as const;

export type BrowserSessionContinuityDecision =
  (typeof BrowserSessionContinuityDecision)[keyof typeof BrowserSessionContinuityDecision];

let browserSessionContinuityDecision: BrowserSessionContinuityDecision =
  BrowserSessionContinuityDecision.RenewFromServer;

type JwtPayload = {
  sub?: string;
  email?: string;
  name?: string;
  isDevAdmin?: boolean;
  devAdminMode?: boolean;
  exp?: number;
  [key: string]: unknown;
};

const base64UrlDecode = (value: string): string | null => {
  if (!value) return null;

  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddingNeeded = (4 - (base64.length % 4 || 4)) % 4;
  const padded = base64.padEnd(base64.length + paddingNeeded, "=");

  try {
    if (typeof globalThis.atob === "function") {
      const binary = globalThis.atob(padded);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }

    const globalBuffer = (
      globalThis as {
        Buffer?: {
          from: (
            input: string,
            encoding: string,
          ) => {
            toString: (encoding: string) => string;
          };
        };
      }
    ).Buffer;

    if (globalBuffer) {
      return globalBuffer.from(padded, "base64").toString("utf-8");
    }
  } catch (error) {
    console.error("Failed to base64 decode auth token", error);
    return null;
  }

  console.error("No available decoder for base64 strings in this environment");
  return null;
};

const decodeJwtPayload = memoize((token: string): JwtPayload | null => {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) {
    console.error("Invalid JWT structure: expected 3 parts");
    return null;
  }

  const decodedPayload = base64UrlDecode(parts[1]);
  if (!decodedPayload) return null;

  try {
    return JSON.parse(decodedPayload) as JwtPayload;
  } catch (error) {
    console.error("Failed to parse JWT payload", error);
    return null;
  }
});

const resolveClient = (client?: UnifiedApiClient): UnifiedApiClient => {
  if (client) {
    cachedClient = client;
    return client;
  }

  try {
    const runtimeClient = getApiClient();
    cachedClient = runtimeClient;
    return runtimeClient;
  } catch {
    if (cachedClient) {
      return cachedClient;
    }

    throw new Error(
      "API client has not been initialized. Ensure initializeBrowserApiRuntime is called before using auth services.",
    );
  }
};

// Auth state change listeners
type AuthChangeListener = (
  isAuthenticated: boolean,
  token: string | null,
) => void;
const authChangeListeners: AuthChangeListener[] = [];

// Utility function to handle axios errors consistently
const handleAxiosError = (error: unknown, context: string): never => {
  if (context === "Change current password") {
    const details = axios.isAxiosError(error)
      ? { status: error.response?.status, code: error.code }
      : { errorType: error instanceof Error ? error.name : typeof error };
    console.error(`${context} failed`, details);
  } else {
    console.error(`${context} failed:`, error);
  }

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;

    // Network error or service unavailable
    if (!axiosError.response) {
      if (
        axiosError.code === "ECONNREFUSED" ||
        axiosError.code === "ERR_NETWORK"
      ) {
        throw new Error(
          "Unable to connect to the authentication service. Please check if the API service is running and try again.",
        );
      }
      if (axiosError.code === "ENOTFOUND") {
        throw new Error(
          "Authentication service not found. Please check your network connection.",
        );
      }
      throw new Error(
        "Network error occurred. Please check your connection and try again.",
      );
    }

    // HTTP error responses
    const status = axiosError.response.status;

    if (status === 401) {
      if (context === "Login") {
        throw new Error(
          "Invalid email or password. Please check your credentials and try again.",
        );
      } else if (context === "Change current password") {
        throw new Error("Current password is incorrect. Please try again.");
      } else {
        throw new Error("Your session has expired. Please log in again.");
      }
    } else if (status === 403) {
      if (context === "Login") {
        throw new Error("Access forbidden. Your account may be disabled.");
      } else if (context === "Toggle dev-admin mode") {
        throw new Error("You don't have permission to toggle dev-admin mode.");
      } else {
        throw new Error("Access forbidden.");
      }
    } else if (status === 429) {
      throw new Error("Too many requests. Please wait a moment and try again.");
    } else if (status >= 500) {
      throw new Error(
        "Authentication service is temporarily unavailable. Please try again later.",
      );
    } else if (status === 404) {
      throw new Error(
        "Authentication service endpoint not found. Please contact support.",
      );
    } else {
      throw new Error(
        `${context} failed with status ${status}. Please try again or contact support.`,
      );
    }
  }

  // Generic error fallback
  throw new Error(
    `An unexpected error occurred during ${context.toLowerCase()}. Please try again.`,
  );
};

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  expiresIn?: number;
  user?: {
    id: string;
    email: string;
    name?: string;
    isDevAdmin?: boolean;
    devAdminMode?: boolean;
  };
}

export interface PasswordChangeRequired {
  mustChangePassword: true;
  passwordChangeToken: string;
}

export const PASSWORD_RECOVERY_ACKNOWLEDGEMENT =
  "If an eligible account exists, recovery instructions will be sent." as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const validator = addFormats(
  new Ajv({
    strict: false,
    formats: { "branded-UserId": true, "branded-OrganizationId": true },
  }),
).compile<BrowserSessionResponseDto>(browserSessionSchema);
const parseBrowserAuthResponse = (
  value: unknown,
): BrowserSessionResponseDto => {
  if (!validator(value))
    throw new Error("Invalid browser authentication response");
  return value;
};

let browserSelection: BrowserOrganizationSelectionDto | null = null;
export const getBrowserSelection = () => browserSelection;
let mutationTail: Promise<unknown> | null = null;
const serializeRenewal = (
  client?: UnifiedApiClient,
  organizationId?: string,
) => {
  const result = mutationTail
    ? mutationTail.then(() => renewBrowserAccess(client, organizationId))
    : renewBrowserAccess(client, organizationId);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  mutationTail = settled;
  void settled.then(() => {
    if (mutationTail === settled) mutationTail = null;
  });
  return result;
};

export const getAuthToken = (): string | null => {
  return authToken;
};

export const getBrowserSessionContinuityDecision =
  (): BrowserSessionContinuityDecision => browserSessionContinuityDecision;

export const setAuthToken = (token: string) => {
  const previousToken = authToken;
  authToken = token;
  browserSessionContinuityDecision =
    BrowserSessionContinuityDecision.RenewFromServer;

  try {
    const runtime = getApiRuntime();
    runtime.transport.setAuthToken(token);
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[authService] Unable to set auth token on runtime", error);
    }
  }

  if (previousToken !== token) {
    notifyAuthChange(true, token);
  }
};

const setBrowserAuthState = (response: BrowserSessionResponseDto): void => {
  const previousToken = authToken;
  browserAuthUser = response.user;
  browserSelection = "status" in response ? response : null;
  browserSessionContinuityDecision =
    BrowserSessionContinuityDecision.RenewFromServer;
  if ("accessToken" in response) {
    setAuthToken(response.accessToken);
  } else {
    authToken = null;
    try {
      getApiRuntime().transport.setAuthToken(null);
    } catch {
      // noop
    }
  }
  if (!("accessToken" in response) || previousToken === authToken)
    notifyAuthChange(true, authToken);
};

const receiveBrowserRenewal = (value: unknown): void => {
  if (
    logoutPromise ||
    browserSessionContinuityDecision ===
      BrowserSessionContinuityDecision.RemainSignedOut
  )
    return;
  try {
    const response = parseBrowserAuthResponse(value);
    latestReceivedRenewal = response;
    receivedRenewalVersion += 1;
    setBrowserAuthState(response);
  } catch {
    // Other contexts are untrusted input. Ignore malformed renewal messages.
  }
};

const waitForBrowserRenewalDelivery = (): Promise<void> =>
  new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });

const getBrowserRenewalChannel = (): BroadcastChannel | null => {
  if (browserRenewalChannel) {
    return browserRenewalChannel;
  }

  if (typeof globalThis.BroadcastChannel !== "function") {
    return null;
  }

  try {
    browserRenewalChannel = new globalThis.BroadcastChannel(
      BROWSER_RENEWAL_CHANNEL_NAME,
    );
    browserRenewalChannel.addEventListener("message", (event) => {
      receiveBrowserRenewal(event.data);
    });
    return browserRenewalChannel;
  } catch {
    return null;
  }
};

export const clearAuthToken = () => {
  const wasAuthenticated = !!authToken || !!browserAuthUser;
  authToken = null;
  browserAuthUser = null;
  browserSelection = null;

  try {
    const runtime = getApiRuntime();
    runtime.transport.setAuthToken(null);
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[authService] Unable to clear auth token on runtime",
        error,
      );
    }
  }

  // Notify listeners if auth state changed
  if (wasAuthenticated) {
    notifyAuthChange(false, null);
  }
};

export const isAuthenticated = (): boolean => {
  return !!authToken;
};

export const login = async (
  credentials: LoginCredentials,
  client?: UnifiedApiClient,
): Promise<BrowserSessionResponseDto | PasswordChangeRequired> => {
  let innerData: unknown;

  try {
    const response = await resolveClient(client).login({
      loginDto: credentials,
    });
    innerData = response.data?.data;
  } catch (error) {
    return handleAxiosError(error, "Login");
  }

  if (
    isRecord(innerData) &&
    innerData.mustChangePassword === true &&
    typeof innerData.passwordChangeToken === "string" &&
    innerData.passwordChangeToken.length > 0
  ) {
    return {
      mustChangePassword: true,
      passwordChangeToken: innerData.passwordChangeToken,
    };
  }

  const browserAuthResponse = parseBrowserAuthResponse(innerData);
  setBrowserAuthState(browserAuthResponse);
  markDemoSandboxSession(false);
  return browserAuthResponse;
};

export const changePassword = async (
  passwordChangeToken: string,
  newPassword: string,
  client?: UnifiedApiClient,
): Promise<BrowserSessionResponseDto> => {
  try {
    const response = await resolveClient(client).changePassword({
      changePasswordDto: {
        passwordChangeToken,
        newPassword,
      },
    });
    const browserAuthResponse = parseBrowserAuthResponse(response.data?.data);
    setBrowserAuthState(browserAuthResponse);
    markDemoSandboxSession(false);
    return browserAuthResponse;
  } catch (error) {
    clearAuthToken();
    return handleAxiosError(error, "Change password");
  }
};

export const initiatePasswordRecovery = async (
  email: string,
  client?: UnifiedApiClient,
): Promise<PasswordRecoveryAcknowledgementDto> => {
  try {
    const response = await resolveClient(client).initiatePasswordRecovery({
      passwordRecoveryRequestDto: { email },
    });
    const data = response.data?.data;
    if (!isRecord(data) || data.message !== PASSWORD_RECOVERY_ACKNOWLEDGEMENT) {
      throw new Error("Invalid password recovery acknowledgement");
    }
    return { message: PASSWORD_RECOVERY_ACKNOWLEDGEMENT };
  } catch (error) {
    return handleAxiosError(error, "Password recovery");
  }
};

export const changeCurrentPassword = async (
  currentPassword: string,
  newPassword: string,
  client?: UnifiedApiClient,
): Promise<BrowserSessionResponseDto> => {
  try {
    const response = await resolveClient(client).changeCurrentPassword({
      changeCurrentPasswordDto: {
        currentPassword,
        newPassword,
      },
    });
    const browserAuthResponse = parseBrowserAuthResponse(response.data?.data);
    setBrowserAuthState(browserAuthResponse);
    return browserAuthResponse;
  } catch (error) {
    return handleAxiosError(error, "Change current password");
  }
};

const renewBrowserAccessFromServer = async (
  client?: UnifiedApiClient,
  requestedOrganizationId?: string,
): Promise<BrowserSessionResponseDto> => {
  try {
    const resolvedClient = resolveClient(client);
    const response = await resolvedClient.refreshToken({
      ...(requestedOrganizationId !== undefined
        ? {
            refreshBrowserSessionDto: {
              organizationId: requestedOrganizationId,
            },
          }
        : {}),
    });
    const browserAuthResponse = parseBrowserAuthResponse(response.data?.data);
    setBrowserAuthState(browserAuthResponse);
    return browserAuthResponse;
  } catch (error) {
    const rejectedOrganizationSwitch =
      requestedOrganizationId !== undefined &&
      axios.isAxiosError(error) &&
      error.response?.status !== 401;
    if (!logoutPromise && !rejectedOrganizationSwitch) {
      clearAuthToken();
    }
    return handleAxiosError(error, "Token refresh");
  }
};

const renewBrowserAccess = async (
  client?: UnifiedApiClient,
  requestedOrganizationId?: string,
): Promise<BrowserSessionResponseDto> => {
  const locks = globalThis.navigator?.locks;

  if (!locks) {
    return renewBrowserAccessFromServer(client, requestedOrganizationId);
  }

  const channel = getBrowserRenewalChannel();

  const waveStartVersion = receivedRenewalVersion;

  return locks.request(BROWSER_RENEWAL_LOCK_NAME, async () => {
    // BroadcastChannel messages are delivered as tasks. Yield once after lock
    // acquisition so the prior owner result can arrive before deciding that
    // this tab must spend the browser's current refresh generation.
    await waitForBrowserRenewalDelivery();

    if (
      receivedRenewalVersion > waveStartVersion &&
      latestReceivedRenewal &&
      (requestedOrganizationId === undefined ||
        latestReceivedRenewal.user.currentOrganizationId ===
          requestedOrganizationId)
    ) {
      setBrowserAuthState(latestReceivedRenewal);
      return latestReceivedRenewal;
    }

    const response = await renewBrowserAccessFromServer(
      client,
      requestedOrganizationId,
    );
    channel?.postMessage(response);
    return response;
  });
};

export const refreshAuthToken = (
  client?: UnifiedApiClient,
  requestedOrganizationId?: string,
): Promise<BrowserSessionResponseDto> => {
  if (logoutPromise) {
    return Promise.reject(
      new Error("Cannot renew the browser session while logout is in progress"),
    );
  }

  if (requestedOrganizationId !== undefined) {
    return serializeRenewal(client, requestedOrganizationId);
  }

  if (!renewalPromise) {
    renewalPromise = serializeRenewal(client).finally(() => {
      renewalPromise = null;
    });
  }

  return renewalPromise;
};

export const browserApiAuthAdapter: ApiAuthAdapter = {
  getAccessToken: () =>
    authToken === null ? null : createAccessToken(authToken),
  refreshAccessToken: () =>
    refreshAuthToken().then((response) =>
      "accessToken" in response
        ? createAccessToken(response.accessToken)
        : null,
    ),
  onAuthChanged: (listener) =>
    onAuthChange((_isAuthenticated, token) => {
      listener(token === null ? null : createAccessToken(token));
    }),
  onUnauthorized: () => {
    if (!browserSelection) clearAuthToken();
  },
};

const terminateBrowserSession = async (
  client?: UnifiedApiClient,
): Promise<void> => {
  if (mutationTail) {
    try {
      await mutationTail;
    } catch {
      // The logout request must still run after a failed in-flight renewal.
    }
  }

  try {
    await resolveClient(client).logout();
  } catch (error) {
    return handleAxiosError(error, "Logout");
  }

  browserSessionContinuityDecision =
    BrowserSessionContinuityDecision.RemainSignedOut;
  // Signing out of a demo ends it for this browser; the API drops its binding.
  markDemoSandboxSession(false);
  clearAuthToken();
};

export const logout = (client?: UnifiedApiClient): Promise<void> => {
  if (!logoutPromise) {
    logoutPromise = terminateBrowserSession(client).finally(() => {
      logoutPromise = null;
    });
  }

  return logoutPromise;
};

// Get current user info (stored in memory or decode from token)
export const getCurrentUser = () => {
  if (browserAuthUser) {
    return browserAuthUser;
  }

  if (!authToken) return null;
  const payload = decodeJwtPayload(authToken);
  if (!payload) return null;

  const { sub, email, name, isDevAdmin, devAdminMode, exp } = payload;

  if (typeof exp === "number" && Date.now() >= exp * 1000) {
    console.warn("Auth token is expired");
    return null;
  }

  if (typeof sub !== "string" || typeof email !== "string") {
    console.error("JWT payload is missing required user identifiers");
    return null;
  }

  return {
    id: sub,
    email,
    name: typeof name === "string" ? name : undefined,
    isDevAdmin: Boolean(isDevAdmin),
    devAdminMode: Boolean(devAdminMode),
  };
};

// Toggle dev-admin mode
export const toggleDevAdminMode = async (): Promise<AuthTokens> => {
  try {
    const runtime = getApiRuntime();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    const response = await runtime.transport.request<AuthTokens>({
      method: "PATCH",
      url: "/auth/toggle-dev-admin",
      data: {},
      headers,
      withCredentials: true,
    });

    if (response.data?.accessToken) {
      setAuthToken(response.data.accessToken);
      return response.data;
    }
    throw new Error("Failed to toggle dev-admin mode");
  } catch (error) {
    return handleAxiosError(error, "Toggle dev-admin mode");
  }
};

// An opaque browser-auth generation keeps protected caches scoped to the
// current authorization context without putting credentials into query keys.
let browserAuthRevision = 0;
export const getBrowserAuthRevision = (): number => browserAuthRevision;

// Auth state change subscription functions
const notifyAuthChange = (isAuthenticated: boolean, token: string | null) => {
  browserAuthRevision += 1;
  authChangeListeners.forEach((listener) => {
    try {
      listener(isAuthenticated, token);
    } catch (error) {
      console.error("Error in auth change listener:", error);
    }
  });
};

export const onAuthChange = (listener: AuthChangeListener): (() => void) => {
  authChangeListeners.push(listener);
  // Return unsubscribe function
  return () => {
    const index = authChangeListeners.indexOf(listener);
    if (index > -1) {
      authChangeListeners.splice(index, 1);
    }
  };
};
