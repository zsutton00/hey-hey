import { useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  TriageApplicationCoordinator,
  type TriageApplicationPorts,
} from "../triage/application";

// Like the Open Items adapter, application progress survives page navigation
// within this authenticated query-cache lifetime. It contains no collection.
const owners = new WeakMap<
  QueryClient,
  Map<string, TriageApplicationCoordinator>
>();
export function useTriageApplication(
  ports: TriageApplicationPorts,
  scope: string,
) {
  const queryClient = useQueryClient();
  let scoped = owners.get(queryClient);
  if (!scoped) {
    scoped = new Map();
    owners.set(queryClient, scoped);
  }
  let coordinator = scoped.get(scope);
  if (!coordinator) {
    coordinator = new TriageApplicationCoordinator(ports);
    scoped.set(scope, coordinator);
  }
  coordinator.updatePorts(ports);
  useSyncExternalStore(
    coordinator.subscribe,
    coordinator.snapshot,
    coordinator.snapshot,
  );
  return coordinator;
}
