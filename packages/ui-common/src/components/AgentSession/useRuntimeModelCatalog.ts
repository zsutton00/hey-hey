import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  fetchRuntimeModelCatalog,
  type RuntimeModelCatalogParams,
} from "../../data/collections/runtimeModelCatalog";
import {
  activateCapabilityCatalogMachine,
  getCapabilityCatalogLoadState,
  parseRuntimeCapabilityCatalog,
  setMachineCapabilityCatalogState,
  subscribeCapabilityCatalog,
  type CapabilityCatalogLoadState,
} from "./capabilityCatalog";

/** Which CLI to ask: the one on the machine picked in the surface. */
export type RuntimeModelCatalogSource = RuntimeModelCatalogParams;

const inFlightLoads = new Map<string, Promise<void>>();

const describeFailure = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : "The model catalog request failed for an unknown reason.";

const readCatalogFromCli = async (
  source: RuntimeModelCatalogSource,
): Promise<CapabilityCatalogLoadState> => {
  try {
    const { response } = await fetchRuntimeModelCatalog(source);
    if (response.status !== "success") {
      return { status: "error", error: response.error.message };
    }
    return {
      status: "ready",
      catalog: parseRuntimeCapabilityCatalog(response.result).providers,
    };
  } catch (error) {
    return { status: "error", error: describeFailure(error) };
  }
};

/**
 * The only place the UI asks a CLI for its model catalog. Requests for one
 * machine are shared while in flight; a failure is kept as that machine's
 * state and is shown, never replaced by a built-in list.
 */
const loadMachineCatalog = (
  source: RuntimeModelCatalogSource,
): Promise<void> => {
  const existing = inFlightLoads.get(source.machineId);
  if (existing) {
    return existing;
  }
  setMachineCapabilityCatalogState(source.machineId, { status: "loading" });
  const load = readCatalogFromCli(source)
    .then((state) => {
      setMachineCapabilityCatalogState(source.machineId, state);
    })
    .finally(() => {
      inFlightLoads.delete(source.machineId);
    });
  inFlightLoads.set(source.machineId, load);
  return load;
};

/**
 * The model catalog of the CLI on `source.machineId`, requested when a surface
 * first needs it. `null` (no machine picked yet) yields an idle state: nothing
 * is requested and nothing is offered.
 *
 * A ready catalog is kept for the lifetime of the page; a failed one is
 * requested again the next time a surface needs it.
 */
export const useRuntimeModelCatalog = (
  source: RuntimeModelCatalogSource | null,
): CapabilityCatalogLoadState => {
  const machineId = source?.machineId ?? null;
  const state = useSyncExternalStore(
    subscribeCapabilityCatalog,
    () => getCapabilityCatalogLoadState(machineId),
    () => getCapabilityCatalogLoadState(machineId),
  );
  // The synchronous catalog helpers answer from the machine this surface
  // addresses, so it must be active before they are read during this render.
  activateCapabilityCatalogMachine(machineId);

  // Requested when the surface mounts or its machine changes, not on every
  // state change: a failure stays shown instead of being retried in a loop.
  const statusRef = useRef(state.status);
  statusRef.current = state.status;
  const organizationId = source?.organizationId;
  const projectId = source?.projectId;
  useEffect(() => {
    if (!organizationId || !projectId || !machineId) {
      return;
    }
    if (statusRef.current === "idle" || statusRef.current === "error") {
      void loadMachineCatalog({ organizationId, projectId, machineId });
    }
  }, [organizationId, projectId, machineId]);

  return state;
};
