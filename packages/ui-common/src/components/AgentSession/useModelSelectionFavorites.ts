import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  deleteModelSelectionFavorite,
  getModelSelectionFavoritesSnapshot,
  reconcileModelSelectionConfiguration,
  renameModelSelectionFavorite,
  saveModelSelectionFavorite,
  subscribeModelSelectionFavorites,
  type FavoriteMutationResult,
  type ModelSelectionConfiguration,
  type ModelSelectionFavorite,
  type ModelSelectionFavoriteId,
} from "./modelSelectionFavorites";

export interface ModelSelectionFavoritesController {
  favorites: readonly ModelSelectionFavorite[];
  save(
    name: string,
    configuration: ModelSelectionConfiguration
  ): FavoriteMutationResult;
  rename(id: ModelSelectionFavoriteId, name: string): FavoriteMutationResult;
  delete(id: ModelSelectionFavoriteId): void;
}

export const useModelSelectionFavorites = (): ModelSelectionFavoritesController => {
  const storedFavorites = useSyncExternalStore(
    subscribeModelSelectionFavorites,
    getModelSelectionFavoritesSnapshot,
    getModelSelectionFavoritesSnapshot
  );
  const favorites = useMemo(
    () =>
      storedFavorites.flatMap((favorite) => {
        const configuration = reconcileModelSelectionConfiguration(favorite);
        return configuration ? [{ ...favorite, ...configuration }] : [];
      }),
    [storedFavorites]
  );
  const save = useCallback(saveModelSelectionFavorite, []);
  const rename = useCallback(renameModelSelectionFavorite, []);
  const deleteFavorite = useCallback(deleteModelSelectionFavorite, []);
  return { favorites, save, rename, delete: deleteFavorite };
};
