import type { PropsWithChildren } from "react";
import { useRef } from "react";
import { Provider as JotaiProvider, createStore } from "jotai";
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from "@tanstack/react-query";
import { initRelationshipConfig } from "./relationships";
import { ControllerAuthorizationPromptHost } from "./controllerAuthorization/controllerAuthorizationPrompt";

type JotaiStore = ReturnType<typeof createStore>;

export interface DataHooksProviderProps extends PropsWithChildren {
  store?: JotaiStore;
  queryClient?: QueryClient;
  queryClientConfig?: QueryClientConfig;
  /**
   * Raw relationship-invalidation rules (the validated `InvalidationConfig`
   * shape). When supplied, the provider initializes the relationship config
   * synchronously before its first render so every descendant data hook sees
   * a loaded config on first read. Non-React consumers (CLI bootstraps)
   * should call `initRelationshipConfig` directly instead.
   */
  relationshipRules?: unknown;
}

/**
 * Convenience provider for consumers using data hooks from this package.
 * It wires Jotai and React Query providers with stable defaults.
 */
export const DataHooksProvider = ({
  children,
  store,
  queryClient,
  queryClientConfig,
  relationshipRules,
}: DataHooksProviderProps) => {
  const relationshipInitRef = useRef(false);
  if (!relationshipInitRef.current && relationshipRules !== undefined) {
    initRelationshipConfig(relationshipRules);
    relationshipInitRef.current = true;
  }

  const defaultStoreRef = useRef<JotaiStore | null>(null);
  if (!defaultStoreRef.current) {
    defaultStoreRef.current = createStore();
  }

  const defaultQueryClientRef = useRef<QueryClient | null>(null);
  if (!defaultQueryClientRef.current) {
    defaultQueryClientRef.current = new QueryClient(queryClientConfig);
  }

  const resolvedStore = store ?? defaultStoreRef.current;
  const resolvedQueryClient = queryClient ?? defaultQueryClientRef.current;

  return (
    <JotaiProvider store={resolvedStore}>
      <QueryClientProvider client={resolvedQueryClient}>
        {children}
        <ControllerAuthorizationPromptHost />
      </QueryClientProvider>
    </JotaiProvider>
  );
};
