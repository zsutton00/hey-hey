import { describe, it, expect } from "vitest";
import { calculateVisualState } from "../useColumnScroll";

// Constants from the hook
const PANELS_PER_COLUMN = 3;
const TOTAL_COLUMNS = 3;

describe("calculateVisualState", () => {
  const PANEL_HEIGHT = 400; // Standard panel height for testing

  describe("edge cases", () => {
    it("should handle zero panel height", () => {
      const result = calculateVisualState(1000, 0);

      expect(result).toEqual({
        activeColumn: "left",
        panelPositions: { left: 0, center: 0, right: 0 },
        scrollWithinActiveColumn: 0,
        activeRow: 0,
      });
    });

    it("should handle zero scroll position", () => {
      const result = calculateVisualState(0, PANEL_HEIGHT);

      expect(result).toEqual({
        activeColumn: "left",
        panelPositions: { left: 0, center: 0, right: 0 },
        scrollWithinActiveColumn: 0,
        activeRow: 0,
      });
    });
  });

  describe("column sequence progression", () => {
    it("should start in left column", () => {
      const result = calculateVisualState(100, PANEL_HEIGHT);

      expect(result.activeColumn).toBe("left");
      expect(result.panelPositions.left).toBe(0);
      expect(result.scrollWithinActiveColumn).toBe(100);
    });

    it("should progress to center column after first panel", () => {
      const result = calculateVisualState(PANEL_HEIGHT + 50, PANEL_HEIGHT);

      expect(result.activeColumn).toBe("center");
      expect(result.panelPositions.left).toBe(1); // Left has moved to panel 1
      expect(result.panelPositions.center).toBe(0); // Center is at panel 0
      expect(result.scrollWithinActiveColumn).toBe(50);
    });

    it("should progress to right column after second panel", () => {
      const result = calculateVisualState(PANEL_HEIGHT * 2 + 75, PANEL_HEIGHT);

      expect(result.activeColumn).toBe("right");
      expect(result.panelPositions.left).toBe(1);
      expect(result.panelPositions.center).toBe(1);
      expect(result.panelPositions.right).toBe(0);
      expect(result.scrollWithinActiveColumn).toBe(75);
    });

    it("should cycle back to left column for second set", () => {
      const result = calculateVisualState(PANEL_HEIGHT * 3 + 25, PANEL_HEIGHT);

      expect(result.activeColumn).toBe("left");
      expect(result.panelPositions.left).toBe(1); // Left advances to panel 1
      expect(result.panelPositions.center).toBe(1);
      expect(result.panelPositions.right).toBe(1);
      expect(result.scrollWithinActiveColumn).toBe(25);
    });
  });

  describe("panel position calculation", () => {
    it("should calculate correct panel positions for complete first cycle", () => {
      // After scrolling through all 3 columns once (panels 0, 1, 2)
      const result = calculateVisualState(PANEL_HEIGHT * 3, PANEL_HEIGHT);

      expect(result.panelPositions).toEqual({
        left: 1, // Has completed panel 0, now showing panel 1
        center: 1, // Has completed panel 0, now showing panel 1
        right: 1, // Has completed panel 0, now showing panel 1
      });
    });

    it("should calculate correct panel positions for partial second cycle", () => {
      // Partway through second cycle (totalPanelsScrolled = 4)
      const result = calculateVisualState(PANEL_HEIGHT * 4 + 100, PANEL_HEIGHT);

      expect(result.activeColumn).toBe("center"); // 4 % 3 = 1 (center)
      expect(result.panelPositions).toEqual({
        left: 2, // Left has completed 2 panels (0,1), showing panel 2
        center: 1, // Center has completed 1 panel, showing panel 1
        right: 1, // Right has completed 1 panel, showing panel 1
      });
    });

    it("should cap panel positions at maximum (2)", () => {
      // Near end of scroll space
      const result = calculateVisualState(PANEL_HEIGHT * 5 + 200, PANEL_HEIGHT);

      expect(result.panelPositions).toEqual({
        left: 2, // Capped at max panel (2)
        center: 2, // Capped at max panel (2)
        right: 1, // Right hasn't reached max yet
      });
    });
  });

  describe("scroll boundary capping", () => {
    it("should cap totalPanelsScrolled at maximum scrollable panels", () => {
      // Test with scroll position that would exceed maximum
      const maxScrollablePanels = (PANELS_PER_COLUMN - 1) * TOTAL_COLUMNS; // 2 * 3 = 6
      const excessiveScrollPosition = PANEL_HEIGHT * 10; // Way beyond maximum

      const result = calculateVisualState(
        excessiveScrollPosition,
        PANEL_HEIGHT
      );

      // Should be capped to the last valid state
      expect(result.activeColumn).toBe("right"); // (maxScrollablePanels - 1) % 3 = 5 % 3 = 2 (right)
      expect(result.panelPositions).toEqual({
        left: 2, // Left has completed 2 panels, at panel 2
        center: 2, // Center has completed 2 panels, at panel 2
        right: 1, // Right has completed 1 panel, at panel 1
      });
    });

    it("should handle exact maximum scroll position", () => {
      const maxScrollablePanels = (PANELS_PER_COLUMN - 1) * TOTAL_COLUMNS; // 6
      const exactMaxScrollPosition = PANEL_HEIGHT * (maxScrollablePanels - 1); // 5 * PANEL_HEIGHT

      const result = calculateVisualState(exactMaxScrollPosition, PANEL_HEIGHT);

      expect(result.activeColumn).toBe("right"); // 5 % 3 = 2 (right)
      expect(result.panelPositions).toEqual({
        left: 2,
        center: 2,
        right: 1, // Right column at panel 1
      });
    });
  });

  describe("scroll within active column calculation", () => {
    it("should calculate correct scroll progress within panel", () => {
      const scrollProgress = 150;
      const result = calculateVisualState(
        PANEL_HEIGHT + scrollProgress,
        PANEL_HEIGHT
      );

      expect(result.scrollWithinActiveColumn).toBe(scrollProgress);
    });

    it("should reset scroll progress at panel boundaries", () => {
      const result = calculateVisualState(PANEL_HEIGHT * 2, PANEL_HEIGHT); // Exactly at boundary

      expect(result.scrollWithinActiveColumn).toBe(0);
    });

    it("should maintain scroll progress when capped", () => {
      const excessiveScroll = PANEL_HEIGHT * 10 + 123;
      const result = calculateVisualState(excessiveScroll, PANEL_HEIGHT);

      // The scroll within active column should reflect the excess beyond the capped totalPanelsScrolled
      // Since totalPanelsScrolled is capped at 5, scrollWithinActiveColumn = excessiveScroll - (5 * PANEL_HEIGHT)
      const expectedProgress = excessiveScroll - 5 * PANEL_HEIGHT;
      expect(result.scrollWithinActiveColumn).toBe(expectedProgress);
    });
  });

  describe("mathematical properties", () => {
    it("should be deterministic - same input produces same output", () => {
      const input1 = calculateVisualState(1234, 400);
      const input2 = calculateVisualState(1234, 400);

      expect(input1).toEqual(input2);
    });

    it("should handle fractional panel heights", () => {
      const fractionalHeight = 333.33;
      const result = calculateVisualState(1000, fractionalHeight);

      expect(result.activeColumn).toBeDefined();
      expect(result.panelPositions.left).toBeGreaterThanOrEqual(0);
      expect(result.panelPositions.left).toBeLessThanOrEqual(2);
    });

    it("should maintain panel position bounds", () => {
      // Test various scroll positions to ensure panel positions never exceed bounds
      const testPositions = [0, 100, 500, 1000, 1500, 2000, 2500, 3000, 5000];

      testPositions.forEach((position) => {
        const result = calculateVisualState(position, PANEL_HEIGHT);

        // All panel positions should be between 0 and 2
        expect(result.panelPositions.left).toBeGreaterThanOrEqual(0);
        expect(result.panelPositions.left).toBeLessThanOrEqual(
          PANELS_PER_COLUMN - 1
        );
        expect(result.panelPositions.center).toBeGreaterThanOrEqual(0);
        expect(result.panelPositions.center).toBeLessThanOrEqual(
          PANELS_PER_COLUMN - 1
        );
        expect(result.panelPositions.right).toBeGreaterThanOrEqual(0);
        expect(result.panelPositions.right).toBeLessThanOrEqual(
          PANELS_PER_COLUMN - 1
        );

        // Active column should be one of the three valid options
        expect(["left", "center", "right"]).toContain(result.activeColumn);

        // Scroll within active column should be non-negative
        expect(result.scrollWithinActiveColumn).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe("real-world scenarios", () => {
    it("should handle typical user scroll progression", () => {
      // User scrolls through each panel completely
      const scenarios = [
        { scroll: 0, expected: { active: "left", positions: [0, 0, 0] } },
        {
          scroll: PANEL_HEIGHT * 0.5,
          expected: { active: "left", positions: [0, 0, 0] },
        },
        {
          scroll: PANEL_HEIGHT * 1,
          expected: { active: "center", positions: [1, 0, 0] },
        },
        {
          scroll: PANEL_HEIGHT * 1.5,
          expected: { active: "center", positions: [1, 0, 0] },
        },
        {
          scroll: PANEL_HEIGHT * 2,
          expected: { active: "right", positions: [1, 1, 0] },
        },
        {
          scroll: PANEL_HEIGHT * 2.5,
          expected: { active: "right", positions: [1, 1, 0] },
        },
        {
          scroll: PANEL_HEIGHT * 3,
          expected: { active: "left", positions: [1, 1, 1] },
        },
        {
          scroll: PANEL_HEIGHT * 4,
          expected: { active: "center", positions: [2, 1, 1] },
        },
        {
          scroll: PANEL_HEIGHT * 5,
          expected: { active: "right", positions: [2, 2, 1] },
        },
      ];

      scenarios.forEach(({ scroll, expected }) => {
        const result = calculateVisualState(scroll, PANEL_HEIGHT);

        expect(result.activeColumn).toBe(expected.active);
        expect(result.panelPositions.left).toBe(expected.positions[0]);
        expect(result.panelPositions.center).toBe(expected.positions[1]);
        expect(result.panelPositions.right).toBe(expected.positions[2]);
      });
    });

    it("should handle responsive panel heights", () => {
      // Test with different panel heights that might occur on different screen sizes
      const panelHeights = [300, 400, 500, 600, 800];

      panelHeights.forEach((height) => {
        const result = calculateVisualState(height * 1.5, height);

        expect(result.activeColumn).toBe("center"); // Should be in center after 1 complete panel
        expect(result.panelPositions.left).toBe(1);
        expect(result.panelPositions.center).toBe(0);
        expect(result.scrollWithinActiveColumn).toBe(height * 0.5);
      });
    });
  });
});
