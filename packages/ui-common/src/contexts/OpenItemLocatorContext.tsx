import React, { createContext, useContext, useMemo, useRef } from "react";
import type { OpenItemEntity } from "../types/openItems";

export interface OpenItemLocateRequest {
  entity: OpenItemEntity;
  /** Display label from the menu context, used for a newly added entry's snapshot. */
  label: string;
  /** Work-item subtype for task entities, used as the snapshot's taskType. */
  taskType?: string;
}

/**
 * Host-owned handler that reveals an entity in Open Items, adding it when the
 * collection does not hold it. The generic entity menu only consumes this
 * handler; it never reads Open Items data itself.
 */
export interface OpenItemLocator {
  showInOpenItems: (request: OpenItemLocateRequest) => void;
}

export interface OpenItemLocatorProviderProps {
  children: React.ReactNode;
  locator: OpenItemLocator;
}

const OpenItemLocatorContext = createContext<OpenItemLocator | null>(null);

export const OpenItemLocatorProvider: React.FC<OpenItemLocatorProviderProps> = ({
  children,
  locator,
}) => {
  const locatorRef = useRef(locator);
  locatorRef.current = locator;

  const stableLocator = useMemo<OpenItemLocator>(
    () => ({
      showInOpenItems: (request) => {
        locatorRef.current.showInOpenItems(request);
      },
    }),
    []
  );

  return (
    <OpenItemLocatorContext.Provider value={stableLocator}>
      {children}
    </OpenItemLocatorContext.Provider>
  );
};

/** Returns the mounted locator, or null when no host provides one. */
export function useOpenItemLocator(): OpenItemLocator | null {
  return useContext(OpenItemLocatorContext);
}
