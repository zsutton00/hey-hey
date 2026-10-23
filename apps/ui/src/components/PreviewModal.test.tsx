import {
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { PreviewModal } from "./PreviewModal";

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return (
    <div data-testid="probe">
      {location.pathname}
      {location.search}
      {location.hash}
    </div>
  );
};

describe("PreviewModal", () => {
  it("renders arbitrary slot content when open", () => {
    render(
      <MemoryRouter>
        <PreviewModal open onClose={vi.fn()}>
          <div data-testid="slot-content">Hello preview</div>
        </PreviewModal>
      </MemoryRouter>,
    );

    const content = screen.getByTestId("preview-modal-content");
    expect(content).toBeInTheDocument();
    const computedContentStyle = window.getComputedStyle(content);
    expect(computedContentStyle.display).toBe("flex");
    expect(computedContentStyle.flexDirection).toBe("column");
    expect(computedContentStyle.minHeight).toBe("0");
    expect(computedContentStyle.overflow).toBe("auto");
    expect(computedContentStyle.overscrollBehavior).toBe("contain");
    expect(screen.getByTestId("slot-content")).toHaveTextContent(
      "Hello preview",
    );
  });

  it("does not render content when closed", () => {
    render(
      <MemoryRouter>
        <PreviewModal open={false} onClose={vi.fn()}>
          <div data-testid="slot-content">Hidden</div>
        </PreviewModal>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("slot-content")).not.toBeInTheDocument();
  });

  it("sizes the surface to ~80% of the viewport", () => {
    render(
      <MemoryRouter>
        <PreviewModal open onClose={vi.fn()}>
          <div>content</div>
        </PreviewModal>
      </MemoryRouter>,
    );

    const surface = screen.getByRole("dialog");
    expect(surface).toHaveStyle({ width: "80vw", height: "80vh" });
  });

  it("sizes the dialog layout to 720px unless a width is given", () => {
    render(
      <MemoryRouter>
        <PreviewModal open layout="dialog" onClose={vi.fn()}>
          <div>content</div>
        </PreviewModal>
      </MemoryRouter>,
    );

    expect(screen.getByRole("dialog")).toHaveStyle({ width: "720px" });
  });

  it("sizes the dialog layout to the requested width", () => {
    render(
      <MemoryRouter>
        <PreviewModal open layout="dialog" dialogWidth={440} onClose={vi.fn()}>
          <div>content</div>
        </PreviewModal>
      </MemoryRouter>,
    );

    expect(screen.getByRole("dialog")).toHaveStyle({ width: "440px" });
  });

  it("traps focus within the dialog when opened", () => {
    render(
      <MemoryRouter>
        <PreviewModal open onClose={vi.fn()}>
          <button type="button">Inside</button>
        </PreviewModal>
      </MemoryRouter>,
    );

    // MUI's focus trap moves focus into the modal layer (a focus sentinel or
    // the surface itself) on open, rather than leaving it on the body.
    const root = screen.getByTestId("preview-modal");
    expect(root.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("calls onClose from the close button without navigating", () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter initialEntries={["/projects/p1"]}>
        <PreviewModal open onClose={onClose}>
          <div>content</div>
        </PreviewModal>
        <LocationProbe />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("preview-modal-close"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("probe")).toHaveTextContent("/projects/p1");
  });

  it("asks for confirmation before internal pointer, keyboard, or auxiliary activation", async () => {
    const onAnchorClick = vi.fn();
    const onAnchorAuxClick = vi.fn();
    const initialBrowserUrl = window.location.href;
    const initialHistoryLength = window.history.length;

    render(
      <MemoryRouter initialEntries={["/projects/p1?tab=project"]}>
        <PreviewModal open onClose={vi.fn()}>
          <div>
            <a
              href="/projects/p2"
              onAuxClick={onAnchorAuxClick}
              onClick={onAnchorClick}
            >
              <span data-testid="internal-link-label">Open project</span>
            </a>
          </div>
        </PreviewModal>
        <LocationProbe />
      </MemoryRouter>,
    );

    const linkLabel = screen.getByTestId("internal-link-label");
    const expectUnchanged = () => {
      expect(screen.getByTestId("preview-modal-content")).toBeInTheDocument();
      expect(screen.getByTestId("probe")).toHaveTextContent(
        "/projects/p1?tab=project",
      );
      expect(document.body.ownerDocument.defaultView?.location.href).toBe(
        initialBrowserUrl,
      );
      expect(window.history.length).toBe(initialHistoryLength);
    };
    const cancelConfirmation = async () => {
      expect(
        screen.getByRole("dialog", { name: "Leave preview?" }),
      ).toBeInTheDocument();
      expect(onAnchorClick).not.toHaveBeenCalled();
      expect(onAnchorAuxClick).not.toHaveBeenCalled();
      expectUnchanged();

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await waitForElementToBeRemoved(() =>
        screen.queryByRole("dialog", { name: "Leave preview?" }),
      );
      expectUnchanged();
    };

    fireEvent.click(linkLabel);
    await cancelConfirmation();

    // Browsers produce a click with detail 0 for keyboard activation.
    fireEvent.click(linkLabel, { detail: 0 });
    await cancelConfirmation();

    fireEvent(
      linkLabel,
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    await cancelConfirmation();
  });

  it("closes Preview and navigates once to the captured internal route after confirmation", async () => {
    const onAnchorClick = vi.fn();
    const onClose = vi.fn();
    const initialBrowserUrl = window.location.href;
    const initialHistoryLength = window.history.length;

    render(
      <MemoryRouter initialEntries={["/projects/p1?tab=project"]}>
        <PreviewModal open onClose={onClose}>
          <a href="/projects/p2?tab=details#activity" onClick={onAnchorClick}>
            <span data-testid="internal-link-label">Open project</span>
          </a>
        </PreviewModal>
        <LocationProbe />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("internal-link-label"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(onAnchorClick).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent(
        "/projects/p2?tab=details#activity",
      );
    });
    expect(window.location.href).toBe(initialBrowserUrl);
    expect(window.history.length).toBe(initialHistoryLength);
    await waitForElementToBeRemoved(() =>
      screen.queryByTestId("preview-navigation-confirmation"),
    );
  });

  it("preserves nested non-navigation controls and external links", () => {
    const onButtonClick = vi.fn();
    const onExternalLinkClick = vi.fn((event: React.MouseEvent) => {
      event.preventDefault();
    });

    render(
      <MemoryRouter>
        <PreviewModal open onClose={vi.fn()}>
          <div>
            <button type="button" onClick={onButtonClick}>
              <span data-testid="button-label">Run action</span>
            </button>
            <a href="https://example.com/other" onClick={onExternalLinkClick}>
              <span data-testid="external-link-label">Open external page</span>
            </a>
          </div>
        </PreviewModal>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("button-label"));
    fireEvent.click(screen.getByTestId("external-link-label"));

    expect(onButtonClick).toHaveBeenCalledTimes(1);
    expect(onExternalLinkClick).toHaveBeenCalledTimes(1);
  });

  it("closes and navigates once from the Open link without confirmation", () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <PreviewModal open onClose={onClose} openHref="/projects/p/tasks/t">
          <div>content</div>
        </PreviewModal>
        <LocationProbe />
      </MemoryRouter>,
    );

    const open = screen.getByTestId("preview-modal-open");
    expect(open).toHaveAttribute("href", "/projects/p/tasks/t");
    fireEvent.click(open);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("probe")).toHaveTextContent(
      "/projects/p/tasks/t",
    );
    expect(
      screen.queryByTestId("preview-navigation-confirmation"),
    ).not.toBeInTheDocument();
  });

  it("omits the Open link without an openHref", () => {
    render(
      <MemoryRouter>
        <PreviewModal open onClose={vi.fn()}>
          <div>content</div>
        </PreviewModal>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("preview-modal-open")).not.toBeInTheDocument();
  });
});
