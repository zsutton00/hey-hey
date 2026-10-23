/**
 * EditHistoryDiffPlugin for LexicalSuggestionEditor
 * Displays highlighted diffs showing system vs user changes from edit history
 * Integrates with the existing diff highlighting infrastructure
 */

import React, { useEffect, useCallback, useRef } from "react";
import { $getRoot, $createTextNode, $createParagraphNode } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createDiffTextNode,
  type DiffType,
  type DiffSource,
} from "../nodes/DiffTextNode";
import { log } from "../../../utils/logger";
import {
  calculateWordDiff,
  type EditHistoryEntryDto,
  type EnhancedDiffResult,
  type EnhancedDiffOperation,
} from "../../../utils/textDiff";

export interface EditHistoryDiffPluginProps {
  editHistory: EditHistoryEntryDto[];
  enabled?: boolean;
  onDiffCalculated?: (diffResult: EnhancedDiffResult) => void;
}

/**
 * Plugin to render edit history diffs in the Lexical editor
 * Shows highlighted text with system vs user changes
 */
export const EditHistoryDiffPlugin: React.FC<EditHistoryDiffPluginProps> = ({
  editHistory,
  enabled = true,
  onDiffCalculated,
}) => {
  const [editor] = useLexicalComposerContext();
  const lastEditHistoryRef = useRef<EditHistoryEntryDto[]>([]);
  const lastDiffResultRef = useRef<EnhancedDiffResult | null>(null);

  // Calculate and apply diff highlighting
  const applyDiffHighlighting = useCallback(
    (diffResult: EnhancedDiffResult) => {
      if (!enabled) return;

      editor.update(() => {
        const root = $getRoot();
        root.clear();

        if (diffResult.operations.length === 0) {
          // No changes to display
          const paragraph = $createParagraphNode();
          paragraph.append($createTextNode("No content available"));
          root.append(paragraph);
          return;
        }

        // Create paragraph to hold the diff content
        const paragraph = $createParagraphNode();

        // Render each operation using DiffTextNode for proper styling
        diffResult.operations.forEach((operation: EnhancedDiffOperation) => {
          let textContent = "";
          let diffType: DiffType = "equal";

          switch (operation.type) {
            case "equal":
              textContent = operation.originalText;
              diffType = "equal";
              break;
            case "insert":
              textContent = operation.newText;
              diffType = "addition";
              break;
            case "delete":
              // For deletions, we show the text but it will be styled differently
              textContent = operation.originalText;
              diffType = "deletion";
              break;
            case "replace":
              textContent = operation.newText;
              diffType = "replacement";
              break;
          }

          if (textContent) {
            // Use DiffTextNode with proper type and source
            const source: DiffSource =
              operation.source === "user" ? "user" : "system";
            const diffNode = $createDiffTextNode(textContent, diffType, source);
            paragraph.append(diffNode);
          }
        });

        root.append(paragraph);
      });

      log.debug("editor", "EditHistoryDiffPlugin: Applied diff highlighting", {
        operationCount: diffResult.operations.length,
        hasMultipleSources: diffResult.hasMultipleSources,
        hasChanges: diffResult.hasChanges,
      });
    },
    [editor, enabled],
  );

  // Calculate diff when edit history changes
  useEffect(() => {
    if (!enabled || editHistory.length === 0) {
      return;
    }

    // Check if edit history actually changed to avoid unnecessary recalculations
    const editHistoryChanged =
      JSON.stringify(editHistory) !==
      JSON.stringify(lastEditHistoryRef.current);

    if (!editHistoryChanged && lastDiffResultRef.current) {
      return;
    }

    // Find the most recent edit (last edit chronologically)
    const sortedEdits = [...editHistory].sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    const lastEdit = sortedEdits[0];

    if (!lastEdit || lastEdit.editedBy !== "system") {
      // Last edit wasn't by system, no diffs to show
      const emptyResult: EnhancedDiffResult = {
        operations: [],
        hasChanges: false,
        hasMultipleSources: false,
      };

      lastEditHistoryRef.current = [...editHistory];
      lastDiffResultRef.current = emptyResult;
      applyDiffHighlighting(emptyResult);
      onDiffCalculated?.(emptyResult);
      return;
    }

    // Last edit was by system - show what it changed
    let allOperations: EnhancedDiffOperation[] = [];
    let hasAnyChanges = false;

    lastEdit.changes.forEach((change) => {
      if (
        change.dataType === "string" &&
        typeof change.oldValue === "string" &&
        typeof change.newValue === "string"
      ) {
        // Calculate diff for this field change
        const fieldDiff = calculateWordDiff(change.oldValue, change.newValue);

        if (fieldDiff.hasChanges) {
          hasAnyChanges = true;

          // Convert to enhanced operations
          const enhancedOps: EnhancedDiffOperation[] = fieldDiff.operations.map(
            (op) => ({
              ...op,
              source: "system",
              editId: lastEdit.id,
              timestamp: lastEdit.timestamp,
            }),
          );

          allOperations = allOperations.concat(enhancedOps);
        }
      }
    });

    const diffResult: EnhancedDiffResult = {
      operations: allOperations,
      hasChanges: hasAnyChanges,
      hasMultipleSources: false, // Simplified - only showing system changes
    };

    // Store for comparison next time
    lastEditHistoryRef.current = [...editHistory];
    lastDiffResultRef.current = diffResult;

    // Apply the highlighting
    applyDiffHighlighting(diffResult);

    // Notify parent component
    onDiffCalculated?.(diffResult);

    log.debug(
      "editor",
      "EditHistoryDiffPlugin: Calculated diff from edit history",
      {
        editHistoryLength: editHistory.length,
        operationCount: diffResult.operations.length,
        hasChanges: diffResult.hasChanges,
        lastEditWasSystem: lastEdit.editedBy === "system",
        lastEditId: lastEdit.id,
      },
    );
  }, [editHistory, enabled, applyDiffHighlighting, onDiffCalculated]);

  // Clear highlighting when disabled
  useEffect(() => {
    if (!enabled) {
      editor.update(() => {
        const root = $getRoot();
        root.clear();

        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode(""));
        root.append(paragraph);
      });
    }
  }, [enabled, editor]);

  // This plugin doesn't render any UI itself - it just modifies the editor content
  return null;
};
