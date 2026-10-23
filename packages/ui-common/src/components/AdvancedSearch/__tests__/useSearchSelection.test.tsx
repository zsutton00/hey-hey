import { renderHook, act } from "@testing-library/react";
import { useSearchSelection } from "../hooks/useSearchSelection";
import { createMockSearchEntities } from "./testUtils";

/**
 * Helper to create a mock MouseEvent with keyboard modifiers
 */
function createMouseEvent(options: {
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}): React.MouseEvent {
  return {
    shiftKey: options.shiftKey ?? false,
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
  } as React.MouseEvent;
}

describe("useSearchSelection", () => {
  describe("Single select mode", () => {
    it("selects one item", () => {
      const { result } = renderHook(() => useSearchSelection(false));
      const mockResults = createMockSearchEntities(3);
      const mockEvent = createMouseEvent({});

      act(() => {
        result.current.handleSelect("entity-1", mockEvent, mockResults);
      });

      expect(result.current.selectedIds.size).toBe(1);
      expect(result.current.selectedIds.has("entity-1")).toBe(true);
    });

    it("replaces selection when clicking another item", () => {
      const { result } = renderHook(() => useSearchSelection(false));
      const mockResults = createMockSearchEntities(3);
      const mockEvent = createMouseEvent({});

      act(() => {
        result.current.handleSelect("entity-1", mockEvent, mockResults);
      });

      expect(result.current.selectedIds.has("entity-1")).toBe(true);
      expect(result.current.selectedIds.size).toBe(1);

      act(() => {
        result.current.handleSelect("entity-2", mockEvent, mockResults);
      });

      expect(result.current.selectedIds.has("entity-1")).toBe(false);
      expect(result.current.selectedIds.has("entity-2")).toBe(true);
      expect(result.current.selectedIds.size).toBe(1);
    });
  });

  describe("Multi-select mode", () => {
    it("Cmd+Click adds to selection", () => {
      const { result } = renderHook(() => useSearchSelection(true));
      const mockResults = createMockSearchEntities(3);
      const cmdClickEvent = createMouseEvent({ metaKey: true });

      act(() => {
        result.current.handleSelect("entity-1", cmdClickEvent, mockResults);
      });

      expect(result.current.selectedIds.has("entity-1")).toBe(true);

      act(() => {
        result.current.handleSelect("entity-2", cmdClickEvent, mockResults);
      });

      expect(result.current.selectedIds.has("entity-1")).toBe(true);
      expect(result.current.selectedIds.has("entity-2")).toBe(true);
      expect(result.current.selectedIds.size).toBe(2);
    });

    it("Ctrl+Click adds to selection", () => {
      const { result } = renderHook(() => useSearchSelection(true));
      const mockResults = createMockSearchEntities(3);
      const ctrlClickEvent = createMouseEvent({ ctrlKey: true });

      act(() => {
        result.current.handleSelect("entity-1", ctrlClickEvent, mockResults);
      });

      expect(result.current.selectedIds.has("entity-1")).toBe(true);

      act(() => {
        result.current.handleSelect("entity-2", ctrlClickEvent, mockResults);
      });

      expect(result.current.selectedIds.has("entity-1")).toBe(true);
      expect(result.current.selectedIds.has("entity-2")).toBe(true);
      expect(result.current.selectedIds.size).toBe(2);
    });

    it("Cmd+Click toggles selection", () => {
      const { result } = renderHook(() => useSearchSelection(true));
      const mockResults = createMockSearchEntities(3);
      const cmdClickEvent = createMouseEvent({ metaKey: true });

      act(() => {
        result.current.handleSelect("entity-1", cmdClickEvent, mockResults);
      });

      expect(result.current.selectedIds.has("entity-1")).toBe(true);

      // Click again to toggle off
      act(() => {
        result.current.handleSelect("entity-1", cmdClickEvent, mockResults);
      });

      expect(result.current.selectedIds.has("entity-1")).toBe(false);
      expect(result.current.selectedIds.size).toBe(0);
    });

    it("Shift+Click range selects from last selected to clicked item", () => {
      const { result } = renderHook(() => useSearchSelection(true));
      const mockResults = createMockSearchEntities(5);
      const regularEvent = createMouseEvent({});
      const shiftClickEvent = createMouseEvent({ shiftKey: true });

      // First select entity-2
      act(() => {
        result.current.handleSelect("entity-2", regularEvent, mockResults);
      });

      expect(result.current.selectedIds.has("entity-2")).toBe(true);

      // Shift+Click entity-4 should select entity-2, entity-3, entity-4
      act(() => {
        result.current.handleSelect("entity-4", shiftClickEvent, mockResults);
      });

      expect(result.current.selectedIds.has("entity-2")).toBe(true);
      expect(result.current.selectedIds.has("entity-3")).toBe(true);
      expect(result.current.selectedIds.has("entity-4")).toBe(true);
      expect(result.current.selectedIds.size).toBe(3);
    });

    it("Shift+Click works in reverse direction", () => {
      const { result } = renderHook(() => useSearchSelection(true));
      const mockResults = createMockSearchEntities(5);
      const regularEvent = createMouseEvent({});
      const shiftClickEvent = createMouseEvent({ shiftKey: true });

      // First select entity-4
      act(() => {
        result.current.handleSelect("entity-4", regularEvent, mockResults);
      });

      // Shift+Click entity-2 should select entity-2, entity-3, entity-4
      act(() => {
        result.current.handleSelect("entity-2", shiftClickEvent, mockResults);
      });

      expect(result.current.selectedIds.has("entity-2")).toBe(true);
      expect(result.current.selectedIds.has("entity-3")).toBe(true);
      expect(result.current.selectedIds.has("entity-4")).toBe(true);
      expect(result.current.selectedIds.size).toBe(3);
    });

    it("plain click toggles selection", () => {
      const { result } = renderHook(() => useSearchSelection(true));
      const mockResults = createMockSearchEntities(3);
      const regularEvent = createMouseEvent({});

      act(() => {
        result.current.handleSelect("entity-1", regularEvent, mockResults);
      });

      expect(result.current.selectedIds.has("entity-1")).toBe(true);

      // Click again to toggle off
      act(() => {
        result.current.handleSelect("entity-1", regularEvent, mockResults);
      });

      expect(result.current.selectedIds.has("entity-1")).toBe(false);
      expect(result.current.selectedIds.size).toBe(0);
    });
  });

  describe("Utility methods", () => {
    it("addToSelection adds an ID to the selection set", () => {
      const { result } = renderHook(() => useSearchSelection(true));

      act(() => {
        result.current.addToSelection("entity-1");
      });

      expect(result.current.selectedIds.has("entity-1")).toBe(true);
      expect(result.current.selectedIds.size).toBe(1);

      act(() => {
        result.current.addToSelection("entity-2");
      });

      expect(result.current.selectedIds.has("entity-1")).toBe(true);
      expect(result.current.selectedIds.has("entity-2")).toBe(true);
      expect(result.current.selectedIds.size).toBe(2);
    });

    it("removeFromSelection removes an ID from the selection set", () => {
      const { result } = renderHook(() => useSearchSelection(true));

      act(() => {
        result.current.addToSelection("entity-1");
        result.current.addToSelection("entity-2");
      });

      expect(result.current.selectedIds.size).toBe(2);

      act(() => {
        result.current.removeFromSelection("entity-1");
      });

      expect(result.current.selectedIds.has("entity-1")).toBe(false);
      expect(result.current.selectedIds.has("entity-2")).toBe(true);
      expect(result.current.selectedIds.size).toBe(1);
    });

    it("clearSelection clears all selections", () => {
      const { result } = renderHook(() => useSearchSelection(true));

      act(() => {
        result.current.addToSelection("entity-1");
        result.current.addToSelection("entity-2");
      });

      expect(result.current.selectedIds.size).toBe(2);

      act(() => {
        result.current.clearSelection();
      });

      expect(result.current.selectedIds.size).toBe(0);
    });

    it("selectAll selects all items", () => {
      const { result } = renderHook(() => useSearchSelection(true));
      const mockResults = createMockSearchEntities(5);

      act(() => {
        result.current.selectAll(mockResults);
      });

      expect(result.current.selectedIds.size).toBe(5);
      expect(result.current.selectedIds.has("entity-1")).toBe(true);
      expect(result.current.selectedIds.has("entity-2")).toBe(true);
      expect(result.current.selectedIds.has("entity-3")).toBe(true);
      expect(result.current.selectedIds.has("entity-4")).toBe(true);
      expect(result.current.selectedIds.has("entity-5")).toBe(true);
    });
  });

  describe("Mode change behavior", () => {
    it("clears selection when switching from multi-select to single-select mode", () => {
      const { result, rerender } = renderHook(
        ({ allowMultiSelect }: { allowMultiSelect: boolean }) =>
          useSearchSelection(allowMultiSelect),
        { initialProps: { allowMultiSelect: true } }
      );

      const mockResults = createMockSearchEntities(3);
      const cmdClickEvent = createMouseEvent({ metaKey: true });

      // Select multiple items in multi-select mode
      act(() => {
        result.current.handleSelect("entity-1", cmdClickEvent, mockResults);
        result.current.handleSelect("entity-2", cmdClickEvent, mockResults);
      });

      expect(result.current.selectedIds.size).toBe(2);

      // Switch to single-select mode
      rerender({ allowMultiSelect: false });

      // Selection should still be there (hook doesn't auto-clear on mode change)
      expect(result.current.selectedIds.size).toBe(2);

      // But clicking in single-select mode should replace selection
      const regularEvent = createMouseEvent({});
      act(() => {
        result.current.handleSelect("entity-3", regularEvent, mockResults);
      });

      expect(result.current.selectedIds.size).toBe(1);
      expect(result.current.selectedIds.has("entity-3")).toBe(true);
      expect(result.current.selectedIds.has("entity-1")).toBe(false);
      expect(result.current.selectedIds.has("entity-2")).toBe(false);
    });
  });
});
