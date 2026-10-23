import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { DetailPageBody } from "./DetailPageBody";

const setViewport = (matches: boolean): void => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

describe("DetailPageBody contextual rail", () => {
  it("removes the rail column and keeps a page-owned reopen control", () => {
    setViewport(false);

    const onToggle = vi.fn();
    const Example = (): React.ReactElement => {
      const [expanded, setExpanded] = React.useState(true);

      return (
        <DetailPageBody
          sidebar={<aside data-testid="sidebar-content">Sidebar</aside>}
          content={<main data-testid="main-content">Main</main>}
          sidebarSide="right"
          contextualRail={{
            id: "example-contextual-rail",
            label: "Context",
            expanded,
            onToggle: () => {
              onToggle();
              setExpanded((previous) => !previous);
            },
          }}
        />
      );
    };

    render(<Example />);

    expect(screen.getByTestId("detail-page-contextual-rail")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide Context" }));

    expect(onToggle).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("sidebar-content")).not.toBeInTheDocument();
    expect(screen.getByTestId("main-content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show Context" })).toHaveAttribute(
      "aria-controls",
      "example-contextual-rail",
    );
  });

  it("stacks the primary content before the visible rail on mobile", () => {
    setViewport(true);

    render(
      <DetailPageBody
        sidebar={<aside data-testid="sidebar-content">Sidebar</aside>}
        content={<main data-testid="main-content">Main</main>}
        sidebarSide="right"
        contextualRail={{
          id: "mobile-contextual-rail",
          label: "Context",
          expanded: true,
          onToggle: vi.fn(),
        }}
      />,
    );

    expect(
      screen.getByTestId("main-content").compareDocumentPosition(
        screen.getByTestId("detail-page-contextual-rail"),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("passes a bounded height through desktop panes and the contextual rail", () => {
    setViewport(false);

    const { container } = render(
      <DetailPageBody
        sidebar={<aside>Sidebar</aside>}
        content={<main data-testid="main-content">Main</main>}
        contextualRail={{
          id: "bounded-contextual-rail",
          label: "Context",
          expanded: true,
          onToggle: vi.fn(),
        }}
        fillHeight
      />,
    );

    expect(container.firstElementChild).toHaveStyle({
      height: "100%",
      minHeight: "0",
    });
    expect(screen.getByTestId("main-content").parentElement).toHaveStyle({
      height: "100%",
      minHeight: "0",
    });
    expect(screen.getByTestId("detail-page-contextual-rail")).toHaveStyle({
      height: "100%",
      minHeight: "0",
    });
    expect(document.getElementById("bounded-contextual-rail")).toHaveStyle({
      minHeight: "0",
    });
  });
});
