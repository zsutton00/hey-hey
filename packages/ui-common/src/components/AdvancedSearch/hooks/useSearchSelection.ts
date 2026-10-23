import { useState, useCallback, useRef } from "react";
import type { SearchEntity } from "../types";

/**
 * Hook for managing search result selection with keyboard modifiers
 *
 * Supports:
 * - Single-select mode: Click to select one item
 * - Multi-select mode:
 *   - Regular click: Toggle selection
 *   - Shift+click: Range selection from last selected
 *   - Ctrl/Cmd+click: Toggle individual selection
 *
 * @param allowMultiSelect - Whether multi-select mode is enabled
 * @returns Selection state and handlers
 */
export function useSearchSelection(allowMultiSelect: boolean) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedIdRef = useRef<string | null>(null);

  /**
   * Handle selection with keyboard modifiers
   */
  const handleSelect = useCallback(
    (id: string, event: React.MouseEvent, results: SearchEntity[]) => {
      // Single-select mode: just select the clicked item
      if (!allowMultiSelect) {
        setSelectedIds(new Set([id]));
        lastSelectedIdRef.current = id;
        return;
      }

      // Multi-select mode
      if (event.shiftKey && lastSelectedIdRef.current) {
        // Range selection: select all between last selected and current
        const range = getRange(lastSelectedIdRef.current, id, results);
        setSelectedIds((prev) => new Set([...prev, ...range]));
      } else if (event.metaKey || event.ctrlKey) {
        // Toggle individual item with Ctrl/Cmd
        setSelectedIds((prev) => {
          const newSelection = new Set(prev);
          if (newSelection.has(id)) {
            newSelection.delete(id);
          } else {
            newSelection.add(id);
          }
          return newSelection;
        });
        lastSelectedIdRef.current = id;
      } else {
        // Regular click in multi-select: toggle
        setSelectedIds((prev) => {
          const newSelection = new Set(prev);
          if (newSelection.has(id)) {
            newSelection.delete(id);
          } else {
            newSelection.add(id);
          }
          return newSelection;
        });
        lastSelectedIdRef.current = id;
      }
    },
    [allowMultiSelect]
  );

  /**
   * Clear all selections
   */
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastSelectedIdRef.current = null;
  }, []);

  /**
   * Select all items
   */
  const selectAll = useCallback((results: SearchEntity[]) => {
    setSelectedIds(new Set(results.map((r) => r.id)));
  }, []);

  /**
   * Add an item to selection
   */
  const addToSelection = useCallback((id: string) => {
    setSelectedIds((prev) => new Set([...prev, id]));
    lastSelectedIdRef.current = id;
  }, []);

  /**
   * Remove an item from selection
   */
  const removeFromSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const newSelection = new Set(prev);
      newSelection.delete(id);
      return newSelection;
    });
  }, []);

  return {
    selectedIds,
    handleSelect,
    clearSelection,
    selectAll,
    addToSelection,
    removeFromSelection,
  };
}

/**
 * Get range of IDs between start and end in the results array
 */
function getRange(
  startId: string,
  endId: string,
  results: SearchEntity[]
): string[] {
  const startIndex = results.findIndex((r) => r.id === startId);
  const endIndex = results.findIndex((r) => r.id === endId);

  if (startIndex === -1 || endIndex === -1) {
    return [endId];
  }

  const [minIndex, maxIndex] =
    startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];

  return results.slice(minIndex, maxIndex + 1).map((r) => r.id);
}
