import { createStore } from "zustand/vanilla";
import { createUiDomain } from "./createUiDomain";
import type { ModalConfig } from "../contexts/types/modalTypes";
import {
  copyPersistentModalRequest,
  persistentModalIdentity,
  type PersistentModalRequest,
} from "../contexts/types/persistentModalRequest";

export interface ModalInstance {
  id: string;
  config: ModalConfig | PersistentModalRequest;
  persistent: boolean;
  minimized: boolean;
  title: string;
}
interface ModalState {
  instances: readonly ModalInstance[];
  open: (config: ModalConfig | PersistentModalRequest) => void;
  minimize: (id: string, title: string) => void;
  restore: (id: string) => void;
  acceptedClose: (id?: string) => void;
}
export function createModalStore() {
  let sequence = 0;
  return createStore<ModalState>((set, get) => ({
    instances: [],
    open(config) {
      const discriminator = Object.getOwnPropertyDescriptor(config, "type");
      if (!discriminator || !("value" in discriminator))
        throw new Error("Invalid modal opening request");
      const request = copyPersistentModalRequest(config);
      const existing =
        request &&
        get().instances.find((item) => {
          const current = copyPersistentModalRequest(item.config);
          return (
            current &&
            persistentModalIdentity(current) ===
              persistentModalIdentity(request)
          );
        });
      if (existing) {
        get().restore(existing.id);
        return;
      }
      if (
        !request &&
        ["discuss", "triage", "preview"].includes(discriminator.value)
      )
        throw new Error("Invalid persistent modal opening request");
      set((state) => ({
        instances: [
          ...state.instances,
          {
            id: `modal-${++sequence}`,
            config: request ?? config,
            persistent: request !== null,
            minimized: false,
            title: "Dialog",
          },
        ],
      }));
    },
    minimize(id, title) {
      set((state) => ({
        instances: state.instances.map((item) =>
          item.id === id && item.persistent
            ? { ...item, minimized: true, title }
            : item,
        ),
      }));
    },
    restore(id) {
      set((state) => ({
        instances: state.instances.map((item) =>
          item.id === id ? { ...item, minimized: false } : item,
        ),
      }));
    },
    acceptedClose(id) {
      set((state) => ({
        instances: state.instances.filter(
          (item) => item.id !== (id ?? state.instances.at(-1)?.id),
        ),
      }));
    },
  }));
}
export const modalDomain = createUiDomain(createModalStore);
