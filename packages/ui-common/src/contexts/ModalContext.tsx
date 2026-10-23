import React, { createContext, useContext, useState } from "react";
import type { ModalConfig } from "./types/modalTypes";

export interface ModalContextValue {
  /**
   * Currently open modal configuration, or null if no modal is open
   */
  currentModal: ModalConfig | null;
  /**
   * Open a modal with the given configuration
   */
  openModal: (config: ModalConfig) => void;
  /**
   * Close the currently open modal
   */
  closeModal: () => void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

export interface ModalProviderProps {
  children: React.ReactNode;
}

/**
 * Provider for generic modal management
 *
 * Stores the currently open modal configuration in context state.
 * Only ONE modal can be open at a time.
 */
export function ModalProvider({
  children,
}: ModalProviderProps): React.ReactElement {
  const [currentModal, setCurrentModal] = useState<ModalConfig | null>(null);

  const value: ModalContextValue = {
    currentModal,
    openModal: (config: ModalConfig) => {
      setCurrentModal(config);
    },
    closeModal: () => {
      setCurrentModal(null);
    },
  };

  return (
    <ModalContext.Provider value={value}>{children}</ModalContext.Provider>
  );
}

/**
 * Hook to access modal functionality
 *
 * Returns null if ModalProvider is not in the component tree.
 * Components should check if the context is available before using it.
 */
export function useModal(): ModalContextValue | null {
  return useContext(ModalContext);
}
