import { renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useFilteredEntities } from "../useFilteredEntities";
import { WorkStatus, Priority } from "../../../api";

interface TestEntity {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  status: WorkStatus;
  priority: Priority;
  createdAt: string;
  assigneeId?: string;
}

describe("useFilteredEntities", () => {
  const testEntities: TestEntity[] = [
    {
      id: "1",
      name: "Fix authentication bug",
      description: "Users cannot log in",
      tags: ["security", "urgent"],
      status: WorkStatus.Active,
      priority: Priority.High,
      createdAt: "2024-01-01T00:00:00Z",
      assigneeId: "user-1",
    },
    {
      id: "2",
      name: "Add dark mode",
      description: "Implement dark theme",
      tags: ["ui", "enhancement"],
      status: WorkStatus.Backlog,
      priority: Priority.Medium,
      createdAt: "2024-01-02T00:00:00Z",
    },
    {
      id: "3",
      name: "Update documentation",
      description: "Add API docs",
      tags: ["docs"],
      status: WorkStatus.Completed,
      priority: Priority.Low,
      createdAt: "2024-01-03T00:00:00Z",
      assigneeId: "user-2",
    },
  ];

  describe("search filtering", () => {
    it("should filter by name", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          searchFields: ["name"],
          searchTerm: "dark mode",
        })
      );

      expect(result.current).toHaveLength(1);
      expect(result.current[0].id).toBe("2");
    });

    it("should filter by description", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          searchFields: ["description"],
          searchTerm: "log in",
        })
      );

      expect(result.current).toHaveLength(1);
      expect(result.current[0].id).toBe("1");
    });

    it("should filter by tags array", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          searchFields: ["tags"],
          searchTerm: "urgent",
        })
      );

      expect(result.current).toHaveLength(1);
      expect(result.current[0].id).toBe("1");
    });

    it("should search across multiple fields", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          searchFields: ["name", "description", "tags"],
          searchTerm: "ui",
        })
      );

      expect(result.current).toHaveLength(1);
      expect(result.current[0].id).toBe("2");
    });

    it("should be case-insensitive", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          searchFields: ["name"],
          searchTerm: "DARK MODE",
        })
      );

      expect(result.current).toHaveLength(1);
      expect(result.current[0].id).toBe("2");
    });

    it("should return all items when search term is empty", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          searchFields: ["name"],
          searchTerm: "",
        })
      );

      expect(result.current).toHaveLength(3);
    });

    it("should return empty array when no matches", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          searchFields: ["name"],
          searchTerm: "nonexistent",
        })
      );

      expect(result.current).toHaveLength(0);
    });
  });

  describe("exact match filtering", () => {
    it("should filter by status", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          exactMatchFilters: {
            status: WorkStatus.Active,
          },
        })
      );

      expect(result.current).toHaveLength(1);
      expect(result.current[0].id).toBe("1");
    });

    it("should filter by priority", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          exactMatchFilters: {
            priority: Priority.High,
          },
        })
      );

      expect(result.current).toHaveLength(1);
      expect(result.current[0].id).toBe("1");
    });

    it("should filter by assigneeId", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          exactMatchFilters: {
            assigneeId: "user-2",
          },
        })
      );

      expect(result.current).toHaveLength(1);
      expect(result.current[0].id).toBe("3");
    });

    it("should combine multiple exact match filters", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          exactMatchFilters: {
            status: WorkStatus.Active,
            priority: Priority.High,
          },
        })
      );

      expect(result.current).toHaveLength(1);
      expect(result.current[0].id).toBe("1");
    });

    it("should skip undefined filters", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          exactMatchFilters: {
            status: undefined,
            priority: Priority.High,
          },
        })
      );

      expect(result.current).toHaveLength(1);
      expect(result.current[0].id).toBe("1");
    });

    it("should return empty when no items match all filters", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          exactMatchFilters: {
            status: WorkStatus.Active,
            priority: Priority.Low,
          },
        })
      );

      expect(result.current).toHaveLength(0);
    });
  });

  describe("date range filtering", () => {
    it("should filter by date range with start date", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          dateRangeFilters: [
            {
              field: "createdAt",
              start: new Date("2024-01-02T00:00:00Z"),
            },
          ],
        })
      );

      expect(result.current).toHaveLength(2);
      expect(result.current.map((e) => e.id)).toEqual(["2", "3"]);
    });

    it("should filter by date range with end date", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          dateRangeFilters: [
            {
              field: "createdAt",
              end: new Date("2024-01-02T00:00:00Z"),
            },
          ],
        })
      );

      expect(result.current).toHaveLength(2);
      expect(result.current.map((e) => e.id)).toEqual(["1", "2"]);
    });

    it("should filter by date range with both start and end", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          dateRangeFilters: [
            {
              field: "createdAt",
              start: new Date("2024-01-02T00:00:00Z"),
              end: new Date("2024-01-02T23:59:59Z"),
            },
          ],
        })
      );

      expect(result.current).toHaveLength(1);
      expect(result.current[0].id).toBe("2");
    });
  });

  describe("custom filters", () => {
    it("should apply custom filter function", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          customFilters: [(item) => item.name.includes("mode")],
        })
      );

      expect(result.current).toHaveLength(1);
      expect(result.current[0].id).toBe("2");
    });

    it("should apply multiple custom filters with AND logic", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          customFilters: [
            (item) => item.priority !== Priority.Low,
            (item) => item.tags !== undefined && item.tags.length > 1,
          ],
        })
      );

      expect(result.current).toHaveLength(2);
      expect(result.current.map((e) => e.id)).toEqual(["1", "2"]);
    });
  });

  describe("sorting", () => {
    it("should sort by custom sort function", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          sortBy: "name-asc",
          sortConfig: {
            "name-asc": (a, b) => a.name.localeCompare(b.name),
          },
        })
      );

      expect(result.current.map((e) => e.name)).toEqual([
        "Add dark mode",
        "Fix authentication bug",
        "Update documentation",
      ]);
    });

    it("should sort by date descending", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          sortBy: "created-desc",
          sortConfig: {
            "created-desc": (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          },
        })
      );

      expect(result.current.map((e) => e.id)).toEqual(["3", "2", "1"]);
    });

    it("should not sort if sortBy is not provided", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          sortConfig: {
            "name-asc": (a, b) => a.name.localeCompare(b.name),
          },
        })
      );

      // Should maintain original order
      expect(result.current.map((e) => e.id)).toEqual(["1", "2", "3"]);
    });

    it("should not sort if sortConfig doesn't have the sortBy key", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          sortBy: "nonexistent",
          sortConfig: {
            "name-asc": (a, b) => a.name.localeCompare(b.name),
          },
        })
      );

      // Should maintain original order
      expect(result.current.map((e) => e.id)).toEqual(["1", "2", "3"]);
    });
  });

  describe("combined filtering and sorting", () => {
    it("should combine search, exact match, and sorting", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          searchFields: ["name", "tags"],
          searchTerm: "u",
          exactMatchFilters: {
            status: WorkStatus.Active,
          },
          sortBy: "name-asc",
          sortConfig: {
            "name-asc": (a, b) => a.name.localeCompare(b.name),
          },
        })
      );

      expect(result.current).toHaveLength(1);
      expect(result.current[0].id).toBe("1");
    });

    it("should apply all filter types together", () => {
      const { result } = renderHook(() =>
        useFilteredEntities(testEntities, {
          searchFields: ["name"],
          searchTerm: "mode",
          exactMatchFilters: {
            priority: Priority.Medium,
          },
          customFilters: [(item) => (item.tags?.length ?? 0) >= 2],
        })
      );

      expect(result.current).toHaveLength(1);
      expect(result.current[0].id).toBe("2");
    });
  });

  describe("edge cases", () => {
    it("should handle empty items array", () => {
      const { result } = renderHook(() =>
        useFilteredEntities([], {
          searchFields: ["name"],
          searchTerm: "test",
        })
      );

      expect(result.current).toHaveLength(0);
    });

    it("should handle null/undefined field values", () => {
      const entitiesWithNulls: TestEntity[] = [
        {
          id: "1",
          name: "Test",
          description: undefined,
          tags: undefined,
          status: WorkStatus.Active,
          priority: Priority.High,
          createdAt: "2024-01-01T00:00:00Z",
        },
      ];

      const { result } = renderHook(() =>
        useFilteredEntities(entitiesWithNulls, {
          searchFields: ["description", "tags"],
          searchTerm: "test",
        })
      );

      expect(result.current).toHaveLength(0);
    });

    it("should not mutate original array", () => {
      const original = [...testEntities];

      renderHook(() =>
        useFilteredEntities(testEntities, {
          sortBy: "name-asc",
          sortConfig: {
            "name-asc": (a, b) => a.name.localeCompare(b.name),
          },
        })
      );

      expect(testEntities).toEqual(original);
    });
  });
});
