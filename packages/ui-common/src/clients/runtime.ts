import type { UnifiedApiClient } from "./serviceClients";
import {
  createBrowserApiRuntime,
  type BrowserRuntimeOptions,
} from "./createApiRuntime";
import { configService } from "../services/configService";

import { registerApiRuntime } from "./runtimeRegistry";
export * from "./runtimeRegistry";

export interface InitializeBrowserRuntimeOptions extends Partial<
  Omit<BrowserRuntimeOptions, "baseUrl">
> {
  baseUrl?: string;
}

export const initializeBrowserApiRuntime = (
  options: InitializeBrowserRuntimeOptions = {},
): UnifiedApiClient => {
  const baseUrl = options.baseUrl ?? configService.getApiBaseUrl();
  const runtime = createBrowserApiRuntime({
    baseUrl,
    authAdapter: options.authAdapter,
    refreshAuthToken: options.refreshAuthToken,
    onUnauthorized: options.onUnauthorized,
  });
  return registerApiRuntime(runtime);
};
