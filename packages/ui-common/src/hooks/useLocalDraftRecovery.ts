import React from "react";

interface DraftEnvelope<TValue> {
  value: TValue;
  savedAt: string;
}

interface UseLocalDraftRecoveryParams<TValue> {
  storageKey: string;
  value: TValue;
  isDirty: boolean;
  isSaving: boolean;
  onRestore: (value: TValue) => void;
  clearSignal?: number;
  debounceMs?: number;
}

const safeStringify = <TValue>(value: TValue): string | null => {
  try {
    return JSON.stringify(value);
  } catch (error) {
    console.error("Failed to serialize draft value:", error);
    return null;
  }
};

export const writeLocalDraftRecoveryValue = <TValue>(
  storageKey: string,
  value: TValue,
): void => {
  try {
    const envelope: DraftEnvelope<TValue> = {
      value,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(storageKey, JSON.stringify(envelope));
  } catch (error) {
    console.error("Failed to persist local draft:", error);
  }
};

/**
 * Persists dirty editor state to localStorage and offers recovery on next open.
 */
export const useLocalDraftRecovery = <TValue>({
  storageKey,
  value,
  isDirty,
  isSaving,
  onRestore,
  clearSignal,
  debounceMs = 400,
}: UseLocalDraftRecoveryParams<TValue>): void => {
  const restoredStorageKeyRef = React.useRef<string | null>(null);
  const previousIsDirtyRef = React.useRef(isDirty);
  const previousStorageKeyRef = React.useRef(storageKey);
  const lastClearedSignalRef = React.useRef<number | undefined>(undefined);
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  React.useEffect(() => {
    if (restoredStorageKeyRef.current === storageKey) {
      return;
    }

    restoredStorageKeyRef.current = storageKey;

    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as DraftEnvelope<TValue>;
      const currentSerialized = safeStringify(value);
      const draftSerialized = safeStringify(parsed.value);

      if (!draftSerialized || draftSerialized === currentSerialized) {
        localStorage.removeItem(storageKey);
        return;
      }

      onRestore(parsed.value);
    } catch (error) {
      console.error("Failed to recover local draft:", error);
    }
  }, [onRestore, storageKey, value]);

  React.useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    if (!isDirty || isSaving) {
      return;
    }

    saveTimeoutRef.current = setTimeout(() => {
      writeLocalDraftRecoveryValue(storageKey, value);
      saveTimeoutRef.current = null;
    }, debounceMs);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [debounceMs, isDirty, isSaving, storageKey, value]);

  React.useEffect(() => {
    if (clearSignal === undefined) {
      return;
    }

    if (lastClearedSignalRef.current === undefined) {
      lastClearedSignalRef.current = clearSignal;
      return;
    }

    if (lastClearedSignalRef.current === clearSignal) {
      return;
    }

    lastClearedSignalRef.current = clearSignal;

    try {
      localStorage.removeItem(storageKey);
    } catch (error) {
      console.error("Failed to clear local draft:", error);
    }
  }, [clearSignal, storageKey]);

  React.useEffect(() => {
    const wasDirty = previousIsDirtyRef.current;
    const wasSameStorageKey = previousStorageKeyRef.current === storageKey;

    previousIsDirtyRef.current = isDirty;
    previousStorageKeyRef.current = storageKey;

    if (!wasDirty || isDirty || !wasSameStorageKey) {
      return;
    }

    try {
      localStorage.removeItem(storageKey);
    } catch (error) {
      console.error("Failed to clear local draft:", error);
    }
  }, [isDirty, storageKey]);
};
