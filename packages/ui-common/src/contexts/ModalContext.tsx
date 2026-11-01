import React, { createContext, useContext, useMemo } from "react";
import type { ModalConfig } from "./types/modalTypes";
import type { PersistentModalRequest } from "./types/persistentModalRequest";
import { modalDomain, type ModalInstance } from "../state/modalDomain";
export type { ModalInstance } from "../state/modalDomain";
export interface ModalContextValue {
  currentModal: ModalConfig | PersistentModalRequest | null;
  modalInstances: readonly ModalInstance[];
  openModal: (config: ModalConfig | PersistentModalRequest) => void;
  closeModal: (instanceId?: string) => void;
}
const ModalContext = createContext<ModalContextValue | null>(null);
export interface ModalProviderProps {
  children: React.ReactNode;
}
function ModalContextBridge({ children }: ModalProviderProps) {
  const instances = modalDomain.useSelector((state) => state.instances);
  const openModal = modalDomain.useSelector((state) => state.open);
  const closeModal = modalDomain.useSelector((state) => state.acceptedClose);
  const value = useMemo(
    () => ({
      currentModal: instances.at(-1)?.config ?? null,
      modalInstances: instances,
      openModal,
      closeModal,
    }),
    [instances, openModal, closeModal],
  );
  return (
    <ModalContext.Provider value={value}>{children}</ModalContext.Provider>
  );
}
export function ModalProvider({ children }: ModalProviderProps) {
  return (
    <modalDomain.Provider>
      <ModalContextBridge>{children}</ModalContextBridge>
    </modalDomain.Provider>
  );
}
export function useModal() {
  return useContext(ModalContext);
}
