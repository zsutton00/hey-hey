import type { AdrContentApplyPayloadAllOfSections } from "../../api";
import { useCallback, useMemo, useRef } from "react";
import type { LexicalEditor } from "lexical";
import { $getRoot } from "lexical";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
import { log } from "../../utils/logger";

const SUGGESTED_CONTENT_ORIGIN = "ui-common:collab-suggestion";
const CHUNK_SIZE_THRESHOLD = 30 * 1024; // 30KB - if estimated update > this, use chunking
const TARGET_CHUNK_SIZE = 20 * 1024; // 20KB per chunk
const CHUNK_DELAY_MS = 75; // 75ms between chunks
const MIN_CHUNK_SIZE = 512; // Below this, don't retry
const MAX_RETRY_DEPTH = 5; // Prevent infinite recursion

/**
 * Splits markdown content into chunks of approximately targetSize bytes.
 * Simple byte-based splitting - may break mid-word or mid-sentence.
 */
function chunkMarkdown(content: string, targetSize: number): string[] {
  if (content.length <= targetSize) {
    return [content];
  }

  const chunks: string[] = [];
  let offset = 0;

  while (offset < content.length) {
    const chunkEnd = Math.min(offset + targetSize, content.length);
    chunks.push(content.substring(offset, chunkEnd));
    offset = chunkEnd;
  }

  return chunks;
}

/**
 * Estimates the Yjs update size for a given content string.
 * Conservative estimate: content.length * 1.5 (accounting for Yjs encoding overhead)
 */
function estimateUpdateSize(content: string): number {
  return content.length * 1.5;
}

export function useDesignDocCollabBridgeValue(
  designDocId: string,
  organizationId: string
) {
  const editorRegistryRef = useRef(new Map<string, LexicalEditor>());

  const registerEditor = useCallback(
    (sectionKey: string, editor: LexicalEditor) => {
      editorRegistryRef.current.set(sectionKey.toLowerCase(), editor);
    },
    []
  );

  const unregisterEditor = useCallback(
    (sectionKey: string, editor: LexicalEditor) => {
      const key = sectionKey.toLowerCase();
      const stored = editorRegistryRef.current.get(key);
      if (stored === editor) {
        editorRegistryRef.current.delete(key);
      }
    },
    []
  );

  const getCurrentContent = useCallback((sectionKey: string): string => {
    const editor = editorRegistryRef.current.get(sectionKey.toLowerCase());
    if (!editor) {
      return "";
    }
    let markdown = "";
    editor.getEditorState().read(() => {
      markdown = $convertToMarkdownString(TRANSFORMERS);
    });
    return markdown;
  }, []);

  /**
   * Attempts to apply content, retrying with smaller chunks if it fails.
   */
  const applyContentWithRetry = useCallback(
    async (
      editor: LexicalEditor,
      targetContent: string,
      currentContent: string,
      retryChunkSize: number,
      sectionKey: string,
      chunkIndex: number,
      depth: number = 0
    ): Promise<boolean> => {
      if (depth > MAX_RETRY_DEPTH) {
        log.error("collab", "Max retry depth exceeded", {
          designDocId,
          organizationId,
          sectionKey,
          depth,
        });
        return false;
      }

      // Try applying the target content directly
      try {
        await new Promise<void>((resolve) => {
          editor.update(
            () => {
              const root = $getRoot();
              root.clear();
              $convertFromMarkdownString(targetContent, TRANSFORMERS);
              resolve();
            },
            {
              tag: [SUGGESTED_CONTENT_ORIGIN],
            }
          );
        });

        // Wait for Yjs to process
        await new Promise((resolve) => setTimeout(resolve, 100));

        return true;
      } catch (error) {
        log.error("collab", "Error applying content", {
          designDocId,
          organizationId,
          sectionKey,
          chunkIndex,
          depth,
          error: error instanceof Error ? error.message : String(error),
        });

        // If target content is small enough, can't retry further
        const newContentSize = targetContent.length - currentContent.length;
        if (newContentSize <= MIN_CHUNK_SIZE) {
          log.error("collab", "Content too small to split further", {
            designDocId,
            organizationId,
            sectionKey,
            chunkIndex,
            newContentSize,
          });
          return false;
        }

        // Retry with smaller chunks
        log.warn("collab", "Retrying with smaller chunks", {
          designDocId,
          organizationId,
          sectionKey,
          chunkIndex,
          originalSize: newContentSize,
          retryChunkSize,
          depth,
        });

        // Split the NEW content (delta from current to target) into smaller chunks
        const deltaContent = targetContent.substring(currentContent.length);
        const subChunks = chunkMarkdown(deltaContent, retryChunkSize);

        let accumulatedContent = currentContent;
        for (const subChunk of subChunks) {
          accumulatedContent += subChunk;
          const success = await applyContentWithRetry(
            editor,
            accumulatedContent,
            accumulatedContent.substring(
              0,
              accumulatedContent.length - subChunk.length
            ),
            retryChunkSize / 2,
            sectionKey,
            chunkIndex,
            depth + 1
          );

          if (!success) {
            return false;
          }

          // Delay between retry sub-chunks
          await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
        }

        return true;
      }
    },
    [designDocId, organizationId]
  );

  /**
   * Applies content to editor in chunks with retry-on-failure.
   * Disables editor during chunk application to prevent user edits from conflicting.
   */
  const applyContentInChunks = useCallback(
    async (
      editor: LexicalEditor,
      content: string,
      sectionKey: string
    ): Promise<boolean> => {
      const chunks = chunkMarkdown(content, TARGET_CHUNK_SIZE);

      log.info("collab", "Applying content in chunks", {
        designDocId,
        organizationId,
        sectionKey,
        totalSize: content.length,
        chunkCount: chunks.length,
        chunkSize: TARGET_CHUNK_SIZE,
      });

      // Disable editor to prevent user edits during chunk application
      editor.setEditable(false);

      try {
        let appliedContent = "";

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          appliedContent += chunk;

          const previousContent = appliedContent.substring(
            0,
            appliedContent.length - chunk.length
          );
          const success = await applyContentWithRetry(
            editor,
            appliedContent,
            previousContent,
            TARGET_CHUNK_SIZE / 2,
            sectionKey,
            i
          );

          if (!success) {
            log.error("collab", "Failed to apply chunk after retries", {
              designDocId,
              organizationId,
              sectionKey,
              chunkIndex: i,
              chunkSize: chunk.length,
            });
            return false;
          }

          // Delay between chunks (except after last chunk)
          if (i < chunks.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
          }
        }

        return true;
      } finally {
        // Always re-enable editor, even if application failed
        editor.setEditable(true);
      }
    },
    [designDocId, applyContentWithRetry, organizationId]
  );

  const applySuggestedSectionsViaCollab = useCallback(
    async (
      sectionsToApply: AdrContentApplyPayloadAllOfSections[]
    ): Promise<boolean> => {
      if (!sectionsToApply || sectionsToApply.length === 0) {
        return true;
      }

      const missingKeys: string[] = [];

      for (let index = 0; index < sectionsToApply.length; index++) {
        const section = sectionsToApply[index];
        const normalizedKey = section.key.toLowerCase();
        const editorInstance = editorRegistryRef.current.get(normalizedKey);

        if (!editorInstance) {
          missingKeys.push(section.key);
          continue;
        }

        const contentLength = section.content?.length || 0;
        const estimatedSize = estimateUpdateSize(section.content || "");
        const willChunk = estimatedSize > CHUNK_SIZE_THRESHOLD;

        log.info("collab", "Applying suggested section", {
          designDocId,
          organizationId,
          sectionKey: section.key,
          sectionIndex: index,
          contentLength,
          estimatedSize,
          willChunk,
        });

        // Use chunking for large content
        if (willChunk) {
          const success = await applyContentInChunks(
            editorInstance,
            section.content || "",
            section.key
          );

          if (!success) {
            log.error("collab", "Failed to apply chunked content", {
              designDocId,
              organizationId,
              sectionKey: section.key,
            });
            return false;
          }
        } else {
          // Use original single-update approach for small content
          editorInstance.update(
            () => {
              const root = $getRoot();
              root.clear();
              if (section.content) {
                $convertFromMarkdownString(section.content, TRANSFORMERS);
              }
            },
            {
              tag: [SUGGESTED_CONTENT_ORIGIN],
            }
          );
        }
      }

      if (missingKeys.length > 0) {
        log.error("ui", "Missing collaboration clients for sections", {
          designDocId,
          organizationId,
          missingKeys,
        });
        return false;
      }

      return true;
    },
    [designDocId, organizationId, applyContentInChunks]
  );

  const collabBridgeValue = useMemo(
    () => ({
      hasCollab: true,
      applySections: applySuggestedSectionsViaCollab,
      registerEditor,
      unregisterEditor,
      getCurrentContent,
    }),
    [
      applySuggestedSectionsViaCollab,
      getCurrentContent,
      registerEditor,
      unregisterEditor,
    ]
  );

  return collabBridgeValue;
}
