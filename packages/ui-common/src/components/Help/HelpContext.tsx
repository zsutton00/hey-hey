import React, {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type { HelpCapabilities } from "./helpCapabilities";

const HelpContext = createContext<HelpCapabilities | null>(null);

export interface HelpProviderProps {
  capabilities: HelpCapabilities;
  children: ReactNode;
}

export const HelpProvider: React.FC<HelpProviderProps> = ({
  capabilities,
  children,
}) => {
  const value = useMemo(() => capabilities, [capabilities]);
  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
};

/**
 * Returns the injected help capabilities. Throws outside a HelpProvider so
 * missing providers surface immediately rather than failing silently on a
 * null capability later.
 */
export const useHelp = (): HelpCapabilities => {
  const ctx = useContext(HelpContext);
  if (!ctx) {
    throw new Error("useHelp must be used within a HelpProvider");
  }
  return ctx;
};

/**
 * Returns the injected help capabilities, or null when no HelpProvider is
 * present. Use this in components that can function without help data.
 */
export const useOptionalHelp = (): HelpCapabilities | null => {
  return useContext(HelpContext);
};
