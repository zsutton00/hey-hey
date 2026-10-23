/**
 * Text diffing utility for user-friendly change highlighting
 * Uses word-level diffing to show additions, deletions, and modifications
 */

interface DiffOperation {
  type: "equal" | "insert" | "delete" | "replace";
  originalText: string;
  newText: string;
  originalIndex: number;
  newIndex: number;
}

interface DiffResult {
  operations: DiffOperation[];
  hasChanges: boolean;
}

// Enhanced types for multi-step edit history
type ChangeSource = "system" | "user";

interface EnhancedDiffOperation extends DiffOperation {
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
interface FieldChangeDto {
  field: string;
  oldValue:
    string | number | boolean | unknown[] | Record<string, unknown> | null;
  newValue:
    string | number | boolean | unknown[] | Record<string, unknown> | null;
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
const calculateWordDiff = (original: string, updated: string): DiffResult => {
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

  // Split into words, preserving whitespace
  const originalWords = splitIntoWords(original);
  const updatedWords = splitIntoWords(updated);

  // Calculate diff using dynamic programming (similar to Levenshtein)
  const operations = calculateDiffOperations(originalWords, updatedWords);

  return {
    operations,
    hasChanges: operations.some((op) => op.type !== "equal"),
  };
};

/**
 * Split text into words while preserving whitespace and punctuation
 */
const splitIntoWords = (text: string): string[] => {
  // Match words, whitespace, and punctuation separately
  const wordRegex = /\S+|\s+/g;
  return text.match(wordRegex) || [];
};

/**
 * Calculate diff operations using dynamic programming
 */
const calculateDiffOperations = (
  originalWords: string[],
  updatedWords: string[],
): DiffOperation[] => {
  const m = originalWords.length;
  const n = updatedWords.length;

  // Create DP table for edit distance
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  // Initialize base cases
  for (let i = 0; i <= m; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }

  // Fill DP table
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (originalWords[i - 1] === updatedWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] =
          1 +
          Math.min(
            dp[i - 1][j], // deletion
            dp[i][j - 1], // insertion
            dp[i - 1][j - 1], // replacement
          );
      }
    }
  }

  // Backtrack to find operations
  const operations: DiffOperation[] = [];
  let i = m,
    j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && originalWords[i - 1] === updatedWords[j - 1]) {
      // Equal
      operations.unshift({
        type: "equal",
        originalText: originalWords[i - 1],
        newText: updatedWords[j - 1],
        originalIndex: i - 1,
        newIndex: j - 1,
      });
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      // Replace
      operations.unshift({
        type: "replace",
        originalText: originalWords[i - 1],
        newText: updatedWords[j - 1],
        originalIndex: i - 1,
        newIndex: j - 1,
      });
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      // Delete
      operations.unshift({
        type: "delete",
        originalText: originalWords[i - 1],
        newText: "",
        originalIndex: i - 1,
        newIndex: j,
      });
      i--;
    } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
      // Insert
      operations.unshift({
        type: "insert",
        originalText: "",
        newText: updatedWords[j - 1],
        originalIndex: i,
        newIndex: j - 1,
      });
      j--;
    }
  }

  return mergeConsecutiveOperations(operations);
};

/**
 * Merge consecutive operations of the same type for better UX
 */
const mergeConsecutiveOperations = (
  operations: DiffOperation[],
): DiffOperation[] => {
  if (operations.length <= 1) return operations;

  const merged: DiffOperation[] = [];
  let current = operations[0];

  for (let i = 1; i < operations.length; i++) {
    const next = operations[i];

    // Merge consecutive operations of the same type
    if (current.type === next.type && current.type !== "equal") {
      current = {
        ...current,
        originalText: current.originalText + next.originalText,
        newText: current.newText + next.newText,
      };
    } else {
      merged.push(current);
      current = next;
    }
  }

  merged.push(current);
  return merged;
};

/**
 * Calculate cumulative diff by applying all changes sequentially
 * then computing single diff with source attribution
 */
const calculateCumulativeDiff = (
  textVersions: TextVersion[],
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
  newRegion: ChangeRegion,
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
  changeRegions: ChangeRegion[],
): EnhancedDiffOperation[] => {
  const result: EnhancedDiffOperation[] = [];
  let position = 0;

  for (const operation of operations) {
    // Find which change region(s) this operation overlaps with
    const overlappingRegions = findOverlappingRegions(
      changeRegions,
      position,
      position + operation.originalText.length,
    );

    // Determine source (use last source if multiple regions overlap)
    // Filter out superseded regions (those with empty originalText)
    const activeRegions = overlappingRegions.filter(
      (region) => region.originalText !== "",
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
  endIndex: number,
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
  editHistory: EditHistoryEntryDto[],
): EnhancedDiffResult => {
  // Filter and sort changes for the specific field
  const fieldChanges = editHistory
    .flatMap((entry) =>
      entry.changes
        .filter(
          (change) =>
            change.field === fieldName && change.dataType === "string",
        )
        .map((change) => ({
          ...change,
          editId: entry.id,
          timestamp: entry.timestamp,
          source: entry.editedBy,
        })),
    )
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
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
    fieldChanges.map((change) => change.source),
  );
  const hasMultipleSources = actualEditSources.size > 1;

  return {
    operations: finalOperations,
    hasChanges: finalOperations.some((op) => op.type !== "equal"),
    hasMultipleSources,
  };
};
