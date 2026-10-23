/**
 * Position Persistence Hook
 *
 * Manages workflow diagram node position persistence with localStorage backup
 * and future API persistence support
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { Node } from "@xyflow/react";
import type { WorkflowTemplateId } from "../types/workflow";

interface PositionData {
  [nodeId: string]: { x: number; y: number };
}

interface PositionPersistenceState {
  positions: PositionData;
  isDirty: boolean;
  isLoading: boolean;
  isSaving: boolean;
  lastSavedAt: Date | null;
}

interface UsePositionPersistenceOptions {
  templateId: WorkflowTemplateId;
  autoSaveDelay?: number; // milliseconds
  enableApiPersistence?: boolean; // for future API support
}

interface UsePositionPersistenceResult {
  positions: PositionData;
  isDirty: boolean;
  isLoading: boolean;
  isSaving: boolean;
  lastSavedAt: Date | null;
  updatePositions: (nodes: Node[]) => void;
  savePositions: () => Promise<void>;
  resetPositions: () => void;
  clearAllPositions: () => void;
}

const STORAGE_KEY_PREFIX = "workflow-positions-";

export const usePositionPersistence = ({
  templateId,
  autoSaveDelay = 1000,
  enableApiPersistence = false,
}: UsePositionPersistenceOptions): UsePositionPersistenceResult => {
  const [state, setState] = useState<PositionPersistenceState>({
    positions: {},
    isDirty: false,
    isLoading: true,
    isSaving: false,
    lastSavedAt: null,
  });

  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const storageKey = `${STORAGE_KEY_PREFIX}${templateId}`;

  // Load positions from localStorage on mount
  useEffect(() => {
    const loadPositions = async () => {
      try {
        setState((prev) => ({ ...prev, isLoading: true }));

        let positions: PositionData = {};

        // Try localStorage first
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          const parsed = JSON.parse(stored);
          positions = parsed.positions || {};
        }

        // TODO: In the future, load from API if enableApiPersistence is true
        // if (enableApiPersistence) {
        //   const apiPositions = await loadPositionsFromAPI(templateId);
        //   positions = { ...positions, ...apiPositions };
        // }

        setState((prev) => ({
          ...prev,
          positions,
          isLoading: false,
          isDirty: false,
          lastSavedAt: stored ? new Date() : null,
        }));
      } catch (error) {
        console.error("Failed to load workflow positions:", error);
        setState((prev) => ({
          ...prev,
          positions: {},
          isLoading: false,
          isDirty: false,
        }));
      }
    };

    loadPositions();
  }, [templateId, storageKey, enableApiPersistence]);

  // Save positions with debouncing
  const debouncedSave = useCallback(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      setState((prev) => {
        if (!prev.isDirty) return prev;

        try {
          // Save to localStorage
          const dataToStore = {
            positions: prev.positions,
            savedAt: new Date().toISOString(),
            templateId,
          };
          localStorage.setItem(storageKey, JSON.stringify(dataToStore));

          // TODO: Save to API in the future
          // if (enableApiPersistence) {
          //   savePositionsToAPI(templateId, prev.positions);
          // }

          return {
            ...prev,
            isDirty: false,
            isSaving: false,
            lastSavedAt: new Date(),
          };
        } catch (error) {
          console.error("Failed to save workflow positions:", error);
          return {
            ...prev,
            isSaving: false,
          };
        }
      });
    }, autoSaveDelay);
  }, [templateId, storageKey, autoSaveDelay]);

  // Update positions from node changes
  const updatePositions = useCallback(
    (nodes: Node[]) => {
      const newPositions: PositionData = {};

      nodes.forEach((node) => {
        if (node.position) {
          newPositions[node.id] = {
            x: Math.round(node.position.x),
            y: Math.round(node.position.y),
          };
        }
      });

      setState((prev) => {
        // Check if positions actually changed to avoid unnecessary saves
        const hasChanges = Object.keys(newPositions).some((nodeId) => {
          const newPos = newPositions[nodeId];
          const oldPos = prev.positions[nodeId];
          return !oldPos || oldPos.x !== newPos.x || oldPos.y !== newPos.y;
        });

        if (!hasChanges) return prev;

        const updatedState = {
          ...prev,
          positions: newPositions,
          isDirty: true,
          isSaving: true,
        };

        // Trigger debounced save
        debouncedSave();

        return updatedState;
      });
    },
    [debouncedSave]
  );

  // Manual save function
  const savePositions = useCallback(async () => {
    return new Promise<void>((resolve, reject) => {
      setState((prev) => {
        if (!prev.isDirty) {
          resolve();
          return prev;
        }

        try {
          const dataToStore = {
            positions: prev.positions,
            savedAt: new Date().toISOString(),
            templateId,
          };
          localStorage.setItem(storageKey, JSON.stringify(dataToStore));

          // TODO: Save to API in the future
          // if (enableApiPersistence) {
          //   await savePositionsToAPI(templateId, prev.positions);
          // }

          resolve();
          return {
            ...prev,
            isDirty: false,
            isSaving: false,
            lastSavedAt: new Date(),
          };
        } catch (error) {
          console.error("Failed to save workflow positions:", error);
          reject(error);
          return {
            ...prev,
            isSaving: false,
          };
        }
      });
    });
  }, [templateId, storageKey]);

  // Reset to original positions
  const resetPositions = useCallback(() => {
    setState((prev) => ({
      ...prev,
      positions: {},
      isDirty: false,
      isSaving: false,
    }));

    // Clear from localStorage
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  // Clear all positions for all templates (admin function)
  const clearAllPositions = useCallback(() => {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => localStorage.removeItem(key));

    setState((prev) => ({
      ...prev,
      positions: {},
      isDirty: false,
      isSaving: false,
    }));
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  return {
    positions: state.positions,
    isDirty: state.isDirty,
    isLoading: state.isLoading,
    isSaving: state.isSaving,
    lastSavedAt: state.lastSavedAt,
    updatePositions,
    savePositions,
    resetPositions,
    clearAllPositions,
  };
};

// Future API functions (placeholder)
// const loadPositionsFromAPI = async (templateId: WorkflowTemplateId): Promise<PositionData> => {
//   const response = await fetch(`/api/workflow-templates/${templateId}/positions`);
//   if (!response.ok) throw new Error('Failed to load positions from API');
//   const data = await response.json();
//   return data.positions || {};
// };

// const savePositionsToAPI = async (templateId: WorkflowTemplateId, positions: PositionData): Promise<void> => {
//   const response = await fetch(`/api/workflow-templates/${templateId}/positions`, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ positions }),
//   });
//   if (!response.ok) throw new Error('Failed to save positions to API');
// };
