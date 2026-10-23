import type {
  EntityActivationSink,
  OpenItemLocator,
} from "@hey-hey/ui-common/context";
import { useOpenItems as useCanonicalOpenItems } from "@hey-hey/ui-common/data";
import React, { useContext, useMemo } from "react";
import {
  OpenItemsContext,
  type OpenItemsContextValue,
} from "./openItemsContextValue";
import {
  createOpenItemsActions,
  getOpenItemsDisclosure,
} from "./openItemsActions";
import { createOpenItemLocator } from "./openItemLocator";

export const OpenItemsProvider: React.FC<{
  children: React.ReactNode;
  organizationId: string | null;
  projectId: string | null;
  userId: string | null;
}> = ({ children, organizationId, projectId, userId }) => {
  const canonical = useCanonicalOpenItems({
    organizationId: organizationId ?? "",
    projectId: projectId ?? "",
    userId: userId ?? "",
  });
  const { adapter, record } = canonical;
  const scoped = Boolean(organizationId && projectId && userId);
  const actions = useMemo(
    () => createOpenItemsActions(adapter, canonical.refresh, scoped),
    [adapter, canonical.refresh, scoped],
  );
  const value: OpenItemsContextValue = {
    ...actions,
    items: scoped ? record.items : [],
    groups: scoped ? record.groups : [],
    disclosure: getOpenItemsDisclosure(record),
    sortDirection: record.sortDirection ?? "oldest",
    isLoading: canonical.isLoading,
    isFetching: canonical.isFetching,
    stale: canonical.stale,
    offline: canonical.offline,
    pending: canonical.pending,
    queued: canonical.queued,
    error: canonical.error,
  };
  return (
    <OpenItemsContext.Provider value={value}>
      {children}
    </OpenItemsContext.Provider>
  );
};

export const useOpenItems = (): OpenItemsContextValue => {
  const context = useContext(OpenItemsContext);
  if (!context)
    throw new Error("useOpenItems must be used within OpenItemsProvider");
  return context;
};
export const useOpenItemsActivationSink = (): EntityActivationSink => {
  const { activate } = useOpenItems();
  return useMemo(
    () => ({
      onEntityActivated: (activation) => {
        void activate(activation);
      },
    }),
    [activate],
  );
};

export const useOpenItemLocatorHandler = (): OpenItemLocator => {
  const { items, activate } = useOpenItems();
  return useMemo(
    () => createOpenItemLocator(items, activate),
    [items, activate],
  );
};
