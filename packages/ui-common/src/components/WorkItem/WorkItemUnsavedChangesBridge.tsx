import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

interface WorkItemUnsavedChangesContextValue {
  hasUnsavedChanges: boolean;
  save: () => Promise<boolean>;
  discard: () => void;
  register: (snapshot: WorkItemUnsavedSnapshot) => void;
}

interface WorkItemUnsavedSnapshot {
  hasUnsavedChanges: boolean;
  save: () => Promise<boolean>;
  discard: () => void;
}

const WorkItemUnsavedChangesContext =
  createContext<WorkItemUnsavedChangesContextValue | null>(null);

export const WorkItemUnsavedChangesBridge: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const saveRef = useRef<() => Promise<boolean>>(async () => true);
  const discardRef = useRef<() => void>(() => undefined);

  const register = useCallback((snapshot: WorkItemUnsavedSnapshot) => {
    setHasUnsavedChanges((prev) =>
      prev === snapshot.hasUnsavedChanges ? prev : snapshot.hasUnsavedChanges
    );
    saveRef.current = snapshot.save;
    discardRef.current = snapshot.discard;
  }, []);

  const save = useCallback(() => saveRef.current(), []);
  const discard = useCallback(() => discardRef.current(), []);

  return (
    <WorkItemUnsavedChangesContext.Provider
      value={{ hasUnsavedChanges, save, discard, register }}
    >
      {children}
    </WorkItemUnsavedChangesContext.Provider>
  );
};

export const useRegisterWorkItemUnsavedChanges = (
  snapshot: WorkItemUnsavedSnapshot
): void => {
  const ctx = useContext(WorkItemUnsavedChangesContext);
  const register = ctx?.register;

  useEffect(() => {
    if (!register) {
      return;
    }
    register(snapshot);
  }, [
    register,
    snapshot.hasUnsavedChanges,
    snapshot.save,
    snapshot.discard,
    snapshot,
  ]);
};

export interface WorkItemUnsavedChangesAccess {
  hasUnsavedChanges: boolean;
  save: () => Promise<boolean>;
  discard: () => void;
}

export const useWorkItemUnsavedChanges =
  (): WorkItemUnsavedChangesAccess | null => {
    const ctx = useContext(WorkItemUnsavedChangesContext);
    if (!ctx) {
      return null;
    }
    return {
      hasUnsavedChanges: ctx.hasUnsavedChanges,
      save: ctx.save,
      discard: ctx.discard,
    };
  };
