import { renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useLinkedItem } from "../useLinkedItem";
import type { LinkedItemMode } from "../types";
import type { WorkItemSelectorValue } from "../../Selectors";

describe("useLinkedItem", () => {
  describe("with no organization ID", () => {
    it("should return null when currentOrgId is null", () => {
      const { result } = renderHook(() =>
        useLinkedItem(null, "workItem", { type: "task", id: "123" })
      );
      expect(result.current).toBeNull();
    });

    it("should return null when currentOrgId is empty string", () => {
      const { result } = renderHook(() =>
        useLinkedItem("", "workItem", { type: "task", id: "123" })
      );
      expect(result.current).toBeNull();
    });
  });

  describe("design-doc mode", () => {
    const orgId = "org-123";

    it("should return the item when it has type and id", () => {
      const item = { type: "design-doc", id: "doc-456" };
      const { result } = renderHook(() =>
        useLinkedItem(orgId, "design-doc" as LinkedItemMode, item)
      );
      expect(result.current).toEqual(item);
    });

    it("should return null when item is null", () => {
      const { result } = renderHook(() =>
        useLinkedItem(orgId, "design-doc" as LinkedItemMode, null)
      );
      expect(result.current).toBeNull();
    });

    it("should return null when item is a string", () => {
      const { result } = renderHook(() =>
        useLinkedItem(orgId, "design-doc" as LinkedItemMode, "doc-456")
      );
      expect(result.current).toBeNull();
    });

    it("should return null when item is missing id", () => {
      const item = { type: "design-doc" } as unknown;
      const { result } = renderHook(() =>
        useLinkedItem(orgId, "design-doc" as LinkedItemMode, item as null)
      );
      expect(result.current).toBeNull();
    });

    it("should return null when item is missing type", () => {
      const item = { id: "doc-456" } as unknown;
      const { result } = renderHook(() =>
        useLinkedItem(orgId, "design-doc" as LinkedItemMode, item as null)
      );
      expect(result.current).toBeNull();
    });
  });

  describe("workItem mode", () => {
    const orgId = "org-123";

    it("should return the item when it has type and id", () => {
      const item: WorkItemSelectorValue = {
        type: "initiative",
        id: "init-789",
      };
      const { result } = renderHook(() =>
        useLinkedItem(orgId, "workItem", item)
      );
      expect(result.current).toEqual(item);
    });

    it("should return null when item is null", () => {
      const { result } = renderHook(() =>
        useLinkedItem(orgId, "workItem", null)
      );
      expect(result.current).toBeNull();
    });

    it("should return null when item is a string", () => {
      const { result } = renderHook(() =>
        useLinkedItem(orgId, "workItem", "init-789")
      );
      expect(result.current).toBeNull();
    });

    it("should return null when item is missing required fields", () => {
      const item = { type: "initiative" } as unknown;
      const { result } = renderHook(() =>
        useLinkedItem(orgId, "workItem", item as null)
      );
      expect(result.current).toBeNull();
    });
  });

  describe("task mode", () => {
    const orgId = "org-123";

    it("should return formatted item when selection is a string", () => {
      const { result } = renderHook(() =>
        useLinkedItem(orgId, "task", "task-123")
      );
      expect(result.current).toEqual({
        type: "task",
        id: "task-123",
      });
    });

    it("should return null when selection is null", () => {
      const { result } = renderHook(() => useLinkedItem(orgId, "task", null));
      expect(result.current).toBeNull();
    });

    it("should return null when selection is empty string", () => {
      const { result } = renderHook(() => useLinkedItem(orgId, "task", ""));
      expect(result.current).toBeNull();
    });

    it("should return null when selection is an object", () => {
      const item: WorkItemSelectorValue = {
        type: "initiative",
        id: "init-456",
      };
      const { result } = renderHook(() => useLinkedItem(orgId, "task", item));
      expect(result.current).toBeNull();
    });
  });

  describe("initiative mode", () => {
    const orgId = "org-123";

    it("should return formatted item when selection is a string", () => {
      const { result } = renderHook(() =>
        useLinkedItem(orgId, "initiative", "init-456")
      );
      expect(result.current).toEqual({
        type: "initiative",
        id: "init-456",
      });
    });

    it("should return null when selection is null", () => {
      const { result } = renderHook(() =>
        useLinkedItem(orgId, "initiative", null)
      );
      expect(result.current).toBeNull();
    });

    it("should return null when selection is empty string", () => {
      const { result } = renderHook(() =>
        useLinkedItem(orgId, "initiative", "")
      );
      expect(result.current).toBeNull();
    });

    it("should return null when selection is an object", () => {
      const item: WorkItemSelectorValue = { type: "task", id: "task-789" };
      const { result } = renderHook(() =>
        useLinkedItem(orgId, "initiative", item)
      );
      expect(result.current).toBeNull();
    });
  });

  describe("none mode", () => {
    const orgId = "org-123";

    it("should return null regardless of selection", () => {
      const { result: result1 } = renderHook(() =>
        useLinkedItem(orgId, "none", "task-123")
      );
      expect(result1.current).toBeNull();

      const { result: result2 } = renderHook(() =>
        useLinkedItem(orgId, "none", { type: "task", id: "task-123" })
      );
      expect(result2.current).toBeNull();

      const { result: result3 } = renderHook(() =>
        useLinkedItem(orgId, "none", null)
      );
      expect(result3.current).toBeNull();
    });
  });

  describe("memoization", () => {
    const orgId = "org-123";

    it("should return same reference when dependencies don't change", () => {
      const item: WorkItemSelectorValue = { type: "task", id: "task-123" };
      const { result, rerender } = renderHook(
        ({
          orgId: id,
          mode,
          selection,
        }: {
          orgId: string;
          mode: LinkedItemMode;
          selection: WorkItemSelectorValue;
        }) => useLinkedItem(id, mode, selection),
        {
          initialProps: {
            orgId,
            mode: "workItem" as LinkedItemMode,
            selection: item,
          },
        }
      );

      const firstResult = result.current;

      rerender({ orgId, mode: "workItem" as LinkedItemMode, selection: item });

      expect(result.current).toBe(firstResult);
    });

    it("should return new reference when orgId changes", () => {
      const item: WorkItemSelectorValue = { type: "task", id: "task-123" };
      const { result, rerender } = renderHook(
        ({
          orgId: id,
          mode,
          selection,
        }: {
          orgId: string;
          mode: LinkedItemMode;
          selection: WorkItemSelectorValue;
        }) => useLinkedItem(id, mode, selection),
        {
          initialProps: {
            orgId,
            mode: "workItem" as LinkedItemMode,
            selection: item,
          },
        }
      );

      const firstResult = result.current;
      expect(firstResult).toEqual(item);

      rerender({
        orgId: "org-456",
        mode: "workItem" as LinkedItemMode,
        selection: item,
      });

      // Same selection should return same object due to memoization
      expect(result.current).toBe(firstResult);

      rerender({
        orgId: "org-456",
        mode: "workItem" as LinkedItemMode,
        selection: { type: "task", id: "task-123" },
      });

      // Different selection object should return new reference (even if same content)
      expect(result.current).not.toBe(firstResult);
    });

    it("should return new reference when mode changes", () => {
      const taskId = "task-123";
      const { result, rerender } = renderHook(
        ({
          orgId: id,
          mode,
          selection,
        }: {
          orgId: string;
          mode: LinkedItemMode;
          selection: string;
        }) => useLinkedItem(id, mode, selection),
        {
          initialProps: {
            orgId,
            mode: "task" as LinkedItemMode,
            selection: taskId,
          },
        }
      );

      const firstResult = result.current;

      rerender({
        orgId,
        mode: "initiative" as LinkedItemMode,
        selection: taskId,
      });

      expect(result.current).not.toBe(firstResult);
    });

    it("should return new reference when selection changes", () => {
      const { result, rerender } = renderHook(
        ({
          orgId: id,
          mode,
          selection,
        }: {
          orgId: string;
          mode: LinkedItemMode;
          selection: string;
        }) => useLinkedItem(id, mode, selection),
        {
          initialProps: {
            orgId,
            mode: "task" as LinkedItemMode,
            selection: "task-123",
          },
        }
      );

      const firstResult = result.current;

      rerender({
        orgId,
        mode: "task" as LinkedItemMode,
        selection: "task-456",
      });

      expect(result.current).not.toBe(firstResult);
    });
  });

  describe("edge cases", () => {
    const orgId = "org-123";

    it("should handle undefined selection gracefully", () => {
      const { result } = renderHook(() =>
        useLinkedItem(orgId, "workItem", undefined as unknown as null)
      );
      expect(result.current).toBeNull();
    });

    it("should handle selection with extra properties", () => {
      const item = {
        type: "task",
        id: "task-123",
        extraProperty: "should be ignored",
      } as unknown as WorkItemSelectorValue;
      const { result } = renderHook(() =>
        useLinkedItem(orgId, "workItem", item)
      );
      expect(result.current).toEqual({
        type: "task",
        id: "task-123",
        extraProperty: "should be ignored",
      });
    });

    it("should handle whitespace-only task ID", () => {
      const { result } = renderHook(() => useLinkedItem(orgId, "task", "   "));
      // Whitespace-only strings are truthy, so they'll be processed
      expect(result.current).toEqual({
        type: "task",
        id: "   ",
      });
    });
  });
});
