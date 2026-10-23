import {
  ConversationStartRunRequestDtoProviderEnum,
  type ConversationStartRunRequestDtoReasoningEffortEnum,
} from "../../api";
import type { ModelServiceTier } from "./capabilityCatalog";
import { listProviders } from "./capabilityCatalog";
import { reconcileSurfaceSelection } from "./surfaceSelectionMemory";

export const MODEL_SELECTION_FAVORITES_STORAGE_KEY =
  "hey-hey:model-selection-favorites";

export type ModelSelectionFavoriteId = string & {
  readonly __modelSelectionFavoriteId: unique symbol;
};

export interface ModelSelectionConfiguration {
  provider: ConversationStartRunRequestDtoProviderEnum;
  model: string;
  reasoningEffort: ConversationStartRunRequestDtoReasoningEffortEnum | null;
  serviceTier?: ModelServiceTier;
}

export interface ModelSelectionFavorite extends ModelSelectionConfiguration {
  id: ModelSelectionFavoriteId;
  name: string;
}

export interface StoredModelSelectionFavoritesV1 {
  version: 1;
  favorites: readonly ModelSelectionFavorite[];
}

export type FavoriteMutationResult =
  | { ok: true }
  | { ok: false; reason: "required-name" | "duplicate-name" };

const EMPTY_FAVORITES: readonly ModelSelectionFavorite[] = [];
let snapshot: readonly ModelSelectionFavorite[] | null = null;
const listeners = new Set<() => void>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isProvider = (value: unknown): value is ConversationStartRunRequestDtoProviderEnum =>
  value === ConversationStartRunRequestDtoProviderEnum.Claude ||
  value === ConversationStartRunRequestDtoProviderEnum.Codex ||
  value === ConversationStartRunRequestDtoProviderEnum.Opencode;

const isEffort = (value: unknown): value is ConversationStartRunRequestDtoReasoningEffortEnum =>
  value === "low" ||
  value === "medium" ||
  value === "high" ||
  value === "xhigh" ||
  value === "max";

const parseFavorite = (value: unknown): ModelSelectionFavorite | null => {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    !isProvider(value.provider) ||
    typeof value.model !== "string" ||
    value.model.length === 0 ||
    (value.reasoningEffort !== null && !isEffort(value.reasoningEffort)) ||
    (value.serviceTier !== undefined && value.serviceTier !== "priority")
  ) {
    return null;
  }
  return {
    id: value.id as ModelSelectionFavoriteId,
    name: value.name.trim(),
    provider: value.provider,
    model: value.model,
    reasoningEffort: value.reasoningEffort,
    ...(value.serviceTier === "priority"
      ? { serviceTier: value.serviceTier }
      : {}),
  };
};

const parseStoredFavorites = (
  raw: string | null
): readonly ModelSelectionFavorite[] => {
  if (raw === null) return EMPTY_FAVORITES;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.favorites)) {
      return EMPTY_FAVORITES;
    }
    const parsed = value.favorites.map(parseFavorite);
    if (parsed.some((favorite) => favorite === null)) return EMPTY_FAVORITES;
    const favorites = parsed.filter(
      (favorite): favorite is ModelSelectionFavorite => favorite !== null
    );
    const names = favorites.map((favorite) => favorite.name.toLowerCase());
    const ids = favorites.map((favorite) => favorite.id);
    if (
      new Set(names).size !== names.length ||
      new Set(ids).size !== ids.length
    ) {
      return EMPTY_FAVORITES;
    }
    return favorites;
  } catch {
    return EMPTY_FAVORITES;
  }
};

const getStorage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

const readStorage = (): readonly ModelSelectionFavorite[] => {
  try {
    return parseStoredFavorites(
      getStorage()?.getItem(MODEL_SELECTION_FAVORITES_STORAGE_KEY) ?? null
    );
  } catch {
    return EMPTY_FAVORITES;
  }
};

const emit = (): void => {
  for (const listener of listeners) listener();
};

const replaceSnapshot = (
  favorites: readonly ModelSelectionFavorite[],
  persist: boolean
): void => {
  snapshot = favorites;
  if (persist) {
    const stored: StoredModelSelectionFavoritesV1 = { version: 1, favorites };
    try {
      getStorage()?.setItem(
        MODEL_SELECTION_FAVORITES_STORAGE_KEY,
        JSON.stringify(stored)
      );
    } catch {
      // Browser storage is best effort; same-window subscribers still update.
    }
  }
  emit();
};

export const getModelSelectionFavoritesSnapshot = (): readonly ModelSelectionFavorite[] => {
  snapshot ??= readStorage();
  return snapshot;
};

const handleStorage = (event: StorageEvent): void => {
  if (event.key !== MODEL_SELECTION_FAVORITES_STORAGE_KEY) return;
  replaceSnapshot(parseStoredFavorites(event.newValue), false);
};

export const subscribeModelSelectionFavorites = (
  listener: () => void
): (() => void) => {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
};

const normalizedName = (name: string): string => name.trim().toLowerCase();

const validateName = (
  name: string,
  excludedId?: ModelSelectionFavoriteId
): FavoriteMutationResult => {
  const normalized = normalizedName(name);
  if (!normalized) return { ok: false, reason: "required-name" };
  if (
    getModelSelectionFavoritesSnapshot().some(
      (favorite) =>
        favorite.id !== excludedId && normalizedName(favorite.name) === normalized
    )
  ) {
    return { ok: false, reason: "duplicate-name" };
  }
  return { ok: true };
};

const createFavoriteId = (): ModelSelectionFavoriteId => {
  const value =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return value as ModelSelectionFavoriteId;
};

export const saveModelSelectionFavorite = (
  name: string,
  configuration: ModelSelectionConfiguration
): FavoriteMutationResult => {
  const validation = validateName(name);
  if (!validation.ok) return validation;
  replaceSnapshot(
    [
      ...getModelSelectionFavoritesSnapshot(),
      { id: createFavoriteId(), name: name.trim(), ...configuration },
    ],
    true
  );
  return { ok: true };
};

export const renameModelSelectionFavorite = (
  id: ModelSelectionFavoriteId,
  name: string
): FavoriteMutationResult => {
  const validation = validateName(name, id);
  if (!validation.ok) return validation;
  replaceSnapshot(
    getModelSelectionFavoritesSnapshot().map((favorite) =>
      favorite.id === id ? { ...favorite, name: name.trim() } : favorite
    ),
    true
  );
  return { ok: true };
};

export const deleteModelSelectionFavorite = (
  id: ModelSelectionFavoriteId
): void => {
  replaceSnapshot(
    getModelSelectionFavoritesSnapshot().filter((favorite) => favorite.id !== id),
    true
  );
};

export const reconcileModelSelectionConfiguration = (
  configuration: ModelSelectionConfiguration
): ModelSelectionConfiguration | null => {
  if (!listProviders().includes(configuration.provider)) return null;
  const selection = reconcileSurfaceSelection({
    provider: configuration.provider,
    model: configuration.model,
    reasoningEffort: configuration.reasoningEffort,
    fastMode: configuration.serviceTier === "priority",
  });
  if (!selection) return null;
  return {
    provider: selection.provider,
    model: selection.model,
    reasoningEffort: selection.reasoningEffort,
    ...(selection.fastMode ? { serviceTier: "priority" } : {}),
  };
};

export const modelSelectionConfigurationsEqual = (
  left: ModelSelectionConfiguration,
  right: ModelSelectionConfiguration
): boolean =>
  left.provider === right.provider &&
  left.model === right.model &&
  left.reasoningEffort === right.reasoningEffort &&
  left.serviceTier === right.serviceTier;

export const resetModelSelectionFavoritesForTests = (): void => {
  snapshot = null;
  emit();
};
