import type {
  CliReadError,
  CliReadProviderUsage,
  CliReadProviderUsageLimitWindow,
} from "../../../api";

export type ProviderUsageViewState =
  | { kind: "initial-loading" }
  | { kind: "timeout"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "source-error"; error: CliReadError }
  | { kind: "request-error"; error: Error }
  | { kind: "ready"; providers: CliReadProviderUsage[] };

export interface ResolveProviderUsageViewStateInput {
  providers: CliReadProviderUsage[] | null;
  typedError: CliReadError | null;
  requestError: Error | null;
  isInitialLoading: boolean;
}

export const resolveProviderUsageViewState = ({
  providers,
  typedError,
  requestError,
  isInitialLoading,
}: ResolveProviderUsageViewStateInput): ProviderUsageViewState => {
  if (isInitialLoading && !providers) {
    return { kind: "initial-loading" };
  }
  if (typedError?.code === "TIMEOUT") {
    return { kind: "timeout", message: typedError.message };
  }
  if (
    typedError?.code === "MACHINE_NOT_BOUND" ||
    typedError?.code === "NO_RECIPIENT"
  ) {
    return { kind: "unavailable", message: typedError.message };
  }
  if (typedError) {
    return { kind: "source-error", error: typedError };
  }
  if (requestError) {
    return { kind: "request-error", error: requestError };
  }
  if (!providers) {
    return {
      kind: "unavailable",
      message: "Provider usage is unavailable from the connected CLI.",
    };
  }
  return { kind: "ready", providers };
};

export interface LimitWindowPresentation {
  used: string;
  resets: string;
}

const NOT_REPORTED = "not reported";

/**
 * Returns how much of a fixed usage window has elapsed, or null when its
 * reset time cannot describe a window that is currently in progress.
 */
export const elapsedPercent = (
  resetsAt: string | null | undefined,
  windowHours: number,
  now: number,
): number | null => {
  if (!resetsAt || !Number.isFinite(now) || !Number.isFinite(windowHours)) {
    return null;
  }

  const windowMs = windowHours * 3_600_000;
  const remaining = Date.parse(resetsAt) - now;
  if (
    !Number.isFinite(remaining) ||
    windowMs <= 0 ||
    remaining <= 0 ||
    remaining > windowMs
  ) {
    return null;
  }

  return (1 - remaining / windowMs) * 100;
};

/**
 * Presents one limit window. Null values read "not reported" — never zero —
 * because an unreported reading is not evidence of zero usage.
 */
export const presentLimitWindow = (
  window: CliReadProviderUsageLimitWindow | null,
  formatResetsAt: (timestamp: string) => string,
): LimitWindowPresentation => ({
  used:
    window?.usedPercent === null || window?.usedPercent === undefined
      ? NOT_REPORTED
      : `${Math.round(window.usedPercent)}% used`,
  resets: window?.resetsAt ? formatResetsAt(window.resetsAt) : NOT_REPORTED,
});
