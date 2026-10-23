/**
 * Text diffing utility for user-friendly change highlighting
 * Uses word-level diffing to show additions, deletions, and modifications
 */

import { diffWordsInlineAware } from "./inlineTokenDiff";

export interface DiffOperation {
  type: "equal" | "insert" | "delete" | "replace";
  originalText: string;
  newText: string;
  originalIndex: number;
  newIndex: number;
}

export interface DiffResult {
  operations: DiffOperation[];
  hasChanges: boolean;
}

// Enhanced types for multi-step edit history
export type ChangeSource = "system" | "user";

export interface EnhancedDiffOperation extends DiffOperation {
  source?: ChangeSource;
  editId?: string;
  timestamp?: string;
  layered?: boolean; // true if this change overlaps with another change
  originalSource?: ChangeSource; // for tracking what the original change source was
}

export interface EnhancedDiffResult {
  operations: EnhancedDiffOperation[];
  hasChanges: boolean;
  hasMultipleSources: boolean; // true if both system and user changes are present
}

// Types for edit history integration
export interface FieldChangeDto {
  field: string;
  oldValue:
    | string
    | number
    | boolean
    | unknown[]
    | Record<string, unknown>
    | null;
  newValue:
    | string
    | number
    | boolean
    | unknown[]
    | Record<string, unknown>
    | null;
  dataType: string;
}

export interface EditHistoryEntryDto {
  id: string;
  timestamp: string;
  editedBy: ChangeSource;
  changes: FieldChangeDto[];
  correlationId?: string | null;
}

// Types for the new cumulative diff algorithm
interface ChangeRegion {
  startIndex: number;
  endIndex: number;
  source: ChangeSource;
  editId: string;
  timestamp: string;
  originalText: string;
  newText: string;
}

interface TextVersion {
  text: string;
  editId: string;
  timestamp: string;
  source: ChangeSource;
}

/**
 * Calculate word-level diff between two strings
 * Returns user-friendly diff operations for highlighting changes
 */
export const calculateWordDiff = (
  original: string,
  updated: string
): DiffResult => {
  // Handle edge cases
  if (original === updated) {
    return {
      operations: [
        {
          type: "equal",
          originalText: original,
          newText: updated,
          originalIndex: 0,
          newIndex: 0,
        },
      ],
      hasChanges: false,
    };
  }

  if (!original) {
    return {
      operations: [
        {
          type: "insert",
          originalText: "",
          newText: updated,
          originalIndex: 0,
          newIndex: 0,
        },
      ],
      hasChanges: true,
    };
  }

  if (!updated) {
    return {
      operations: [
        {
          type: "delete",
          originalText: original,
          newText: "",
          originalIndex: 0,
          newIndex: 0,
        },
      ],
      hasChanges: true,
    };
  }

  // Use Myers diff (via jsdiff) for cleaner word-level diffs. The mention-aware
  // variant keeps `@[type:id|title]` tokens atomic so they are never split
  // across operations (which would break mention rendering downstream).
  const changes = diffWordsInlineAware(original, updated);
  const rawOps = convertJsDiffToOperations(changes);

  return {
    operations: synthesizeReplaceOperations(rawOps),
    hasChanges: rawOps.some((op) => op.type !== "equal"),
  };
};

/**
 * Convert jsdiff Change[] output into our DiffOperation[] format
 */
const convertJsDiffToOperations = (
  changes: ReturnType<typeof diffWordsInlineAware>
): DiffOperation[] => {
  const operations: DiffOperation[] = [];
  let origIdx = 0;
  let newIdx = 0;

  for (const change of changes) {
    if (change.added) {
      operations.push({
        type: "insert",
        originalText: "",
        newText: change.value,
        originalIndex: origIdx,
        newIndex: newIdx,
      });
      newIdx += change.value.length;
    } else if (change.removed) {
      operations.push({
        type: "delete",
        originalText: change.value,
        newText: "",
        originalIndex: origIdx,
        newIndex: newIdx,
      });
      origIdx += change.value.length;
    } else {
      operations.push({
        type: "equal",
        originalText: change.value,
        newText: change.value,
        originalIndex: origIdx,
        newIndex: newIdx,
      });
      origIdx += change.value.length;
      newIdx += change.value.length;
    }
  }

  return operations;
};

/**
 * Merge consecutive delete+insert pairs into a single replace operation
 * for backward compatibility with consumers that expect 'replace' ops
 */
const synthesizeReplaceOperations = (
  operations: DiffOperation[]
): DiffOperation[] => {
  const result: DiffOperation[] = [];

  for (let i = 0; i < operations.length; i++) {
    const current = operations[i];
    const next = operations[i + 1];

    if (current.type === "delete" && next?.type === "insert") {
      result.push({
        type: "replace",
        originalText: current.originalText,
        newText: next.newText,
        originalIndex: current.originalIndex,
        newIndex: next.newIndex,
      });
      i++; // skip the insert we just consumed
    } else {
      result.push(current);
    }
  }

  return result;
};

/**
 * Apply a subset of diff operations to generate modified text
 */
export const applyDiffOperations = (
  operations: DiffOperation[],
  acceptedOperationIndices: Set<number>
): string => {
  let result = "";

  operations.forEach((operation, index) => {
    switch (operation.type) {
      case "equal":
        result += operation.originalText;
        break;
      case "insert":
        if (acceptedOperationIndices.has(index)) {
          result += operation.newText;
        }
        break;
      case "delete":
        if (!acceptedOperationIndices.has(index)) {
          result += operation.originalText;
        }
        break;
      case "replace":
        if (acceptedOperationIndices.has(index)) {
          result += operation.newText;
        } else {
          result += operation.originalText;
        }
        break;
    }
  });

  return result;
};

/**
 * Get preview text with all changes applied
 */
export const getPreviewText = (operations: DiffOperation[]): string => {
  return operations
    .map((op) => {
      switch (op.type) {
        case "equal":
        case "insert":
        case "replace":
          return op.newText;
        case "delete":
          return "";
        default:
          return op.originalText;
      }
    })
    .join("");
};

/**
 * Get original text from operations
 */
export const getOriginalText = (operations: DiffOperation[]): string => {
  return operations.map((op) => op.originalText).join("");
};

/**
 * Calculate cumulative diff by applying all changes sequentially
 * then computing single diff with source attribution
 */
const calculateCumulativeDiff = (
  textVersions: TextVersion[]
): EnhancedDiffOperation[] => {
  if (textVersions.length < 2) {
    return [];
  }

  const originalText = textVersions[0].text;
  const finalText = textVersions[textVersions.length - 1].text;

  // Build change regions by tracking modifications through each step
  const changeRegions = buildChangeRegions(textVersions);

  // Calculate single diff from original to final
  const baseOperations = calculateWordDiff(originalText, finalText);

  // Add source attribution to each operation
  return attributeOperationsToSources(baseOperations.operations, changeRegions);
};

/**
 * Build change regions by tracking modifications through each step
 */
const buildChangeRegions = (textVersions: TextVersion[]): ChangeRegion[] => {
  const regions: ChangeRegion[] = [];

  for (let i = 1; i < textVersions.length; i++) {
    const prevVersion = textVersions[i - 1];
    const currentVersion = textVersions[i];

    // Calculate diff for this step
    const stepDiff = calculateWordDiff(prevVersion.text, currentVersion.text);

    // Convert operations to change regions with position tracking
    let position = 0;
    for (const operation of stepDiff.operations) {
      if (operation.type !== "equal") {
        const region: ChangeRegion = {
          startIndex: position,
          endIndex: position + operation.originalText.length,
          source: currentVersion.source,
          editId: currentVersion.editId,
          timestamp: currentVersion.timestamp,
          originalText: operation.originalText,
          newText: operation.newText,
        };

        // Update existing regions that overlap with this new region
        updateOverlappingRegions(regions, region);
        regions.push(region);
      }

      // Move position forward for next operation
      if (operation.type !== "insert") {
        position += operation.originalText.length;
      }
    }
  }

  return regions;
};

/**
 * Update existing regions that overlap with a new region
 * When later edits modify text that was previously changed, we need to track this
 */
const updateOverlappingRegions = (
  existingRegions: ChangeRegion[],
  newRegion: ChangeRegion
): void => {
  for (const region of existingRegions) {
    // Check if regions overlap
    const hasOverlap = !(
      newRegion.endIndex <= region.startIndex ||
      newRegion.startIndex >= region.endIndex
    );

    if (hasOverlap) {
      // Mark the existing region as superseded by marking its end time
      // Later edits take precedence in source attribution
      region.originalText = ""; // Clear to indicate this region was overwritten
    }
  }
};

/**
 * Attribute operations to sources based on change regions
 */
const attributeOperationsToSources = (
  operations: DiffOperation[],
  changeRegions: ChangeRegion[]
): EnhancedDiffOperation[] => {
  const result: EnhancedDiffOperation[] = [];
  let position = 0;

  for (const operation of operations) {
    // Find which change region(s) this operation overlaps with
    const overlappingRegions = findOverlappingRegions(
      changeRegions,
      position,
      position + operation.originalText.length
    );

    // Determine source (use last source if multiple regions overlap)
    // Filter out superseded regions (those with empty originalText)
    const activeRegions = overlappingRegions.filter(
      (region) => region.originalText !== ""
    );
    const source =
      activeRegions.length > 0
        ? activeRegions[activeRegions.length - 1].source
        : "system"; // Default to system for unchanged text

    // Determine if this operation is layered (multiple sources involved)
    const uniqueSources = new Set(activeRegions.map((region) => region.source));
    const isLayered = uniqueSources.size > 1;

    // Get the edit ID and timestamp from the most recent change
    const mostRecentRegion = activeRegions[activeRegions.length - 1];

    result.push({
      ...operation,
      source,
      layered: isLayered,
      editId: mostRecentRegion?.editId,
      timestamp: mostRecentRegion?.timestamp,
    });

    // Move position forward for next operation
    if (operation.type !== "insert") {
      position += operation.originalText.length;
    }
  }

  return result;
};

/**
 * Find change regions that overlap with a given text range
 */
const findOverlappingRegions = (
  changeRegions: ChangeRegion[],
  startIndex: number,
  endIndex: number
): ChangeRegion[] => {
  return changeRegions.filter((region) => {
    // Check if ranges overlap
    return !(endIndex <= region.startIndex || startIndex >= region.endIndex);
  });
};

/**
 * Calculate multi-step diff from edit history entries
 * Applies changes chronologically while preserving source attribution
 */
export const calculateMultiStepDiff = (
  fieldName: string,
  editHistory: EditHistoryEntryDto[]
): EnhancedDiffResult => {
  // Filter and sort changes for the specific field
  const fieldChanges = editHistory
    .flatMap((entry) =>
      entry.changes
        .filter(
          (change) => change.field === fieldName && change.dataType === "string"
        )
        .map((change) => ({
          ...change,
          editId: entry.id,
          timestamp: entry.timestamp,
          source: entry.editedBy,
        }))
    )
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

  if (fieldChanges.length === 0) {
    return {
      operations: [],
      hasChanges: false,
      hasMultipleSources: false,
    };
  }

  // Build chronological chain of text versions
  const textVersions: TextVersion[] = [];

  // Add initial version (first oldValue)
  const firstChange = fieldChanges[0];
  if (firstChange.oldValue && typeof firstChange.oldValue === "string") {
    textVersions.push({
      text: firstChange.oldValue,
      editId: "initial",
      timestamp: "",
      source: "system", // assume initial content is system-generated
    });
  }

  // Add each subsequent version
  fieldChanges.forEach((change) => {
    if (change.newValue && typeof change.newValue === "string") {
      textVersions.push({
        text: change.newValue,
        editId: change.editId,
        timestamp: change.timestamp,
        source: change.source,
      });
    }
  });

  if (textVersions.length < 2) {
    return {
      operations: [],
      hasChanges: false,
      hasMultipleSources: false,
    };
  }

  // Calculate cumulative diff using the new algorithm
  const finalOperations = calculateCumulativeDiff(textVersions);

  // Check if multiple sources are present from actual changes (not initial state)
  const actualEditSources = new Set(
    fieldChanges.map((change) => change.source)
  );
  const hasMultipleSources = actualEditSources.size > 1;

  return {
    operations: finalOperations,
    hasChanges: finalOperations.some((op) => op.type !== "equal"),
    hasMultipleSources,
  };
};

/**
 * Enhanced version of applyDiffOperations for multi-source operations
 */
export const applyEnhancedDiffOperations = (
  operations: EnhancedDiffOperation[],
  acceptedOperationIndices: Set<number>
): string => {
  let result = "";

  operations.forEach((operation, index) => {
    switch (operation.type) {
      case "equal":
        result += operation.originalText;
        break;
      case "insert":
        if (acceptedOperationIndices.has(index)) {
          result += operation.newText;
        }
        break;
      case "delete":
        if (!acceptedOperationIndices.has(index)) {
          result += operation.originalText;
        }
        break;
      case "replace":
        if (acceptedOperationIndices.has(index)) {
          result += operation.newText;
        } else {
          result += operation.originalText;
        }
        break;
    }
  });

  return result;
};
