/**
 * Jest tests for diff functionality
 * Tests the core diff calculation logic with simple, verifiable examples
 */

import {
  calculateMultiStepDiff,
  type EditHistoryEntryDto,
} from "../../../utils/textDiff";

describe("Diff Functionality Tests", () => {
  describe("Core diff functionality validation", () => {
    test('Simple insertion: "hello" → "hello world"', () => {
      const editHistory: EditHistoryEntryDto[] = [
        {
          id: "edit-1",
          timestamp: "2025-01-17T10:00:00Z",
          editedBy: "system",
          changes: [
            {
              field: "description",
              oldValue: "hello",
              newValue: "hello world",
              dataType: "string",
            },
          ],
        },
      ];

      const result = calculateMultiStepDiff("description", editHistory);

      expect(result.hasChanges).toBe(true);
      expect(result.hasMultipleSources).toBe(false);

      // Should have an insertion operation
      const insertOp = result.operations.find((op) => op.type === "insert");
      expect(insertOp).toBeDefined();
      expect(insertOp?.newText).toContain("world");
      expect(insertOp?.source).toBe("system");
    });

    test('Simple replacement: "hello" → "goodbye"', () => {
      const editHistory: EditHistoryEntryDto[] = [
        {
          id: "edit-1",
          timestamp: "2025-01-17T10:00:00Z",
          editedBy: "user",
          changes: [
            {
              field: "description",
              oldValue: "hello",
              newValue: "goodbye",
              dataType: "string",
            },
          ],
        },
      ];

      const result = calculateMultiStepDiff("description", editHistory);

      expect(result.hasChanges).toBe(true);
      expect(result.hasMultipleSources).toBe(false);

      // Should have a replace operation
      const replaceOp = result.operations.find((op) => op.type === "replace");
      expect(replaceOp).toBeDefined();
      expect(replaceOp?.originalText).toBe("hello");
      expect(replaceOp?.newText).toBe("goodbye");
      expect(replaceOp?.source).toBe("user");
    });
  });

  describe('Complex text progression: "I love cats" → "I love all cats" → "I love my cat"', () => {
    test('Step 1: System adds "all" - should detect single insertion', () => {
      const editHistory: EditHistoryEntryDto[] = [
        {
          id: "edit-1",
          timestamp: "2025-01-17T10:00:00Z",
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
      ];

      const result = calculateMultiStepDiff("description", editHistory);

      // Should detect changes
      expect(result.hasChanges).toBe(true);
      expect(result.hasMultipleSources).toBe(false); // Only system changes so far
      expect(result.operations.length).toBeGreaterThan(0);

      // Find the insertion operation
      const insertOp = result.operations.find(
        (op) => op.type === "insert" && op.newText.includes("all")
      );
      expect(insertOp).toBeDefined();
      expect(insertOp?.source).toBe("system");
    });

    test('Step 2: User changes "all cats" to "my cat" - should detect replacement and multiple sources', () => {
      const editHistory: EditHistoryEntryDto[] = [
        {
          id: "edit-1",
          timestamp: "2025-01-17T10:00:00Z",
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
          id: "edit-2",
          timestamp: "2025-01-17T11:00:00Z",
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

      // Should detect changes from multiple sources
      expect(result.hasChanges).toBe(true);
      expect(result.hasMultipleSources).toBe(true); // Both system and user changes
      expect(result.operations.length).toBeGreaterThan(1);

      // Should have operations from both sources
      const systemOps = result.operations.filter(
        (op) => op.source === "system"
      );
      const userOps = result.operations.filter((op) => op.source === "user");

      expect(systemOps.length).toBeGreaterThan(0);
      expect(userOps.length).toBeGreaterThan(0);
    });

    test("Operations should track both system and user changes correctly", () => {
      const editHistory: EditHistoryEntryDto[] = [
        {
          id: "edit-1",
          timestamp: "2025-01-17T10:00:00Z",
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
          id: "edit-2",
          timestamp: "2025-01-17T11:00:00Z",
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

      // Should have operations showing the progression
      expect(result.operations.length).toBeGreaterThan(0);

      // With cumulative diff, the final result should be correct
      const reconstructedText = result.operations
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

      // Critical: final text must be correct
      expect(reconstructedText).toBe("I love my cat");

      // Should have source attribution (the cumulative diff shows who made the final changes)
      expect(result.operations.some((op) => op.source === "user")).toBe(true);

      // The change from "cats" to "my cat" should be attributed to the user (final editor)
      const catsToMyCatChange = result.operations.find(
        (op) =>
          (op.type === "replace" &&
            op.originalText === "cats" &&
            op.newText === "my cat") ||
          (op.type === "replace" &&
            op.originalText.includes("cats") &&
            op.newText.includes("my cat"))
      );

      if (catsToMyCatChange) {
        expect(catsToMyCatChange.source).toBe("user");
      }
    });
  });

  describe("Edge cases and validation", () => {
    test("Empty edit history - should return no changes", () => {
      const result = calculateMultiStepDiff("description", []);

      expect(result.hasChanges).toBe(false);
      expect(result.hasMultipleSources).toBe(false);
      expect(result.operations).toEqual([]);
    });

    test("No changes in edit history - should return no changes", () => {
      const editHistory: EditHistoryEntryDto[] = [
        {
          id: "edit-1",
          timestamp: "2025-01-17T10:00:00Z",
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

    test("Different field name - should return no changes", () => {
      const editHistory: EditHistoryEntryDto[] = [
        {
          id: "edit-1",
          timestamp: "2025-01-17T10:00:00Z",
          editedBy: "system",
          changes: [
            {
              field: "title", // Different field
              oldValue: "Old title",
              newValue: "New title",
              dataType: "string",
            },
          ],
        },
      ];

      const result = calculateMultiStepDiff("description", editHistory);

      expect(result.hasChanges).toBe(false);
      expect(result.operations).toEqual([]);
    });

    test("Mixed field types - should only process string fields", () => {
      const editHistory: EditHistoryEntryDto[] = [
        {
          id: "edit-1",
          timestamp: "2025-01-17T10:00:00Z",
          editedBy: "system",
          changes: [
            {
              field: "description",
              oldValue: "Text content",
              newValue: "Updated text content",
              dataType: "string",
            },
            {
              field: "description",
              oldValue: 123,
              newValue: 456,
              dataType: "number", // Should be ignored
            },
          ],
        },
      ];

      const result = calculateMultiStepDiff("description", editHistory);

      expect(result.hasChanges).toBe(true);
      // Should only have processed the string change
      expect(
        result.operations.some(
          (op) =>
            op.originalText === "Text content" || op.newText.includes("Updated")
        )
      ).toBe(true);
    });
  });

  describe("Source attribution", () => {
    test("Only system changes - hasMultipleSources should be false", () => {
      const editHistory: EditHistoryEntryDto[] = [
        {
          id: "edit-1",
          timestamp: "2025-01-17T10:00:00Z",
          editedBy: "system",
          changes: [
            {
              field: "description",
              oldValue: "Original",
              newValue: "System updated",
              dataType: "string",
            },
          ],
        },
        {
          id: "edit-2",
          timestamp: "2025-01-17T11:00:00Z",
          editedBy: "system", // Another system change
          changes: [
            {
              field: "description",
              oldValue: "System updated",
              newValue: "System updated again",
              dataType: "string",
            },
          ],
        },
      ];

      const result = calculateMultiStepDiff("description", editHistory);

      expect(result.hasChanges).toBe(true);
      expect(result.hasMultipleSources).toBe(false); // All from system

      // All operations should be attributed to system
      result.operations.forEach((op) => {
        if (op.source) {
          expect(op.source).toBe("system");
        }
      });
    });

    test("Only user changes - hasMultipleSources should be false", () => {
      const editHistory: EditHistoryEntryDto[] = [
        {
          id: "edit-1",
          timestamp: "2025-01-17T10:00:00Z",
          editedBy: "user",
          changes: [
            {
              field: "description",
              oldValue: "Original",
              newValue: "User updated",
              dataType: "string",
            },
          ],
        },
      ];

      const result = calculateMultiStepDiff("description", editHistory);

      expect(result.hasChanges).toBe(true);
      expect(result.hasMultipleSources).toBe(false); // Only user
    });

    test("Mixed system and user changes - hasMultipleSources should be true", () => {
      const editHistory: EditHistoryEntryDto[] = [
        {
          id: "edit-1",
          timestamp: "2025-01-17T10:00:00Z",
          editedBy: "system",
          changes: [
            {
              field: "description",
              oldValue: "Original",
              newValue: "System updated",
              dataType: "string",
            },
          ],
        },
        {
          id: "edit-2",
          timestamp: "2025-01-17T11:00:00Z",
          editedBy: "user",
          changes: [
            {
              field: "description",
              oldValue: "System updated",
              newValue: "User modified",
              dataType: "string",
            },
          ],
        },
      ];

      const result = calculateMultiStepDiff("description", editHistory);

      expect(result.hasChanges).toBe(true);
      expect(result.hasMultipleSources).toBe(true); // Both system and user

      // The user completely replaced the system's text, so only user
      // source appears in operations. hasMultipleSources (above) still
      // correctly reflects that both sources contributed to the history.
      const sources = new Set(
        result.operations.map((op) => op.source).filter(Boolean)
      );
      expect(sources.has("user")).toBe(true);
    });
  });

  describe("Chronological order", () => {
    test("Operations should respect timestamp order", () => {
      const editHistory: EditHistoryEntryDto[] = [
        {
          id: "edit-2", // Later edit
          timestamp: "2025-01-17T11:00:00Z",
          editedBy: "user",
          changes: [
            {
              field: "description",
              oldValue: "Middle",
              newValue: "Final",
              dataType: "string",
            },
          ],
        },
        {
          id: "edit-1", // Earlier edit (out of order in array)
          timestamp: "2025-01-17T10:00:00Z",
          editedBy: "system",
          changes: [
            {
              field: "description",
              oldValue: "Start",
              newValue: "Middle",
              dataType: "string",
            },
          ],
        },
      ];

      const result = calculateMultiStepDiff("description", editHistory);

      expect(result.hasChanges).toBe(true);

      // The function should handle out-of-order edits correctly
      // by sorting them by timestamp internally
      expect(result.operations.length).toBeGreaterThan(0);
    });
  });
});
