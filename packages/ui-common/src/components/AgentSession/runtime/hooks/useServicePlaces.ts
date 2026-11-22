import { useEffect, useMemo, useState } from "react";
import type {
  CliReadServicePlacesEntry,
  CliReadServicePlacesOkEntry,
  RecentServicePlaceBranch,
} from "../../../../api";
import {
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
} from "../../../../api";
import { agentSessionsClient } from "../../../../clients";
import { useUserPairedMachines } from "../../../../data/hooks/useUserPairedMachines";
import { executeControllerAuthorizedAction } from "../../../../data/hooks/useControllerAuthorizedAction";

export const BRANCH_SEARCH_DEBOUNCE_MS = 300;

export type ServicePlacesEntry =
  | {
      status: "ready";
      mainFolder: CliReadServicePlacesOkEntry["mainFolder"];
      worktrees: CliReadServicePlacesOkEntry["worktrees"];
      recentBranches: readonly RecentServicePlaceBranch[];
      /** Branches matching the current search; empty until the user types. */
      branchMatches: readonly string[];
      branchMatchesTruncated: boolean;
    }
  | { status: "error"; message: string };

export type ServicePlacesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | {
      status: "ready";
      byServiceId: Readonly<Record<string, ServicePlacesEntry>>;
      /** True while a branch search is in flight. */
      searching: boolean;
      /** Set when the latest branch search failed; null otherwise. */
      searchError: string | null;
    };

export interface UseServicePlacesOptions {
  enabled: boolean;
  organizationId: string;
  projectId: string;
  machineId: string;
  serviceIds: readonly string[];
  /** Raw search text; the hook debounces it before reading. */
  branchQuery?: string;
}

interface PlacesRead {
  entries: ReadonlyMap<string, CliReadServicePlacesEntry>;
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : "Where this Service can work could not be loaded.";

const useDebouncedValue = (value: string, delayMs: number): string => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);

    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
};

export function useServicePlaces(
  options: UseServicePlacesOptions,
): ServicePlacesState {
  const { enabled, organizationId, projectId, machineId, serviceIds } = options;
  const serviceKey = serviceIds.join(",");
  const query = useDebouncedValue(
    (options.branchQuery ?? "").trim(),
    BRANCH_SEARCH_DEBOUNCE_MS,
  );
  const machinesQuery = useUserPairedMachines({ enabled });
  const machine = machinesQuery.machines.find(
    (candidate) => candidate.machineId === machineId,
  );

  const [base, setBase] = useState<
    | { status: "loading" }
    | { status: "unavailable"; message: string }
    | { status: "ready"; read: PlacesRead }
  >({ status: "loading" });
  const [recent, setRecent] = useState<
    ReadonlyMap<string, readonly RecentServicePlaceBranch[]>
  >(new Map());
  const [search, setSearch] = useState<
    | { query: string; status: "pending" }
    | { query: string; status: "done"; read: PlacesRead }
    | { query: string; status: "failed"; message: string }
    | null
  >(null);

  const readPlaces = useMemo(() => {
    if (!machine) {
      return null;
    }

    return async (branchQuery?: string): Promise<PlacesRead> => {
      const ids = serviceKey.split(",");
      const authorized = await executeControllerAuthorizedAction({
        organizationId,
        projectId,
        machine,
        action: {
          requestId: crypto.randomUUID(),
          actionCategory: HostActionCategory.CliRead,
          actionType: HostAffectingActionType.CliRead,
          targetKind: HostActionTargetKind.CliRead,
          targetId: machineId,
          serviceIds: ids,
          ...(branchQuery ? { branchQuery } : {}),
        },
        submit: ({ authorization }) =>
          agentSessionsClient.listMachineServicePlaces({
            organizationId,
            projectId,
            machineId,
            cliReadWorkspaceServicePlacesListRequest: {
              operation: "workspace.service_places.list",
              serviceIds: ids,
              ...(branchQuery ? { branchQuery } : {}),
              authorization,
            },
          }),
      });

      if (authorized.outcome === "DENIED") {
        throw new Error(
          `Controller authorization denied: ${authorized.reason}`,
        );
      }

      const response = authorized.data.data.data;
      if (!response) {
        throw new Error("The Service places read returned no result.");
      }
      if (response.status === "error") {
        throw new Error(response.error.message);
      }

      return {
        entries: new Map(
          response.result.services.map((entry) => [entry.serviceId, entry]),
        ),
      };
    };
  }, [machine, machineId, organizationId, projectId, serviceKey]);

  useEffect(() => {
    if (!enabled || serviceIds.length === 0) {
      return;
    }

    let isCurrent = true;
    setRecent(new Map());
    void agentSessionsClient
      .listRecentServicePlaces({
        organizationId,
        projectId,
        serviceIds: [...serviceIds],
      })
      .then((response) => {
        if (!isCurrent) {
          return;
        }
        setRecent(
          new Map(
            (response.data.data?.services ?? []).map((entry) => [
              entry.serviceId,
              entry.branches,
            ]),
          ),
        );
      })
      .catch((error: unknown) => {
        // Recent branches are a convenience; the list still works without them.
        console.warn("Recent Service branches could not be loaded", error);
      });

    return () => {
      isCurrent = false;
    };
    // serviceKey stands in for the serviceIds array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, organizationId, projectId, serviceKey]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (machinesQuery.isLoading || !machinesQuery.isFetched) {
      setBase({ status: "loading" });
      return;
    }
    if (!readPlaces) {
      setBase({
        status: "unavailable",
        message: machinesQuery.error
          ? "The execution machine is unavailable."
          : "The selected machine is unavailable.",
      });
      return;
    }

    let isCurrent = true;
    setBase({ status: "loading" });
    setSearch(null);
    readPlaces()
      .then((read) => {
        if (isCurrent) {
          setBase({ status: "ready", read });
        }
      })
      .catch((error: unknown) => {
        console.warn("Service places could not be read", error);
        if (isCurrent) {
          setBase({ status: "unavailable", message: getErrorMessage(error) });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [
    enabled,
    machinesQuery.error,
    machinesQuery.isFetched,
    machinesQuery.isLoading,
    readPlaces,
  ]);

  useEffect(() => {
    if (!enabled || !readPlaces || base.status !== "ready") {
      return;
    }
    if (query === "") {
      setSearch(null);
      return;
    }

    let isCurrent = true;
    setSearch({ query, status: "pending" });
    readPlaces(query)
      .then((read) => {
        if (isCurrent) {
          setSearch({ query, status: "done", read });
        }
      })
      .catch((error: unknown) => {
        console.warn("Branch search could not be read", error);
        if (isCurrent) {
          setSearch({
            query,
            status: "failed",
            message: getErrorMessage(error),
          });
        }
      });

    return () => {
      isCurrent = false;
    };
    // Re-search only when the text or the read target changes, not on base data.
  }, [enabled, query, readPlaces, base.status]);

  return useMemo<ServicePlacesState>(() => {
    if (!enabled) {
      return { status: "idle" };
    }
    if (base.status !== "ready") {
      return base;
    }

    const searchRead = search?.status === "done" ? search.read : null;
    const byServiceId: Record<string, ServicePlacesEntry> = {};
    for (const [serviceId, entry] of base.read.entries) {
      if (entry.status === "error") {
        byServiceId[serviceId] = { status: "error", message: entry.message };
        continue;
      }

      const searched = searchRead?.entries.get(serviceId);
      const matches = searched?.status === "ok" ? searched : null;
      byServiceId[serviceId] = {
        status: "ready",
        mainFolder: entry.mainFolder,
        worktrees: entry.worktrees,
        recentBranches: recent.get(serviceId) ?? [],
        branchMatches: matches?.branchMatches ?? [],
        branchMatchesTruncated: matches?.branchMatchesTruncated ?? false,
      };
    }

    return {
      status: "ready",
      byServiceId,
      searching: search?.status === "pending",
      searchError: search?.status === "failed" ? search.message : null,
    };
  }, [enabled, base, search, recent]);
}
