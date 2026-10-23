import React, { createContext, useContext, useState, useCallback } from "react";

export enum WalkthroughType {
  INITIATIVE_EDITOR = "initiative-editor",
  ONBOARDING = "onboarding",
  DESIGN_DOC_EDITOR = "design-doc-editor",
}

interface WalkthroughTriggers {
  [key: string]: boolean;
}

interface WalkthroughContextValue {
  /** Trigger a specific walkthrough by type */
  triggerWalkthrough: (type: WalkthroughType) => void;
  /** Check if a walkthrough is currently triggered */
  isTriggered: (type: WalkthroughType) => boolean;
  /** Clear a walkthrough trigger */
  clearTrigger: (type: WalkthroughType) => void;
}

const WalkthroughContext = createContext<WalkthroughContextValue | undefined>(
  undefined
);

export interface WalkthroughProviderProps {
  children: React.ReactNode;
}

export const WalkthroughProvider: React.FC<WalkthroughProviderProps> = ({
  children,
}) => {
  const [triggers, setTriggers] = useState<WalkthroughTriggers>({});

  const triggerWalkthrough = useCallback((type: WalkthroughType) => {
    setTriggers((prev) => ({ ...prev, [type]: true }));

    // Auto-clear trigger after a brief delay to reset state
    setTimeout(() => {
      setTriggers((prev) => ({ ...prev, [type]: false }));
    }, 100);
  }, []);

  const isTriggered = useCallback(
    (type: WalkthroughType): boolean => {
      return triggers[type] || false;
    },
    [triggers]
  );

  const clearTrigger = useCallback((type: WalkthroughType) => {
    setTriggers((prev) => ({ ...prev, [type]: false }));
  }, []);

  const value: WalkthroughContextValue = {
    triggerWalkthrough,
    isTriggered,
    clearTrigger,
  };

  return (
    <WalkthroughContext.Provider value={value}>
      {children}
    </WalkthroughContext.Provider>
  );
};

export const useWalkthroughContext = (): WalkthroughContextValue => {
  const context = useContext(WalkthroughContext);
  if (context === undefined) {
    throw new Error(
      "useWalkthroughContext must be used within a WalkthroughProvider"
    );
  }
  return context;
};

/** Optional version that doesn't throw an error when context is missing */
export const useOptionalWalkthroughContext =
  (): WalkthroughContextValue | null => {
    const context = useContext(WalkthroughContext);
    return context || null;
  };
