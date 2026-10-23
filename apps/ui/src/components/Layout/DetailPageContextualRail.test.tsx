import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DetailPageContextualRail } from "./DetailPageContextualRail";

describe("DetailPageContextualRail", () => {
  it("owns the page-level toggle and controlled rail semantics", () => {
    const onToggle = vi.fn();

    render(
      <DetailPageContextualRail
        expanded
        label="Feature Tree"
        controlsId="feature-contextual-rail"
        onToggle={onToggle}
      >
        <div data-testid="rail-content">Feature Tree content</div>
      </DetailPageContextualRail>,
    );

    const rail = screen.getByTestId("detail-page-contextual-rail");
    const toggle = within(rail).getByRole("button", {
      name: "Hide Feature Tree",
    });
    const icon = toggle.querySelector("svg");

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute(
      "aria-controls",
      "feature-contextual-rail",
    );
    expect(document.getElementById("feature-contextual-rail")).toHaveTextContent(
      "Feature Tree content",
    );
    expect(icon).toHaveStyle({ transform: "rotate(180deg)" });
    expect(
      screen.getByTestId("detail-page-contextual-rail-chrome"),
    ).not.toContainElement(screen.getByTestId("rail-content"));

    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("uses the unrotated icon and show label when collapsed", () => {
    render(
      <DetailPageContextualRail
        expanded={false}
        label="Metadata"
        controlsId="metadata-contextual-rail"
        onToggle={vi.fn()}
      >
        <div>Metadata content</div>
      </DetailPageContextualRail>,
    );

    const toggle = screen.getByRole("button", { name: "Show Metadata" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.querySelector("svg")).not.toHaveStyle({
      transform: "rotate(180deg)",
    });
    expect(document.getElementById("metadata-contextual-rail")).toBeInTheDocument();
  });

  it("applies consumer-specific positioning to the rail host", () => {
    render(
      <DetailPageContextualRail
        expanded
        label="Goal context"
        controlsId="goal-contextual-rail"
        onToggle={vi.fn()}
        sx={{ position: "relative", top: -30 }}
      >
        <div>Goal context content</div>
      </DetailPageContextualRail>,
    );

    expect(screen.getByTestId("detail-page-contextual-rail")).toHaveStyle({
      position: "relative",
      top: "-30px",
    });
  });
});
