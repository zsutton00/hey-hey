import { useCallback, useMemo, useRef, useState } from "react";
import {
  buildDefaultSurfaceSelection,
  readSurfaceSelection,
  type SurfaceSelection,
} from "./surfaceSelectionMemory";
import {
  type RuntimeModelCatalogSource,
  useRuntimeModelCatalog,
} from "./useRuntimeModelCatalog";

export interface UseSurfaceSelectionResult {
  /**
   * The provider/model/effort the surface currently holds: the user's choice if
   * they made one, else the remembered choice for the surface reconciled to the
   * addressed CLI's catalog, else that catalog's default. Null until the CLI's
   * catalog has loaded (or when it offers nothing launchable): nothing is
   * preselected before the CLI has said what it can launch.
   */
  selection: SurfaceSelection | null;
  /** Replaces the held choice (for example, with one hydrated from a session). */
  setSelection: (next: SurfaceSelection) => void;
  /** Changes the held choice; does nothing while there is no selection. */
  updateSelection: (
    update: (current: SurfaceSelection) => SurfaceSelection,
  ) => void;
}

/**
 * Selection state for a surface that embeds a model picker. The catalog is
 * requested for the machine in `catalogSource` (null until one is picked).
 * `surfaceId` is the surface's memory key, or null when it keeps none.
 * Whenever `resetKey` changes (a dialog opening, say) the held choice is
 * dropped and the remembered one is read again; pass null when that never
 * applies.
 */
export const useSurfaceSelection = ({
  surfaceId,
  catalogSource,
  resetKey,
}: {
  surfaceId: string | null;
  catalogSource: RuntimeModelCatalogSource | null;
  resetKey: string | number | boolean | null;
}): UseSurfaceSelectionResult => {
  const catalogState = useRuntimeModelCatalog(catalogSource);
  const catalogDefault = useMemo(
    () =>
      catalogState.status === "ready"
        ? ((surfaceId ? readSurfaceSelection(surfaceId) : null) ??
          buildDefaultSurfaceSelection())
        : null,
    // `resetKey` is deliberate: it re-reads the remembered selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalogState, surfaceId, resetKey],
  );
  const [chosen, setChosen] = useState<SurfaceSelection | null>(null);
  const [seenResetKey, setSeenResetKey] = useState(resetKey);
  if (seenResetKey !== resetKey) {
    setSeenResetKey(resetKey);
    setChosen(null);
  }
  const selection = chosen ?? catalogDefault;
  // Kept current between renders so several updates from one event (provider,
  // then model, then effort) build on each other.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const setSelection = useCallback((next: SurfaceSelection): void => {
    selectionRef.current = next;
    setChosen(next);
  }, []);

  const updateSelection = useCallback(
    (update: (current: SurfaceSelection) => SurfaceSelection): void => {
      const current = selectionRef.current;
      if (current) {
        setSelection(update(current));
      }
    },
    [setSelection],
  );

  return { selection, setSelection, updateSelection };
};
