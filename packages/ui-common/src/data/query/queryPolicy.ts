import type { QueryState } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { DEFAULT_STALE_TIME_MS } from "../core/staleTime";

const MAX_TRANSIENT_RETRIES = 3;

export function getResponseStatus(error: unknown): number | undefined {
  if (isAxiosError(error)) return error.response?.status;
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

export function isClientErrorResponse(error: unknown): boolean {
  const status = getResponseStatus(error);
  return status !== undefined && status >= 400 && status < 500;
}

/** A 4xx is the server's answer for that key; only transient failures retry. */
export function retryUnlessClientError(
  failureCount: number,
  error: Error
): boolean {
  return !isClientErrorResponse(error) && failureCount < MAX_TRANSIENT_RETRIES;
}

/**
 * A 4xx answer is a cached result for the query's stale time: a newly mounted
 * observer must not re-request it until then. Invalidation and explicit
 * refetches still reach the server. Pass the result as `retryOnMount`.
 */
export function shouldRetryOnMount(
  state: Pick<QueryState, "status" | "error" | "errorUpdatedAt"> | undefined,
  staleTime: number = dataLayerQueryPolicy.staleTime
): boolean {
  if (state?.status !== "error" || !isClientErrorResponse(state.error)) {
    return true;
  }
  return Date.now() - state.errorUpdatedAt >= staleTime;
}

/**
 * Per-query freshness policy for migrated Data Layer reads. Set on each
 * query's options rather than the shared QueryClient so direct TanStack
 * callers keep the client defaults they were written against.
 *
 * TanStack v5 drives window-focus refetching from `visibilitychange` only, so
 * `refetchOnWindowFocus: true` is the app-resume revalidation: a mounted query
 * re-reads when the page becomes visible and only if it is past `staleTime`.
 * Turning it off would also turn off resume revalidation.
 */
export const dataLayerQueryPolicy = {
  staleTime: DEFAULT_STALE_TIME_MS,
  refetchOnWindowFocus: true,
  retry: retryUnlessClientError,
} as const;
