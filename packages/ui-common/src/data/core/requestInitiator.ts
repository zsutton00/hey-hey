import type { AxiosInstance, AxiosRequestConfig } from "axios";
import {
  captureInitiator,
  isInitiatorTrackingEnabled,
} from "./initiatorContext";
import { resolveInitiator } from "./resolveInitiator";

declare module "axios" {
  interface AxiosRequestConfig {
    /** Local diagnostic metadata. Never sent as a header or request payload. */
    requestInitiator?: string;
  }
}

/** Explicit options survive awaits, retries, and concurrent collection reads. */
export function initiatorRequestOptions(
  initiator: string | undefined
): AxiosRequestConfig {
  return initiator ? { requestInitiator: initiator } : {};
}

export function captureRequestOptions(): AxiosRequestConfig {
  return initiatorRequestOptions(captureInitiator());
}

const instrumentedTransports = new WeakSet<AxiosInstance>();

export function installRequestInitiatorTracking(axios: AxiosInstance): void {
  if (instrumentedTransports.has(axios)) return;
  instrumentedTransports.add(axios);
  axios.interceptors.request.use(async (config) => {
    if (!isInitiatorTrackingEnabled() || !config.requestInitiator)
      return config;
    const from = await resolveInitiator(config.requestInitiator);
    // The flag may have changed while a source map was loading.
    if (from && isInitiatorTrackingEnabled()) {
      if (config.params instanceof URLSearchParams) {
        const params = new URLSearchParams(config.params);
        params.set("_from", from);
        config.params = params;
      } else {
        config.params = { ...config.params, _from: from };
      }
    }
    return config;
  });
}
