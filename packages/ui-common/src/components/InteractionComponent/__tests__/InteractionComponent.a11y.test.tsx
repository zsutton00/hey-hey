import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { InteractionComponent } from "../InteractionComponent";
import type { InteractionComponentProps } from "../types";

// ---------------------------------------------------------------------------
// IntersectionObserver mock — immediately reports all observed elements as
// visible so the indicator-corner hook picks "bottom-left".
// ---------------------------------------------------------------------------

class MockIntersectionObserver {
  private callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(() => vi.fn()),
}));

vi.mock("../../WebUtils/navigateToEntity", () => ({
  navigateToEntity: vi.fn(),
}));

vi.mock("../../../data/hooks/useEntityContext", () => ({
  useEntityContext: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
    fetch: vi.fn(),
  })),
}));

vi.mock("../../../data/hooks/useEntityStars", () => ({
  useEntityStar: vi.fn(() => ({
    isStarred: false,
    isLoading: false,
    isMutating: false,
    error: null,
    mutationError: null,
    toggle: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../useEntityConversationLauncher", () => ({
  useEntityConversationLauncher: vi.fn(() => ({
    launch: vi.fn().mockResolvedValue(true),
    isLoading: false,
    error: null,
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENTITY_ID = "entity-123";
const ENTITY_TYPE = "TASK" as const;

function buildProps(
  overrides: Partial<InteractionComponentProps> = {},
): InteractionComponentProps {
  return {
    entityId: ENTITY_ID,
    entityType: ENTITY_TYPE,
    hasProposalSupport: true,
    organizationId: "org-1",
    projectId: "proj-1",
    children: <div data-testid="child-content">Child</div>,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: ARIA attributes — interactive branch (hasProposalSupport=true)
// ---------------------------------------------------------------------------

describe("InteractionComponent a11y — ARIA attributes (hasProposalSupport=true)", () => {
  it("has role='group' on the container", () => {
    render(<InteractionComponent {...buildProps()} />);

    expect(screen.getByTestId("interaction-component")).toHaveAttribute(
      "role",
      "group",
    );
  });

  it("has aria-roledescription='interactive entity'", () => {
    render(<InteractionComponent {...buildProps()} />);

    expect(screen.getByTestId("interaction-component")).toHaveAttribute(
      "aria-roledescription",
      "interactive entity",
    );
  });

  it("has a descriptive aria-label containing entity type and id", () => {
    render(<InteractionComponent {...buildProps()} />);

    expect(screen.getByTestId("interaction-component")).toHaveAttribute(
      "aria-label",
      `Actions for ${ENTITY_TYPE} ${ENTITY_ID}`,
    );
  });

  it("is keyboard-focusable via tabIndex=0", () => {
    render(<InteractionComponent {...buildProps()} />);

    expect(screen.getByTestId("interaction-component")).toHaveAttribute(
      "tabindex",
      "0",
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: ARIA attributes — baseline Discuss capability
// ---------------------------------------------------------------------------

describe("InteractionComponent a11y — ARIA attributes (baseline Discuss capability)", () => {
  it("keeps role='group' when proposals and Preview are unsupported", () => {
    render(
      <InteractionComponent
        {...buildProps({
          entityType: "SERVICE",
          hasProposalSupport: false,
        })}
      />,
    );

    expect(screen.getByTestId("interaction-component")).toHaveAttribute(
      "role",
      "group",
    );
  });

  it("is keyboard-focusable for the baseline Discuss action", () => {
    render(
      <InteractionComponent
        {...buildProps({
          entityType: "SERVICE",
          hasProposalSupport: false,
        })}
      />,
    );

    expect(screen.getByTestId("interaction-component")).toHaveAttribute(
      "tabindex",
      "0",
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: visual indicator hidden from screen readers (hasProposalSupport=true)
// ---------------------------------------------------------------------------

describe("InteractionComponent a11y — visual indicator screen reader hiding (hasProposalSupport=true)", () => {
  it("sparkle indicator SVG has aria-hidden='true'", () => {
    render(<InteractionComponent {...buildProps()} />);

    const indicator = screen.getByTestId("interaction-indicator");
    const svg = indicator.querySelector("svg");
    // toBeInTheDocument() produces a legible failure if svg is null,
    // stopping execution before toHaveAttribute would TypeError.
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});

// ---------------------------------------------------------------------------
// Tests: keyboard operability
// ---------------------------------------------------------------------------

describe("InteractionComponent a11y — keyboard operability", () => {
  it("Tab navigates to the container when proposal support is enabled", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button data-testid="preceding-button">Before</button>
        <InteractionComponent {...buildProps()} />
      </div>,
    );

    // userEvent.tab() simulates browser tab order in jsdom. This relies on
    // tabIndex=0 being the only focusable element after preceding-button with
    // no intervening focusable children inside InteractionComponent.
    screen.getByTestId("preceding-button").focus();
    await user.tab();

    expect(document.activeElement).toBe(
      screen.getByTestId("interaction-component"),
    );
  });

  it("Tab reaches the container when only the baseline Discuss action is available", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button data-testid="preceding-button">Before</button>
        <InteractionComponent
          {...buildProps({
            entityType: "SERVICE",
            hasProposalSupport: false,
          })}
        />
        <button data-testid="following-button">After</button>
      </div>,
    );

    screen.getByTestId("preceding-button").focus();
    await user.tab();

    expect(document.activeElement).toBe(
      screen.getByTestId("interaction-component"),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: focus management — Escape returns focus to container
// ---------------------------------------------------------------------------

describe("InteractionComponent a11y — focus management", () => {
  it("Escape key closes the menu and returns focus to the container", async () => {
    const user = userEvent.setup();
    render(<InteractionComponent {...buildProps()} />);

    const container = screen.getByTestId("interaction-component");
    container.focus();

    // Open menu via keyboard. userEvent.keyboard fires on document.activeElement
    // (the container), which triggers handleKeyDown → openMenu.
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("interaction-context-menu")).toBeInTheDocument();

    // NOTE: In a real browser autoFocusItem would move focus into the MenuList,
    // meaning the Escape keydown would fire on the menu item — not the container
    // — and handleKeyDown (attached to the container) would not see it. In jsdom,
    // autoFocusItem does not transfer document.activeElement, so focus stays on
    // the container and the Escape handler fires correctly. This test validates
    // the focus-return behaviour (containerRef.current.focus()) under jsdom
    // semantics only.
    await user.keyboard("{Escape}");

    expect(
      screen.queryByTestId("interaction-context-menu"),
    ).not.toBeInTheDocument();
    expect(document.activeElement).toBe(container);
  });
});

// ---------------------------------------------------------------------------
// Tests: context menu ARIA structure
// ---------------------------------------------------------------------------

describe("InteractionComponent a11y — context menu ARIA structure", () => {
  it("renders a role='menu' widget with tabIndex=-1 and focusable menuitems", () => {
    render(<InteractionComponent {...buildProps()} />);

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    const menu = screen.getByTestId("interaction-context-menu");
    // MUI MenuList renders as <ul role="menu" tabIndex="-1">. The autoFocusItem
    // prop on MenuList calls .focus() on the first non-disabled menuitem in a
    // real browser, enabling keyboard navigation without a prior mouse click.
    // In jsdom, document.activeElement does not update from autoFocusItem's
    // layout effect, so we assert the structural prerequisites instead.
    const menuList = menu.querySelector('[role="menu"]');
    expect(menuList).toBeInTheDocument();
    expect(menuList).toHaveAttribute("tabindex", "-1");
    expect(menu.querySelector('[role="menuitem"]')).toBeInTheDocument();
  });
});

it("keeps review controls accessible when the entity card cannot be dragged", async () => {
  const inspect = vi.fn();
  render(
    <InteractionComponent
      {...buildProps({
        entityType: "PROPOSAL",
        draggable: false,
        children: <button onClick={inspect}>Show all requirements</button>,
      })}
    />,
  );
  expect(screen.getByTestId("interaction-component")).not.toHaveAttribute(
    "aria-disabled",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Show all requirements" }),
  );
  expect(inspect).toHaveBeenCalledOnce();
});
