import { useState, useCallback, useEffect, useRef } from "react";
import { apiClient } from "../clients";
import { useUserIdentity } from "./index";
import type { ArtifactMetadata } from "../types/artifacts";
import type {
  ArtifactSourceType,
  CreateArtifactDto,
  DocumentData,
  UpdateArtifactDto,
} from "../api";

interface UseAutoSaveOptions {
  projectId: string;
  sourceType: ArtifactSourceType;
  sourceId: string;
  onArtifactCreated?: (artifactId: string) => void;
}

export const useAutoSave = (
  content: string,
  metadata: ArtifactMetadata,
  artifactId: string | null,
  options: UseAutoSaveOptions
) => {
  const { currentOrgId } = useUserIdentity() || {};
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">(
    "saved"
  );
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastContentRef = useRef<string>(content);
  const lastMetadataRef = useRef<ArtifactMetadata>(metadata);
  const maxRetries = 3;

  const saveDocument = useCallback(
    async (
      currentContent: string,
      currentMetadata: ArtifactMetadata,
      attemptNumber: number = 0
    ) => {
      if (!currentOrgId) return;

      setSaveStatus("saving");
      setErrorMessage(null);

      try {
        if (artifactId) {
          // Update existing artifact
          const documentTitle = currentMetadata.title || "Untitled Document";

          const updateDto: UpdateArtifactDto = {
            title: documentTitle,
            data: {
              content: currentContent,
              title: documentTitle,
              type: "DOCUMENT",
            } as DocumentData,
            tags: currentMetadata.tags,
            category: currentMetadata.category,
            status: currentMetadata.status,
            isPublic: currentMetadata.isPublic,
          };

          await apiClient.updateArtifact({
            organizationId: currentOrgId,
            id: artifactId,
            updateArtifactDto: updateDto,
          });
        } else {
          // Create new artifact
          const documentTitle = currentMetadata.title || "Untitled Document";

          const createDto: CreateArtifactDto = {
            projectId: options.projectId,
            organizationId: currentOrgId,
            type: "DOCUMENT",
            title: documentTitle,
            data: {
              content: currentContent,
              title: documentTitle,
              type: "DOCUMENT",
            } as DocumentData,
            sourceType: options.sourceType,
            sourceId: options.sourceId,
            tags: currentMetadata.tags,
            category: currentMetadata.category,
            status: currentMetadata.status || "DRAFT",
            isPublic: currentMetadata.isPublic ?? false,
            generateEmbedding: true,
          };

          const response = await apiClient.createArtifact({
            organizationId: currentOrgId,
            createArtifactDto: createDto,
          });
          const newArtifactId = response.data?.data?.id;

          if (newArtifactId && options.onArtifactCreated) {
            options.onArtifactCreated(newArtifactId);
          }
        }

        setSaveStatus("saved");
        setLastSaved(new Date());
        setRetryCount(0);
        lastContentRef.current = currentContent;
        lastMetadataRef.current = currentMetadata;
      } catch (error) {
        console.error(
          `Auto-save failed (attempt ${attemptNumber + 1}):`,
          error
        );

        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";
        setErrorMessage(errorMsg);

        // Retry logic
        if (attemptNumber < maxRetries) {
          const retryDelay = Math.pow(2, attemptNumber) * 1000; // Exponential backoff
          setRetryCount(attemptNumber + 1);

          retryTimeoutRef.current = setTimeout(() => {
            saveDocument(currentContent, currentMetadata, attemptNumber + 1);
          }, retryDelay);
        } else {
          setSaveStatus("error");
          setRetryCount(0);
        }
      }
    },
    [currentOrgId, artifactId, options, maxRetries]
  );

  const debouncedSave = useCallback(
    (currentContent: string, currentMetadata: ArtifactMetadata) => {
      // Clear existing timeouts
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }

      // Don't save if content and metadata haven't changed
      const contentChanged =
        currentContent.trim() !== lastContentRef.current.trim();
      const metadataChanged =
        JSON.stringify(currentMetadata) !==
        JSON.stringify(lastMetadataRef.current);

      if (!contentChanged && !metadataChanged) {
        return;
      }

      // Don't save empty documents unless there's meaningful metadata
      if (
        !currentContent.trim() &&
        !currentMetadata.title?.trim() &&
        !currentMetadata.category?.trim() &&
        !currentMetadata.tags.length
      ) {
        return;
      }

      // Set new timeout with debounce
      timeoutRef.current = setTimeout(() => {
        saveDocument(currentContent, currentMetadata, 0);
      }, 2000);
    },
    [saveDocument]
  );

  // Auto-save when content or metadata changes
  useEffect(() => {
    if (content.trim() || metadata.title?.trim()) {
      debouncedSave(content, metadata);
    }
  }, [content, metadata, debouncedSave]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  const forceSave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }
    saveDocument(content, metadata, 0);
  }, [content, metadata, saveDocument]);

  const retryNow = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }
    saveDocument(content, metadata, 0);
  }, [content, metadata, saveDocument]);

  return {
    saveStatus,
    lastSaved,
    errorMessage,
    retryCount,
    forceSave,
    retryNow,
  };
};
