import type { ReactNode } from "react";
import { useRef } from "react";

import type { ApiRuntime } from "./createApiRuntime";
import {
  initializeBrowserApiRuntime,
  type InitializeBrowserRuntimeOptions,
  registerApiRuntime,
} from "./runtime";
import { browserApiAuthAdapter } from "../services/authService";

export interface WebClientProviderProps
  extends InitializeBrowserRuntimeOptions {
  children: ReactNode;
  runtime?: ApiRuntime;
}

/**
 * Registers the API runtime once so tests and lightweight apps can safely
 * render hooks/services that rely on {@link apiClient} without running the full
 * playground bootstrap.
 */
export const WebClientProvider = ({
  children,
  runtime,
  ...initializeOptions
}: WebClientProviderProps) => {
  const initializedRef = useRef(false);

  if (!initializedRef.current) {
    if (runtime) {
      registerApiRuntime(runtime);
    } else {
      const hasExplicitLegacyTokenRefresh = Boolean(
        initializeOptions.refreshAuthToken
      );
      initializeBrowserApiRuntime({
        ...initializeOptions,
        authAdapter:
          initializeOptions.authAdapter ??
          (hasExplicitLegacyTokenRefresh ? undefined : browserApiAuthAdapter),
      });
    }

    initializedRef.current = true;
  }

  return <>{children}</>;
};
