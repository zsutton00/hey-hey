import { createContext, useContext } from "react";
import type { ActionsCapsuleContextValue } from "./types";

export const ActionsCapsuleContext = createContext<
  ActionsCapsuleContextValue | undefined
>(undefined);

export const useActionsCapsule = (): ActionsCapsuleContextValue => {
  const context = useContext(ActionsCapsuleContext);
  if (context === undefined) {
    throw new Error(
      "useActionsCapsule must be used within a ActionsCapsuleProvider"
    );
  }
  return context;
};

export const useOptionalActionsCapsule =
  (): ActionsCapsuleContextValue | null => {
    return useContext(ActionsCapsuleContext) ?? null;
  };
