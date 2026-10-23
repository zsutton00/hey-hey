import type { ApiRuntime } from "./createApiRuntime";
import {
  createUnifiedApiClient,
  registerRuntimeClients,
  registerRuntimeUnifiedClient,
  UnifiedApiClient,
} from "./serviceClients";

let currentRuntime: ApiRuntime | null = null;
let currentClient: UnifiedApiClient | null = null;
const runtimeListeners = new Set<
  (runtime: ApiRuntime, client: UnifiedApiClient) => void
>();

export const registerApiRuntime = (runtime: ApiRuntime): UnifiedApiClient => {
  currentRuntime = runtime;
  currentClient = createUnifiedApiClient(runtime);
  registerRuntimeClients(runtime.clients);
  registerRuntimeUnifiedClient(currentClient);
  runtimeListeners.forEach((listener) => listener(runtime, currentClient!));
  return currentClient;
};

export const getApiRuntime = (): ApiRuntime => {
  if (!currentRuntime) {
    throw new Error(
      "API runtime has not been registered. Call initializeBrowserApiRuntime or registerApiRuntime first.",
    );
  }
  return currentRuntime;
};

export const getApiClient = (): UnifiedApiClient => {
  if (!currentClient) {
    throw new Error(
      "API runtime has not been registered. Call initializeBrowserApiRuntime or registerApiRuntime first.",
    );
  }
  return currentClient;
};

export const apiClient: UnifiedApiClient = new Proxy({} as UnifiedApiClient, {
  get(_target, property, receiver) {
    const client = getApiClient();
    const value = (client as unknown as Record<PropertyKey, unknown>)[property];
    if (typeof value === "function") {
      return value.bind(client);
    }
    return Reflect.get(client as unknown as object, property, receiver);
  },
});
