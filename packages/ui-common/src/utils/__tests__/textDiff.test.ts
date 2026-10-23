/**
 * Regression tests for textDiff functionality
 * Specifically tests the fix for the diff calculation bug
 */

import { calculateMultiStepDiff } from "../textDiff";
import type { EditHistoryEntryDto, EnhancedDiffOperation } from "../textDiff";

/**
 * Helper function to check if operations have conflicts
 */
function hasConflictingOperations(
  operations: EnhancedDiffOperation[]
): boolean {
  // Look for duplicate or conflicting operations that would cause incorrect text reconstruction
  const textPositions = new Map<number, string[]>();
  let position = 0;

  for (const op of operations) {
    if (op.type !== "equal") {
      const existing = textPositions.get(position) || [];
      existing.push(`${op.type}:${op.originalText}->${op.newText}`);
      textPositions.set(position, existing);

      // If there are multiple non-equal operations at the same position, it's a conflict
      if (existing.length > 1) {
        return true;
      }
    }

    if (op.type !== "insert") {
      position += op.originalText.length;
    }
  }

  return false;
}

/**
 * Helper function to reconstruct text from diff operations
 */
function reconstructTextFromOperations(
  operations: EnhancedDiffOperation[]
): string {
  return operations
    .map((op) => {
      switch (op.type) {
        case "equal":
          return op.originalText;
        case "insert":
          return op.newText;
        case "replace":
          return op.newText;
        case "delete":
          return "";
        default:
          return op.originalText;
      }
    })
    .join("");
}

describe("calculateMultiStepDiff - Regression Tests", () => {
  test("CRITICAL BUG FIX: I love cats → I love all cats → I love my cat", () => {
    const editHistory: EditHistoryEntryDto[] = [
      {
        id: "edit1",
        timestamp: "2024-01-01T10:00:00Z",
        editedBy: "system",
        changes: [
          {
            field: "description",
            oldValue: "I love cats",
            newValue: "I love all cats",
            dataType: "string",
          },
        ],
      },
      {
        id: "edit2",
        timestamp: "2024-01-01T10:01:00Z",
        editedBy: "user",
        changes: [
          {
            field: "description",
            oldValue: "I love all cats",
            newValue: "I love my cat",
            dataType: "string",
          },
        ],
      },
    ];

    const result = calculateMultiStepDiff("description", editHistory);

    // Reconstruct text from operations - THIS IS THE CRITICAL TEST
    const reconstructedText = reconstructTextFromOperations(result.operations);

    // MOST IMPORTANT: Final text must be exactly correct
    expect(reconstructedText).toBe("I love my cat");

    // Should detect changes
    expect(result.hasChanges).toBe(true);

    // Should detect multiple sources
    expect(result.hasMultipleSources).toBe(true);

    // No conflicting operations (this was the bug)
    const hasConflicts = hasConflictingOperations(result.operations);
    expect(hasConflicts).toBe(false);

    // Source attribution should be present
    expect(result.operations.some((op) => op.source === "system")).toBe(true);
    expect(result.operations.some((op) => op.source === "user")).toBe(true);

    // The word "my" must be present in the operations somewhere
    const allOperationText = result.operations
      .map((op) => op.newText || op.originalText)
      .join("");
    expect(allOperationText).toContain("my");
  });

  test("Simple single edit should work correctly", () => {
    const editHistory: EditHistoryEntryDto[] = [
      {
        id: "edit1",
        timestamp: "2024-01-01T10:00:00Z",
        editedBy: "user",
        changes: [
          {
            field: "description",
            oldValue: "I love cats",
            newValue: "I love my cat",
            dataType: "string",
          },
        ],
      },
    ];

    const result = calculateMultiStepDiff("description", editHistory);

    // Reconstruct text from operations
    const reconstructedText = reconstructTextFromOperations(result.operations);

    // Final text must be correct
    expect(reconstructedText).toBe("I love my cat");

    // Should detect changes
    expect(result.hasChanges).toBe(true);

    // Should not detect multiple sources (only user)
    expect(result.hasMultipleSources).toBe(false);

    // No conflicting operations
    const hasConflicts = hasConflictingOperations(result.operations);
    expect(hasConflicts).toBe(false);
  });

  test("Multiple edits from same source should work correctly", () => {
    const editHistory: EditHistoryEntryDto[] = [
      {
        id: "edit1",
        timestamp: "2024-01-01T10:00:00Z",
        editedBy: "system",
        changes: [
          {
            field: "description",
            oldValue: "I love cats",
            newValue: "I love all cats",
            dataType: "string",
          },
        ],
      },
      {
        id: "edit2",
        timestamp: "2024-01-01T10:01:00Z",
        editedBy: "system",
        changes: [
          {
            field: "description",
            oldValue: "I love all cats",
            newValue: "I love all my cats",
            dataType: "string",
          },
        ],
      },
    ];

    const result = calculateMultiStepDiff("description", editHistory);

    // Reconstruct text from operations
    const reconstructedText = reconstructTextFromOperations(result.operations);

    // Final text must be correct
    expect(reconstructedText).toBe("I love all my cats");

    // Should detect changes
    expect(result.hasChanges).toBe(true);

    // Should not detect multiple sources (only system)
    expect(result.hasMultipleSources).toBe(false);

    // No conflicting operations
    const hasConflicts = hasConflictingOperations(result.operations);
    expect(hasConflicts).toBe(false);
  });

  test("Empty edit history should return no changes", () => {
    const result = calculateMultiStepDiff("description", []);

    expect(result.hasChanges).toBe(false);
    expect(result.hasMultipleSources).toBe(false);
    expect(result.operations).toEqual([]);
  });

  test("No actual changes should return no changes", () => {
    const editHistory: EditHistoryEntryDto[] = [
      {
        id: "edit1",
        timestamp: "2024-01-01T10:00:00Z",
        editedBy: "system",
        changes: [
          {
            field: "description",
            oldValue: "Same text",
            newValue: "Same text",
            dataType: "string",
          },
        ],
      },
    ];

    const result = calculateMultiStepDiff("description", editHistory);

    expect(result.hasChanges).toBe(false);
    expect(result.hasMultipleSources).toBe(false);
  });

  test("Complex overlapping changes scenario", () => {
    const editHistory: EditHistoryEntryDto[] = [
      {
        id: "edit1",
        timestamp: "2024-01-01T10:00:00Z",
        editedBy: "system",
        changes: [
          {
            field: "description",
            oldValue: "The quick brown fox",
            newValue: "The quick brown fox jumps",
            dataType: "string",
          },
        ],
      },
      {
        id: "edit2",
        timestamp: "2024-01-01T10:01:00Z",
        editedBy: "user",
        changes: [
          {
            field: "description",
            oldValue: "The quick brown fox jumps",
            newValue: "The slow brown fox jumps",
            dataType: "string",
          },
        ],
      },
      {
        id: "edit3",
        timestamp: "2024-01-01T10:02:00Z",
        editedBy: "system",
        changes: [
          {
            field: "description",
            oldValue: "The slow brown fox jumps",
            newValue: "The slow brown fox jumps high",
            dataType: "string",
          },
        ],
      },
    ];

    const result = calculateMultiStepDiff("description", editHistory);

    // Reconstruct text from operations
    const reconstructedText = reconstructTextFromOperations(result.operations);

    // Final text must be correct
    expect(reconstructedText).toBe("The slow brown fox jumps high");

    // Should detect changes
    expect(result.hasChanges).toBe(true);

    // Should detect multiple sources
    expect(result.hasMultipleSources).toBe(true);

    // No conflicting operations
    const hasConflicts = hasConflictingOperations(result.operations);
    expect(hasConflicts).toBe(false);

    // Should have operations from both sources
    expect(result.operations.some((op) => op.source === "system")).toBe(true);
    expect(result.operations.some((op) => op.source === "user")).toBe(true);
  });
});
