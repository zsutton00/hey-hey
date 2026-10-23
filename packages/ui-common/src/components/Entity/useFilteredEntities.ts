import { useMemo } from "react";

/**
 * Configuration options for filtering entities
 */
export interface FilterOptions<T> {
  /**
   * Fields to search when applying text search
   */
  searchFields?: (keyof T)[];

  /**
   * Search term to filter by
   */
  searchTerm?: string;

  /**
   * Exact match filters - filters where field must exactly equal value
   * e.g., { status: 'ACTIVE', assigneeId: 'user-123' }
   */
  exactMatchFilters?: Partial<Record<keyof T, unknown>>;

  /**
   * Date range filters for date fields
   */
  dateRangeFilters?: {
    field: keyof T;
    start?: Date;
    end?: Date;
  }[];

  /**
   * Custom filter functions for complex filtering logic
   */
  customFilters?: ((item: T) => boolean)[];

  /**
   * Sort key to apply
   */
  sortBy?: string;

  /**
   * Sort configuration mapping sort keys to comparison functions
   */
  sortConfig?: {
    [key: string]: (a: T, b: T) => number;
  };
}

/**
 * Generic hook for filtering and sorting entities
 *
 * @template T - The entity type
 * @param items - Array of items to filter and sort
 * @param options - Filter and sort configuration
 * @returns Filtered and sorted array of items
 *
 * @example
 * ```typescript
 * const filteredTasks = useFilteredEntities(tasks, {
 *   searchFields: ['name', 'description'],
 *   searchTerm: 'bug fix',
 *   exactMatchFilters: {
 *     status: statusFilter || undefined,
 *     assigneeId: assigneeFilter || undefined
 *   },
 *   sortBy: 'created-desc',
 *   sortConfig: TASK_SORT_CONFIG
 * });
 * ```
 */
export function useFilteredEntities<T>(
  items: T[],
  options: FilterOptions<T>
): T[] {
  return useMemo(() => {
    let filtered = [...items];

    // Apply text search across specified fields
    if (options.searchTerm && options.searchFields) {
      const searchLower = options.searchTerm.toLowerCase();
      filtered = filtered.filter((item) =>
        options.searchFields!.some((field) => {
          const value = item[field];
          if (value === null || value === undefined) {
            return false;
          }
          // Handle arrays (like tags)
          if (Array.isArray(value)) {
            return value.some((v) =>
              String(v).toLowerCase().includes(searchLower)
            );
          }
          // Handle string/number values
          return String(value).toLowerCase().includes(searchLower);
        })
      );
    }

    // Apply exact match filters
    if (options.exactMatchFilters) {
      filtered = filtered.filter((item) =>
        Object.entries(options.exactMatchFilters!).every(([key, value]) => {
          // Skip undefined filters (allows conditional filtering)
          if (value === undefined) {
            return true;
          }
          return item[key as keyof T] === value;
        })
      );
    }

    // Apply date range filters
    if (options.dateRangeFilters && options.dateRangeFilters.length > 0) {
      filtered = filtered.filter((item) =>
        options.dateRangeFilters!.every(({ field, start, end }) => {
          const fieldValue = item[field];
          if (
            fieldValue === null ||
            fieldValue === undefined ||
            typeof fieldValue !== "string"
          ) {
            return false;
          }
          const dateValue = new Date(fieldValue);
          if (start && dateValue < start) {
            return false;
          }
          if (end && dateValue > end) {
            return false;
          }
          return true;
        })
      );
    }

    // Apply custom filter functions
    if (options.customFilters && options.customFilters.length > 0) {
      filtered = filtered.filter((item) =>
        options.customFilters!.every((fn) => fn(item))
      );
    }

    // Apply sorting
    if (options.sortBy && options.sortConfig?.[options.sortBy]) {
      filtered.sort(options.sortConfig[options.sortBy]);
    }

    return filtered;
  }, [items, options]);
}
