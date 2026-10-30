import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConversationPanelLayout } from "../ConversationPanelLayout";

const originalMatchMedia = window.matchMedia;

const setPhoneViewport = (isPhone: boolean): void => {
  window.matchMedia = ((query: string) => ({
    matches: isPhone,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
};

const renderLayout = (isExpanded = false): void => {
  render(
    <ConversationPanelLayout
      isExpanded={isExpanded}
      leftContent={<div>Left body</div>}
      rightContent={<div>Right body</div>}
    />,
  );
};

describe("ConversationPanelLayout", () => {
  beforeEach(() => {
    setPhoneViewport(false);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("uses the full width without a right pane and preserves the body when chat opens", () => {
    const { rerender } = render(
      <ConversationPanelLayout
        isExpanded={false}
        leftContent={
          <input aria-label="Review note" defaultValue="Keep my review" />
        }
        rightContent={null}
      />,
    );
    const body = screen.getByRole("textbox", { name: "Review note" });
    expect(screen.queryByTestId("conversation-layout-right-panel")).toBeNull();
    expect(screen.getByTestId("conversation-layout-left-panel")).toHaveStyle({
      flex: "1 1 100%",
    });
    expect(screen.getByTestId("conversation-layout-panel")).toHaveStyle({
      maxWidth: "100%",
    });
    rerender(
      <ConversationPanelLayout
        isExpanded={false}
        leftContent={
          <input aria-label="Review note" defaultValue="Keep my review" />
        }
        rightContent={<div>Editing chat</div>}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Review note" })).toBe(body);
    expect(
      screen.getByTestId("conversation-layout-right-panel"),
    ).toHaveTextContent("Editing chat");
  });

  it("lays the panels out side by side with a sticky right panel on desktop", () => {
    renderLayout();

    expect(screen.getByTestId("conversation-layout-panel")).toHaveStyle({
      flexDirection: "row",
    });
    expect(screen.getByTestId("conversation-layout-left-panel")).toHaveStyle({
      flex: "0 0 60%",
    });
    expect(screen.getByTestId("conversation-layout-right-panel")).toHaveStyle({
      flex: "0 0 40%",
      maxWidth: "40%",
      position: "sticky",
    });
  });

  it("stacks the right panel below the left at full width on a phone", () => {
    setPhoneViewport(true);
    renderLayout();

    const layout = screen.getByTestId("conversation-layout-panel");
    const left = screen.getByTestId("conversation-layout-left-panel");
    const right = screen.getByTestId("conversation-layout-right-panel");

    expect(layout).toHaveStyle({ flexDirection: "column" });
    expect(
      left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(left).toHaveStyle({ flex: "0 0 auto" });
    expect(right).toHaveStyle({ flex: "0 0 auto", maxWidth: "100%" });
  });

  it("drops sticky positioning and the viewport max-height on a phone", () => {
    setPhoneViewport(true);
    renderLayout(true);

    const right = screen.getByTestId("conversation-layout-right-panel");
    expect(right).not.toHaveStyle({ position: "sticky" });
    expect(right.style.maxHeight).toBe("");
    expect(right).not.toHaveStyle({ overflowY: "auto" });
  });
});
