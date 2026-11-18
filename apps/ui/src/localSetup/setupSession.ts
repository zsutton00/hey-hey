import { useSyncExternalStore } from "react";
import type {
  BrowserAuthResponseDto,
  BrowserSessionResponseDto,
} from "@hey-hey/ui-common/api";
import {
  createAccessToken,
  getApiRuntime,
  type AccessToken,
  type ApiAuthAdapter,
} from "@hey-hey/ui-common/clients";
import {
  diagnosticFailureFacts,
  recordLocalStartupDiagnostic,
} from "@hey-hey/ui-common/services";
import { recordLocalSetupEvent } from "../pages/LocalSetup/localSetupEvents";

/**
 * The one browser session local setup works with. Setup holds it itself, in
 * memory, and changes it only at its own steps: the CLI handoff (or a single
 * cookie restore when the page opened without one), the one renewal after the
 * name is saved, and the replacement session the passkey step returns. Nothing
 * renews it in the background, and a refused request never clears it.
 */

let current: BrowserAuthResponseDto | null = null;
let accessExpiresAt = 0;
let opening: Promise<BrowserAuthResponseDto> | null = null;
const listeners = new Set<() => void>();
const tokenListeners = new Set<(token: AccessToken | null) => void>();

const notify = (): void => {
  const token =
    current === null ? null : createAccessToken(current.accessToken);
  tokenListeners.forEach((listener) => listener(token));
  listeners.forEach((listener) => listener());
};

export const getSetupSession = (): BrowserAuthResponseDto | null => current;

const subscribeToSetupSession = (listener: () => void): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

export const useSetupSession = (): BrowserAuthResponseDto | null =>
  useSyncExternalStore(subscribeToSetupSession, getSetupSession);

/** Adopts a server-issued session. An organization choice carries no access, so setup can't use it. */
export const adoptSetupSession = (
  response: BrowserSessionResponseDto | undefined,
): BrowserAuthResponseDto => {
  if (response === undefined || !("accessToken" in response)) {
    throw new Error("Local browser session did not select its organization.");
  }

  current = response;
  accessExpiresAt = Date.now() + response.expiresIn * 1000;
  notify();

  return response;
};

/** True when there is no session, or its access has lapsed; pairing then refuses to start a passkey. */
export const setupSessionExpired = (): boolean =>
  current === null || Date.now() >= accessExpiresAt;

/** The API client's view of the setup session: requests carry it, and a 401 is reported, never retried. */
export const setupAuthAdapter: ApiAuthAdapter = {
  getAccessToken: () =>
    current === null ? null : createAccessToken(current.accessToken),
  refreshAccessToken: () => Promise.resolve(null),
  onAuthChanged: (listener) => {
    tokenListeners.add(listener);

    return () => {
      tokenListeners.delete(listener);
    };
  },
  onUnauthorized: () => {
    recordLocalSetupEvent("session: a request was refused (401)");
  },
};

/** Renews the setup session once from its refresh cookie, at a step setup chose. */
export const renewSetupSession = async (): Promise<BrowserAuthResponseDto> => {
  const startedAt = performance.now();
  recordLocalStartupDiagnostic("auth_renewal_started");
  try {
    const response = await getApiRuntime().clients.auth.refreshToken();
    const session = adoptSetupSession(response.data.data);
    recordLocalStartupDiagnostic("auth_renewal_succeeded", {
      elapsedMs: performance.now() - startedAt,
    });

    return session;
  } catch (failure: unknown) {
    recordLocalStartupDiagnostic("auth_renewal_failed", {
      ...diagnosticFailureFacts(failure),
      elapsedMs: performance.now() - startedAt,
    });
    throw failure;
  }
};

const exchangeHandoffToken = async (
  handoffToken: string,
): Promise<BrowserAuthResponseDto> => {
  recordLocalSetupEvent("handoff: exchanging the one-use token");
  const response = await getApiRuntime().clients.auth.completeLocalHandoff({
    localHandoffRequestDto: { handoffToken },
  });
  const session = adoptSetupSession(response.data.data);
  recordLocalSetupEvent("handoff: browser session accepted");

  return session;
};

/**
 * Opens the setup session once per page load. The handoff token is single-use
 * and a refresh rotates the cookie, so a remount (React StrictMode in
 * development) shares the one request instead of spending either twice.
 */
export const openSetupSession = (
  handoffToken: string | null,
): Promise<BrowserAuthResponseDto> => {
  opening ??= handoffToken
    ? exchangeHandoffToken(handoffToken)
    : renewSetupSession();

  return opening;
};

/** Test-only: a new page load starts with no setup session. */
export const forgetSetupSession = (): void => {
  current = null;
  accessExpiresAt = 0;
  opening = null;
  notify();
};
