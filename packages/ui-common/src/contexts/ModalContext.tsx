import React, {
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
} from "react";
import type { ModalConfig } from "./types/modalTypes";
import { restoreModalWork } from "../components/Modals/modalWorkRegistry";

export interface ModalInstance {
  id: string;
  config: ModalConfig;
}

export interface ModalContextValue {
  currentModal: ModalConfig | null;
  modalInstances: readonly ModalInstance[];
  openModal: (config: ModalConfig) => void;
  closeModal: (instanceId?: string) => void;
}

const ModalContext = createContext<ModalContextValue | null>(null);
export interface ModalProviderProps {
  children: React.ReactNode;
}

// Callback identity does not identify a new document/search. Keep the original
// configuration and callbacks with an existing draft until it actually closes.
const configIdentity = (config: ModalConfig) =>
  JSON.stringify(config, (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        )
      : value,
  );

export function ModalProvider({
  children,
}: ModalProviderProps): React.ReactElement {
  const ownerId = useId();
  const sequence = useRef(0);
  const [instances, setInstances] = useState<readonly ModalInstance[]>([]);
  const instancesRef = useRef(instances);
  instancesRef.current = instances;
  const openModal = useCallback(
    (config: ModalConfig) => {
      const existing = instancesRef.current.find(
        (item) => configIdentity(item.config) === configIdentity(config),
      );
      if (existing) {
        restoreModalWork(existing.id);
        return;
      }
      const instance = { id: `${ownerId}-${++sequence.current}`, config };
      instancesRef.current = [...instancesRef.current, instance];
      setInstances(instancesRef.current);
    },
    [ownerId],
  );
  const closeModal = useCallback((instanceId?: string) => {
    const closing = instanceId ?? instancesRef.current.at(-1)?.id;
    instancesRef.current = instancesRef.current.filter(
      (item) => item.id !== closing,
    );
    setInstances(instancesRef.current);
  }, []);
  const value = React.useMemo<ModalContextValue>(
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

export function useModal(): ModalContextValue | null {
  return useContext(ModalContext);
}
