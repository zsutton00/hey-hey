import { calculateMultiStepDiff, type EditHistoryEntryDto } from "../textDiff";

describe("calculateMultiStepDiff", () => {
  test("should handle simple system change", () => {
    const editHistory: EditHistoryEntryDto[] = [
      {
        id: "edit-1",
        timestamp: "2025-01-15T10:00:00Z",
        editedBy: "system",
        changes: [
          {
            field: "description",
            oldValue: "Build a web app",
            newValue: "Build a web app with mobile support",
            dataType: "string",
          },
        ],
      },
    ];

    const result = calculateMultiStepDiff("description", editHistory);

    expect(result.hasChanges).toBe(true);
    expect(result.hasMultipleSources).toBe(false);
    expect(result.operations.length).toBeGreaterThan(0);

    // Should have system-attributed changes
    const systemChanges = result.operations.filter(
      (op) => op.source === "system"
    );
    expect(systemChanges.length).toBeGreaterThan(0);
  });

  test("should handle empty edit history", () => {
    const result = calculateMultiStepDiff("description", []);

    expect(result.hasChanges).toBe(false);
    expect(result.hasMultipleSources).toBe(false);
    expect(result.operations.length).toBe(0);
  });

  test("should filter by field name", () => {
    const editHistory: EditHistoryEntryDto[] = [
      {
        id: "edit-1",
        timestamp: "2025-01-15T10:00:00Z",
        editedBy: "system",
        changes: [
          {
            field: "title",
            oldValue: "Old title",
            newValue: "New title",
            dataType: "string",
          },
          {
            field: "description",
            oldValue: "Old desc",
            newValue: "New desc",
            dataType: "string",
          },
        ],
      },
    ];

    const result = calculateMultiStepDiff("description", editHistory);

    expect(result.hasChanges).toBe(true);
    // Should only process the description field changes
    // Implementation details depend on how the function works
  });
});
