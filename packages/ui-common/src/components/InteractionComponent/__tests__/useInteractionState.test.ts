import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInteractionState } from "../useInteractionState";

describe("useInteractionState", () => {
  describe("initial state", () => {
    it("starts in idle state with no menu position", () => {
      const { result } = renderHook(() => useInteractionState());

      expect(result.current.state).toBe("idle");
      expect(result.current.menuPosition).toBeNull();
    });
  });

  describe("mouse enter / leave transitions", () => {
    it("transitions from idle to hovering on mouse enter", () => {
      const { result } = renderHook(() => useInteractionState());

      act(() => {
        result.current.handleMouseEnter();
      });

      expect(result.current.state).toBe("hovering");
    });

    it("transitions from hovering to idle on mouse leave", () => {
      const { result } = renderHook(() => useInteractionState());

      act(() => {
        result.current.handleMouseEnter();
      });
      act(() => {
        result.current.handleMouseLeave();
      });

      expect(result.current.state).toBe("idle");
    });

    it("stays in menuOpen on mouse enter while menu is open", () => {
      const { result } = renderHook(() => useInteractionState());

      act(() => {
        result.current.handleMouseEnter();
      });
      act(() => {
        result.current.openMenu({ x: 100, y: 200 });
      });
      act(() => {
        result.current.handleMouseLeave();
        result.current.handleMouseEnter();
      });

      expect(result.current.state).toBe("menuOpen");
    });

    it("stays in menuOpen on mouse leave while menu is open", () => {
      const { result } = renderHook(() => useInteractionState());

      act(() => {
        result.current.handleMouseEnter();
      });
      act(() => {
        result.current.openMenu({ x: 100, y: 200 });
      });
      act(() => {
        result.current.handleMouseLeave();
      });

      expect(result.current.state).toBe("menuOpen");
    });
  });

  describe("openMenu", () => {
    it("transitions to menuOpen and stores position", () => {
      const { result } = renderHook(() => useInteractionState());

      act(() => {
        result.current.handleMouseEnter();
      });
      act(() => {
        result.current.openMenu({ x: 150, y: 300 });
      });

      expect(result.current.state).toBe("menuOpen");
      expect(result.current.menuPosition).toEqual({ x: 150, y: 300 });
    });

    it("can open menu directly from idle", () => {
      const { result } = renderHook(() => useInteractionState());

      act(() => {
        result.current.openMenu({ x: 10, y: 20 });
      });

      expect(result.current.state).toBe("menuOpen");
      expect(result.current.menuPosition).toEqual({ x: 10, y: 20 });
    });
  });

  describe("closeMenu", () => {
    it("returns to hovering when mouse is still over the component", () => {
      const { result } = renderHook(() => useInteractionState());

      // Enter → open menu (mouseOver=true)
      act(() => {
        result.current.handleMouseEnter();
      });
      act(() => {
        result.current.openMenu({ x: 100, y: 200 });
      });
      act(() => {
        result.current.closeMenu();
      });

      expect(result.current.state).toBe("hovering");
    });

    it("returns to idle when mouse has left the component", () => {
      const { result } = renderHook(() => useInteractionState());

      // Enter → open menu → leave (mouseOver=false) → close
      act(() => {
        result.current.handleMouseEnter();
      });
      act(() => {
        result.current.openMenu({ x: 100, y: 200 });
      });
      act(() => {
        result.current.handleMouseLeave();
      });
      act(() => {
        result.current.closeMenu();
      });

      expect(result.current.state).toBe("idle");
    });

    it("clears menu position on close", () => {
      const { result } = renderHook(() => useInteractionState());

      act(() => {
        result.current.openMenu({ x: 100, y: 200 });
      });
      expect(result.current.menuPosition).toEqual({ x: 100, y: 200 });

      act(() => {
        result.current.closeMenu();
      });

      expect(result.current.menuPosition).toBeNull();
    });
  });

  describe("callback stability", () => {
    it("handlers are stable references across renders", () => {
      const { result, rerender } = renderHook(() => useInteractionState());

      const { handleMouseEnter, handleMouseLeave, openMenu, closeMenu } =
        result.current;

      rerender();

      expect(result.current.handleMouseEnter).toBe(handleMouseEnter);
      expect(result.current.handleMouseLeave).toBe(handleMouseLeave);
      expect(result.current.openMenu).toBe(openMenu);
      expect(result.current.closeMenu).toBe(closeMenu);
    });
  });
});
