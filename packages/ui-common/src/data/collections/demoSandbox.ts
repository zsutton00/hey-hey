import { queryOptions } from "@tanstack/react-query";
import type { DemoSandboxResponseDto } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy, getResponseStatus } from "../query/queryPolicy";

/** The signed-in caller's demo sandbox: one key per signed-in client. */
export const demoSandboxKeys = {
  root: () => ["demoSandbox"] as const,
  current: () => [...demoSandboxKeys.root(), "current"] as const,
};

/**
 * Reads the caller's sandbox. The API answers 404 for callers who are not demo
 * users; that is a normal result (`null`), not a failure.
 */
export function demoSandboxQueryOptions() {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: demoSandboxKeys.current(),
    queryFn: async ({ signal }): Promise<DemoSandboxResponseDto | null> => {
      try {
        const response = await unifiedApiClient.getCurrentDemoSandbox({
          ...captureRequestOptions(),
          signal,
        });
        const sandbox = response.data?.data;
        if (!sandbox) {
          throw new Error("The demo sandbox response was incomplete.");
        }
        return sandbox;
      } catch (error) {
        if (getResponseStatus(error) === 404) return null;
        throw error;
      }
    },
  });
}
