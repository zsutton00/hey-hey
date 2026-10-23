import { useCallback, useEffect, useState } from "react";
import type { SearchEntity } from "./types";

const STORAGE_KEY = "mentionPopup.recentSelections.v1";
const RECENT_SELECTIONS_CHANGED_EVENT = "mentionPopup.recentSelectionsChanged";
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface RecentSelection {
  id: string;
  type: string;
  name: string;
  timestamps: number[];
}

type StoredMap = Record<string, RecentSelection>;

const makeKey = (type: string, id: string): string => `${type}:${id}`;

const readStore = (): StoredMap => {
  if (typeof window === "undefined" || !window.localStorage) {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writeStore = (store: StoredMap): void => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore quota/serialization errors — recent selections are best-effort.
  }
};

export const pruneStore = (
  store: StoredMap,
  now: number = Date.now()
): StoredMap => {
  const cutoff = now - RETENTION_MS;
  const next: StoredMap = {};
  for (const [key, entry] of Object.entries(store)) {
    const fresh = entry.timestamps.filter((ts) => ts >= cutoff);
    if (fresh.length > 0) {
      next[key] = { ...entry, timestamps: fresh };
    }
  }
  return next;
};

export const recordSelection = (
  entity: Pick<SearchEntity, "id" | "type" | "name">,
  now: number = Date.now()
): StoredMap => {
  const pruned = pruneStore(readStore(), now);
  const key = makeKey(entity.type, entity.id);
  const existing = pruned[key];
  pruned[key] = {
    id: entity.id,
    type: entity.type,
    name: entity.name,
    timestamps: [...(existing?.timestamps ?? []), now],
  };
  writeStore(pruned);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(RECENT_SELECTIONS_CHANGED_EVENT));
  }
  return pruned;
};

export const loadRecentSelections = (
  now: number = Date.now()
): RecentSelection[] => {
  const pruned = pruneStore(readStore(), now);
  writeStore(pruned);
  return Object.values(pruned);
};

export const useRecentMentionSelections = (): {
  selections: RecentSelection[];
  record: (entity: Pick<SearchEntity, "id" | "type" | "name">) => void;
} => {
  const [selections, setSelections] = useState<RecentSelection[]>(() =>
    loadRecentSelections()
  );

  useEffect(() => {
    const storageHandler = (event: StorageEvent): void => {
      if (event.key === STORAGE_KEY) {
        setSelections(loadRecentSelections());
      }
    };

    const localHandler = (): void => {
      setSelections(loadRecentSelections());
    };

    window.addEventListener("storage", storageHandler);
    window.addEventListener(RECENT_SELECTIONS_CHANGED_EVENT, localHandler);
    return () => {
      window.removeEventListener("storage", storageHandler);
      window.removeEventListener(RECENT_SELECTIONS_CHANGED_EVENT, localHandler);
    };
  }, []);

  const record = useCallback(
    (entity: Pick<SearchEntity, "id" | "type" | "name">) => {
      const store = recordSelection(entity);
      setSelections(Object.values(store));
    },
    []
  );

  return { selections, record };
};
