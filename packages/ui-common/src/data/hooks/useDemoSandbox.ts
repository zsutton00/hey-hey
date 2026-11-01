import { useCallback, useEffect, useMemo } from "react";
import { isAxiosError } from "axios";
import type {
  DemoSandboxAdmissionDto,
  DemoSandboxResponseDto,
  DemoSandboxResumeState,
  DemoSandboxSetupProgressDto,
  DemoSandboxUnavailableCode,
  ProvisionDemoSandboxDto,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { refreshAuthToken } from "../../services/authService";
import { demoSandboxQueryOptions } from "../collections/demoSandbox";
import type { CollectionHookOptions } from "../core/types";
import { markDemoSandboxSession } from "../demoSandboxSession";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

/**
 * How often the banner re-reads the server-reported expiry while the tab is
 * visible. Expiry is never computed locally; this only keeps the displayed
 * value current between focus events.
 */
export const DEMO_SANDBOX_REFETCH_INTERVAL_MS = 5 * 60 * 1000;

export interface UseDemoSandboxOptions extends Pick<
  CollectionHookOptions<DemoSandboxResponseDto | null>,
  "refetchOnMount" | "refetchOnWindowFocus"
> {
  enabled?: boolean;
  /** Keep re-reading the sandbox so the displayed expiry stays current. */
  poll?: boolean;
}

export interface UseDemoSandboxReturn {
  /** The caller's sandbox; `null` once known that the caller is not a demo user. */
  sandbox: DemoSandboxResponseDto | null;
  /** True once the API has answered (sandbox or not-a-demo-user). */
  isReady: boolean;
  isLoading: boolean;
  error: Error | null;
}

export function useDemoSandbox(
  options: UseDemoSandboxOptions = {},
): UseDemoSandboxReturn {
  const { enabled = true, poll = false } = options;
  const queryOptions = useMemo(() => {
    const refetchInterval: number | false =
      enabled && poll ? DEMO_SANDBOX_REFETCH_INTERVAL_MS : false;
    return { ...demoSandboxQueryOptions(), refetchInterval };
  }, [enabled, poll]);
  const { result } = useDataLayerQuery(queryOptions, {
    enabled,
    refetchOnMount: options.refetchOnMount,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
  });

  const isReady = enabled && result.isSuccess;
  const sandbox = isReady ? result.data : null;

  useEffect(() => {
    if (isReady) markDemoSandboxSession(sandbox !== null);
  }, [isReady, sandbox]);

  return {
    sandbox,
    isReady,
    isLoading: enabled && result.isPending,
    error: enabled ? result.error : null,
  };
}

/**
 * Where this browser's demo stands. `ready` means the API has signed the
 * browser in to its sandbox; `provisioning` carries only the setup stage and
 * feature counts.
 */
export type DemoSandboxStatusResult =
  | { outcome: "ready"; sandbox: DemoSandboxResponseDto }
  | { outcome: "provisioning"; progress: DemoSandboxSetupProgressDto }
  | { outcome: "failed" }
  | { outcome: "none" | "expired" };

/** How often the setup screen re-reads progress while a sandbox is being set up. */
export const DEMO_SANDBOX_SETUP_POLL_INTERVAL_MS = 1000;

/** Consecutive failed progress reads after which the visitor is told progress can't be checked. */
export const DEMO_SANDBOX_SETUP_UNREACHABLE_AFTER = 3;

export type DemoSandboxProvisionFailure =
  DemoSandboxUnavailableCode | "STALE_TERMS_VERSION" | "UNKNOWN";

export class DemoSandboxProvisionError extends Error {
  constructor(readonly failure: DemoSandboxProvisionFailure) {
    super(`Demo sandbox could not be started: ${failure}`);
    this.name = "DemoSandboxProvisionError";
  }
}

const RESUME_STATE_OUTCOME: Record<DemoSandboxResumeState, "none" | "expired"> =
  { NONE: "none", EXPIRED: "expired" };

const PROVISION_FAILURE_CODES: readonly DemoSandboxUnavailableCode[] = [
  "DISABLED",
  "AT_CAPACITY",
  "PROVISIONING_FAILED",
  "RATE_LIMITED",
  "BOT_CHECK_FAILED",
];

const toProvisionFailure = (error: unknown): DemoSandboxProvisionFailure => {
  if (!isAxiosError(error)) return "UNKNOWN";
  if (error.response?.status === 409) return "STALE_TERMS_VERSION";
  const code: unknown = error.response?.data?.code;
  return PROVISION_FAILURE_CODES.find((known) => known === code) ?? "UNKNOWN";
};

/**
 * The API signs the visitor in with cookies. The app only treats the browser as
 * signed in after the normal cookie-backed renewal, so run it before routing.
 */
const adoptApiEstablishedSession = async (): Promise<void> => {
  await refreshAuthToken();
  markDemoSandboxSession(true);
};

const toStatusResult = async (
  admission: DemoSandboxAdmissionDto | undefined,
): Promise<DemoSandboxStatusResult> => {
  if (admission?.state === "ACTIVE" && admission.sandbox) {
    await adoptApiEstablishedSession();
    return { outcome: "ready", sandbox: admission.sandbox };
  }
  if (admission?.state === "PROVISIONING" && admission.progress) {
    return { outcome: "provisioning", progress: admission.progress };
  }
  if (admission?.state === "FAILED") return { outcome: "failed" };
  throw new Error("The demo sandbox response was incomplete.");
};

const wait = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

export interface UseDemoSandboxAdmissionReturn {
  /**
   * Asks the API where this browser's demo stands. A returning browser with a
   * ready sandbox is signed in by the API and skips the terms screen.
   */
  resume: () => Promise<DemoSandboxStatusResult>;
  /**
   * Starts a sandbox, returning as soon as it is reserved (or this browser's
   * existing one); rejects with a `DemoSandboxProvisionError`.
   */
  provision: (
    input: ProvisionDemoSandboxDto,
  ) => Promise<DemoSandboxStatusResult>;
  /**
   * Re-reads setup progress about once a second, reporting each update, until
   * the sandbox is ready or setup failed. Reads keep retrying when they fail;
   * `onReachable(false)` reports that progress can't currently be checked and
   * `onReachable(true)` that it can again. Resolves with the final result, or
   * with `none` once `signal` aborts.
   */
  followSetup: (
    onProgress: (progress: DemoSandboxSetupProgressDto) => void,
    onReachable: (reachable: boolean) => void,
    signal: AbortSignal,
  ) => Promise<DemoSandboxStatusResult>;
}

export function useDemoSandboxAdmission(): UseDemoSandboxAdmissionReturn {
  const resume = useCallback(async (): Promise<DemoSandboxStatusResult> => {
    try {
      const response = await unifiedApiClient.resumeDemoSandbox();
      return await toStatusResult(response.data?.data);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        const state: unknown = error.response.data?.data?.state;
        if (state === "EXPIRED" || state === "NONE") {
          return { outcome: RESUME_STATE_OUTCOME[state] };
        }
      }
      throw error;
    }
  }, []);

  const provision = useCallback(
    async (
      input: ProvisionDemoSandboxDto,
    ): Promise<DemoSandboxStatusResult> => {
      let admission: DemoSandboxAdmissionDto | undefined;
      try {
        const response = await unifiedApiClient.provisionDemoSandbox({
          provisionDemoSandboxDto: input,
        });
        admission = response.data?.data;
      } catch (error) {
        throw new DemoSandboxProvisionError(toProvisionFailure(error));
      }
      return toStatusResult(admission);
    },
    [],
  );

  const followSetup = useCallback(
    async (
      onProgress: (progress: DemoSandboxSetupProgressDto) => void,
      onReachable: (reachable: boolean) => void,
      signal: AbortSignal,
    ): Promise<DemoSandboxStatusResult> => {
      let failures = 0;
      for (;;) {
        await wait(DEMO_SANDBOX_SETUP_POLL_INTERVAL_MS, signal);
        if (signal.aborted) return { outcome: "none" };
        let result: DemoSandboxStatusResult;
        try {
          result = await resume();
        } catch {
          // Keep the binding and keep retrying, but say so once reads keep
          // failing: the shown progress may be stale.
          if (signal.aborted) return { outcome: "none" };
          failures += 1;
          if (failures === DEMO_SANDBOX_SETUP_UNREACHABLE_AFTER) {
            onReachable(false);
          }
          continue;
        }
        if (signal.aborted) return { outcome: "none" };
        if (failures >= DEMO_SANDBOX_SETUP_UNREACHABLE_AFTER) onReachable(true);
        failures = 0;
        if (result.outcome !== "provisioning") return result;
        onProgress(result.progress);
      }
    },
    [resume],
  );

  return { resume, provision, followSetup };
}
