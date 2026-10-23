import { useCallback, useEffect, useMemo } from "react";
import { isAxiosError } from "axios";
import type {
  DemoSandboxResponseDto,
  DemoSandboxResumeState,
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

export type DemoSandboxResumeResult =
  | { outcome: "resumed"; sandbox: DemoSandboxResponseDto }
  | { outcome: "none" | "expired" };

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

export interface UseDemoSandboxAdmissionReturn {
  /**
   * Asks the API whether this browser already has an unexpired sandbox. A
   * returning browser is signed in by the API and skips the terms screen.
   */
  resume: () => Promise<DemoSandboxResumeResult>;
  /** Provisions a sandbox; rejects with a `DemoSandboxProvisionError`. */
  provision: (
    input: ProvisionDemoSandboxDto,
  ) => Promise<DemoSandboxResponseDto>;
}

export function useDemoSandboxAdmission(): UseDemoSandboxAdmissionReturn {
  const resume = useCallback(async (): Promise<DemoSandboxResumeResult> => {
    try {
      const response = await unifiedApiClient.resumeDemoSandbox();
      const sandbox = response.data?.data;
      if (!sandbox) throw new Error("The demo resume response was incomplete.");
      await adoptApiEstablishedSession();
      return { outcome: "resumed", sandbox };
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
    async (input: ProvisionDemoSandboxDto): Promise<DemoSandboxResponseDto> => {
      try {
        const response = await unifiedApiClient.provisionDemoSandbox({
          provisionDemoSandboxDto: input,
        });
        const sandbox = response.data?.data;
        if (!sandbox) {
          throw new Error("The demo provisioning response was incomplete.");
        }
        await adoptApiEstablishedSession();
        return sandbox;
      } catch (error) {
        throw new DemoSandboxProvisionError(toProvisionFailure(error));
      }
    },
    [],
  );

  return { resume, provision };
}
