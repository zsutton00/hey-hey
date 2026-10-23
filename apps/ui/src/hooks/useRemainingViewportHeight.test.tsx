import { act, render, screen } from "@testing-library/react";
import {
  calculateRemainingViewportHeight,
  useRemainingViewportHeight,
} from "./useRemainingViewportHeight";

const RemainingHeightHarness = () => {
  const { containerRef, height } = useRemainingViewportHeight(true, 8);

  return (
    <div
      ref={containerRef}
      data-testid="remaining-viewport-height"
      data-height={height ?? "unmeasured"}
    />
  );
};

describe("useRemainingViewportHeight", () => {
  it("fills from the container top to the viewport bottom and updates on resize", () => {
    const originalInnerHeight = window.innerHeight;
    const getBoundingClientRectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        bottom: 900,
        height: 750,
        left: 0,
        right: 100,
        top: 150,
        width: 100,
        x: 0,
        y: 150,
        toJSON: () => ({}),
      });

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 900,
    });

    render(<RemainingHeightHarness />);

    expect(screen.getByTestId("remaining-viewport-height")).toHaveAttribute(
      "data-height",
      "742",
    );

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    act(() => window.dispatchEvent(new Event("resize")));

    expect(screen.getByTestId("remaining-viewport-height")).toHaveAttribute(
      "data-height",
      "642",
    );

    getBoundingClientRectSpy.mockRestore();
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalInnerHeight,
    });
  });

  it("never returns a negative height for a short viewport", () => {
    expect(calculateRemainingViewportHeight(480, 500, 8)).toBe(0);
  });
});
