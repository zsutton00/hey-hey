import { useState, useCallback, useRef, useEffect } from "react";
import type { UpdateProjectDto } from "../../api";
import { platformClient } from "../../clients/serviceClients";
import { logger } from "../../utils/logger";

interface ProjectContent {
  name: string;
  description: string;
}

type AutosaveStatus = "idle" | "saving" | "saved" | "error";

interface UseProjectAutosaveProps {
  organizationId: string;
  projectId: string;
  content: ProjectContent;
  enabled?: boolean;
  debounceMs?: number;
  onError?: (error: string) => void;
}

interface UseProjectAutosaveReturn {
  autosaveStatus: AutosaveStatus;
  isAutosaving: boolean;
  lastSavedAt: Date | null;
  triggerManualSave: () => Promise<void>;
}

export const useProjectAutosave = ({
  organizationId,
  projectId,
  content,
  enabled = true,
  debounceMs = 2000, // 2 second debounce
  onError,
}: UseProjectAutosaveProps): UseProjectAutosaveReturn => {
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // Refs to track debounce and last saved content
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedContentRef = useRef<ProjectContent>({
    name: "",
    description: "",
  });
  const isSavingRef = useRef(false);
  const enabledAtRef = useRef<Date | null>(null);
  const delayAfterEnabledMs = 1000; // 1 second delay after enabled turns true

  // Check if content has actually changed
  const hasContentChanged = useCallback(
    (newContent: ProjectContent): boolean => {
      const lastSaved = lastSavedContentRef.current;
      return (
        newContent.name !== lastSaved.name ||
        newContent.description !== lastSaved.description
      );
    },
    [],
  );

  // Perform the actual autosave
  const performAutosave = useCallback(
    async (contentToSave: ProjectContent): Promise<void> => {
      if (isSavingRef.current || !enabled) {
        return;
      }

      try {
        isSavingRef.current = true;
        setAutosaveStatus("saving");

        const payload: UpdateProjectDto = {
          name: contentToSave.name?.trim() || undefined,
          description: contentToSave.description?.trim() || undefined,
        };

        // Only include fields that have content to avoid clearing empty fields
        const filteredPayload: UpdateProjectDto = {};
        if (payload.name?.trim()) {
          filteredPayload.name = payload.name;
        }
        if (payload.description?.trim()) {
          filteredPayload.description = payload.description;
        }

        await platformClient.updateProject({
          organizationId: organizationId,
          projectId: projectId,
          updateProjectDto: filteredPayload,
        });

        // Update the last saved content
        lastSavedContentRef.current = { ...contentToSave };
        setLastSavedAt(new Date());
        setAutosaveStatus("saved");

        // Keep the "saved" status visible - don't auto-hide it
      } catch (err) {
        logger.error("data_hooks", "[useProjectAutosave] Autosave failed", {
          error: err,
        });
        setAutosaveStatus("error");
        onError?.(err instanceof Error ? err.message : "Autosave failed");

        // Reset to idle after 3 seconds on error
        setTimeout(() => {
          setAutosaveStatus("idle");
        }, 3000);
      } finally {
        isSavingRef.current = false;
      }
    },
    [organizationId, projectId, enabled, onError],
  );

  // Track when enabled becomes true
  useEffect(() => {
    if (enabled && !enabledAtRef.current) {
      enabledAtRef.current = new Date();
    } else if (!enabled) {
      enabledAtRef.current = null;
    }
  }, [enabled]);

  // Check if enough time has passed since enabled became true
  const isReadyForAutosave = useCallback((): boolean => {
    if (!enabled || !enabledAtRef.current) {
      return false;
    }

    const timeSinceEnabled = Date.now() - enabledAtRef.current.getTime();
    return timeSinceEnabled >= delayAfterEnabledMs;
  }, [enabled, delayAfterEnabledMs]);

  // Debounced autosave effect
  useEffect(() => {
    // Skip if not enabled
    if (!enabled) {
      return;
    }

    // Skip if content hasn't actually changed
    if (!hasContentChanged(content)) {
      return;
    }

    // Skip if not enough time has passed since enabled became true
    // This prevents autosave on initial data load
    if (!isReadyForAutosave()) {
      return;
    }

    // If we were previously saved and now content changed, reset status to idle
    if (autosaveStatus === "saved") {
      setAutosaveStatus("idle");
    }

    // Clear existing timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Set new timeout for debounced save
    debounceTimeoutRef.current = setTimeout(() => {
      performAutosave(content);
    }, debounceMs);

    // Cleanup function
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [
    content,
    enabled,
    debounceMs,
    hasContentChanged,
    performAutosave,
    autosaveStatus,
    isReadyForAutosave,
  ]);

  // Manual save trigger
  const triggerManualSave = useCallback(async (): Promise<void> => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }
    await performAutosave(content);
  }, [content, performAutosave]);

  // Initialize last saved content on mount
  useEffect(() => {
    lastSavedContentRef.current = { ...content };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  return {
    autosaveStatus,
    isAutosaving: autosaveStatus === "saving",
    lastSavedAt,
    triggerManualSave,
  };
};
