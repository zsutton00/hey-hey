import React, { useCallback, useState } from "react";
import { ActionsCapsuleContext } from "./ActionsCapsuleContext";
import type {
  ActionsCapsuleContextValue,
  CapsuleActionRegistration,
} from "./types";

export interface ActionsCapsuleProviderProps {
  children: React.ReactNode;
}

/**
 * Provider component that manages ActionsCapsule state and action registration
 */
export const ActionsCapsuleProvider: React.FC<ActionsCapsuleProviderProps> = ({
  children,
}) => {
  const [actionsMap, setActionsMap] = useState<
    Map<string, CapsuleActionRegistration>
  >(new Map());
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [activeMenuItemId, setActiveMenuItemId] = useState<string | null>(null);
  const [isFullSize, setIsFullSize] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isMinimized, setIsMinimized] = useState<boolean>(() => {
    return localStorage.getItem("capsule-minimized") === "true";
  });

  const registerAction = useCallback(
    (action: CapsuleActionRegistration): void => {
      setActionsMap((prev) => {
        const next = new Map(prev);
        next.set(action.id, action);
        return next;
      });
    },
    []
  );

  const unregisterAction = useCallback((id: string): void => {
    setActionsMap((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });

    // If the unregistered action was active, close it
    setActiveActionId((current) => (current === id ? null : current));
  }, []);

  const expandAction = useCallback((id: string, menuItemId?: string): void => {
    setActiveActionId(id);
    setActiveMenuItemId(menuItemId ?? null);
  }, []);

  const setActiveMenuItem = useCallback((menuItemId: string | null): void => {
    setActiveMenuItemId(menuItemId);
  }, []);

  const collapseAction = useCallback((): void => {
    setActiveActionId(null);
    setActiveMenuItemId(null);
    setIsFullSize(false);
  }, []);

  const toggleFullSize = useCallback((): void => {
    setIsFullSize((prev) => !prev);
  }, []);

  const toggleMinimize = useCallback((): void => {
    setIsMinimized((prev) => {
      const next = !prev;
      localStorage.setItem("capsule-minimized", String(next));
      if (next) {
        // Collapse any expanded action when minimizing
        setActiveActionId(null);
        setActiveMenuItemId(null);
        setIsFullSize(false);
      }
      return next;
    });
  }, []);

  // Memoize the actions array to prevent unnecessary re-renders
  const actions = React.useMemo(
    () => Array.from(actionsMap.values()),
    [actionsMap]
  );

  // CRITICAL: Memoize the context value to prevent infinite re-render loops.
  // Without this, every state update creates a new value object, causing all
  // consumers to re-render, which can trigger more registrations, leading to
  // infinite loops. All dependencies must be stable (primitives or memoized).
  const value: ActionsCapsuleContextValue = React.useMemo(
    () => ({
      actions,
      activeActionId,
      activeMenuItemId,
      isFullSize,
      isMinimized,
      registerAction,
      unregisterAction,
      expandAction,
      collapseAction,
      setActiveMenuItem,
      toggleFullSize,
      toggleMinimize,
      searchQuery,
      setSearchQuery,
    }),
    [
      actions,
      activeActionId,
      activeMenuItemId,
      isFullSize,
      isMinimized,
      registerAction,
      unregisterAction,
      expandAction,
      collapseAction,
      setActiveMenuItem,
      toggleFullSize,
      toggleMinimize,
      searchQuery,
      setSearchQuery,
    ]
  );

  return (
    <ActionsCapsuleContext.Provider value={value}>
      {children}
    </ActionsCapsuleContext.Provider>
  );
};
