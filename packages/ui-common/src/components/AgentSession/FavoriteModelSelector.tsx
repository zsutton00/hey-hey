import {
  ModelSelector,
  type ModelSelectorFavoriteProps,
  type ModelSelectorProps,
} from "./ModelSelector";
import type { ModelSelectionFavorite } from "./modelSelectionFavorites";
import { useModelSelectionFavorites } from "./useModelSelectionFavorites";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type FavoriteModelSelectorProps = DistributiveOmit<
  ModelSelectorProps,
  keyof ModelSelectorFavoriteProps
>;

export const FavoriteModelSelector = (props: FavoriteModelSelectorProps) => {
  const controller = useModelSelectionFavorites();

  const applyFavorite = (favorite: ModelSelectionFavorite): void => {
    if (favorite.provider !== props.provider) {
      props.onProviderChange(favorite.provider);
    }
    if (favorite.model !== props.model) {
      props.onModelChange(favorite.model);
    }
    if (favorite.reasoningEffort !== props.reasoningEffort) {
      props.onReasoningEffortChange(favorite.reasoningEffort);
    }
    const fastMode = favorite.serviceTier === "priority";
    if (fastMode !== props.fastMode) props.onFastModeChange(fastMode);
  };

  return (
    <ModelSelector
      {...props}
      favorites={controller.favorites}
      onSaveFavorite={controller.save}
      onApplyFavorite={applyFavorite}
      onRenameFavorite={controller.rename}
      onDeleteFavorite={controller.delete}
    />
  );
};
