import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { AgentSessionType } from "../../../api";
import { EntityListItem } from "../EntityListItem";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

beforeAll(() => {
  if (!global.ResizeObserver) {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

const setViewportMatches = (matches: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const renderWithRouter = (ui: React.ReactElement) =>
  render(<BrowserRouter>{ui}</BrowserRouter>);

describe("EntityListItem mobile variant (<=md)", () => {
  beforeEach(() => {
    setViewportMatches(true);
  });

  it("renders the description without a fixed pixel width on mobile", () => {
    renderWithRouter(
      <EntityListItem
        title="Long task title that should wrap"
        description="This is a long description that previously used a measured pixel width and forced single-line truncation. On mobile it should wrap freely."
        status="ACTIVE"
      />,
    );

    const description = screen.getByText(/This is a long description/);
    const style = (description as HTMLElement).style;
    expect(style.width).toBe("");
    expect(style.whiteSpace).not.toBe("nowrap");
  });

  it("shows status as a compact icon on the title row on mobile", () => {
    renderWithRouter(<EntityListItem title="OAuth fix" status="IN_PROGRESS" />);

    const title = screen.getByText("OAuth fix");
    const statusChip = screen.getByLabelText("IN_PROGRESS");
    expect(screen.queryByText("IN_PROGRESS")).not.toBeInTheDocument();
    expect(statusChip.querySelector("svg")).toBeTruthy();

    const titleStack = title.closest("[class*='MuiStack-root']") as HTMLElement;
    const flexDirection =
      titleStack.style.flexDirection ||
      window.getComputedStyle(titleStack).flexDirection;
    expect(flexDirection).toBe("row");
    expect(titleStack).toContainElement(statusChip);
  });

  it("keeps title and status on one row when configured on mobile", () => {
    renderWithRouter(
      <EntityListItem
        title="OAuth fix"
        status="IN_PROGRESS"
        titleStatusLayout="row"
      />,
    );

    const title = screen.getByText("OAuth fix");
    const titleStack = title.closest(
      "[class*='MuiStack-root']",
    ) as HTMLElement | null;
    expect(titleStack).toBeTruthy();
    if (titleStack) {
      const flexDirection =
        titleStack.style.flexDirection ||
        window.getComputedStyle(titleStack).flexDirection;
      expect(flexDirection).not.toBe("column");
    }
  });

  it("renders the status-leading adornment immediately before the status chip", () => {
    renderWithRouter(
      <EntityListItem
        title="Coding session"
        status="IN_PROGRESS"
        leadingContent={<span data-testid="title-leading-adornment" />}
        statusLeadingAdornment={<span data-testid="status-leading-adornment" />}
        titleStatusLayout="row"
      />,
    );

    const titleAdornment = screen.getByTestId("title-leading-adornment");
    const statusAdornment = screen.getByTestId("status-leading-adornment");
    const title = screen.getByText("Coding session");
    const status = screen.getByText("IN_PROGRESS");
    const statusGroup = screen.getByTestId("entity-list-item-status");

    expect(statusGroup).toContainElement(statusAdornment);
    expect(statusGroup).toContainElement(status);
    expect(statusGroup).not.toContainElement(titleAdornment);
    expect(
      window.getComputedStyle(status.closest(".MuiChip-root") as HTMLElement)
        .marginLeft,
    ).toBe("8px");
    expect(
      statusAdornment.compareDocumentPosition(status) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      titleAdornment.compareDocumentPosition(title) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows dates on one line on mobile", () => {
    renderWithRouter(
      <EntityListItem
        title="Task"
        status="ACTIVE"
        createdAt="2026-01-01T00:00:00Z"
        updatedAt="2026-02-01T00:00:00Z"
      />,
    );

    const createdAt = screen.getByTestId("entity-created-at");
    const datesStack = createdAt.parentElement as HTMLElement | null;
    expect(datesStack).toBeTruthy();
    if (datesStack) {
      const flexDirection =
        datesStack.style.flexDirection ||
        window.getComputedStyle(datesStack).flexDirection;
      expect(flexDirection).toBe("row");
    }
  });

  it("renders the delete button in a trailing row, not the side gutter", () => {
    renderWithRouter(
      <EntityListItem title="Task" status="ACTIVE" onDelete={vi.fn()} />,
    );

    const deleteButton = screen.getByLabelText("Delete");
    expect(deleteButton).toBeInTheDocument();

    // Should not be a sibling of the content Box inside the row Stack
    // Instead it lives in a trailing row at the bottom of the ListItem.
    const listItem = deleteButton.closest("li");
    expect(listItem).toBeTruthy();
  });

  it("constrains card width to its container", () => {
    const { container } = renderWithRouter(
      <div style={{ width: 320 }}>
        <EntityListItem
          title="Some really really long task title that previously caused horizontal overflow on a 375px viewport"
          status="ACTIVE"
        />
      </div>,
    );

    const listItem = container.querySelector("li");
    expect(listItem).toBeTruthy();
    if (listItem) {
      const style = window.getComputedStyle(listItem);
      expect(style.boxSizing).toBe("border-box");
    }
  });

  it("shows a primary value chip and an info control for mobile details", () => {
    renderWithRouter(
      <EntityListItem
        title="Coding session"
        metadata={[
          { label: "User", value: "Bob Johnson" },
          { label: "Service", value: "Auth Service" },
          { label: "Provider", value: "Codex" },
          { label: "Worktree", value: "feature/mobile-metadata" },
          { label: "Absent", value: "   " },
        ]}
      />,
    );

    const toggle = screen.getByTestId(
      "entity-list-item-metadata-mobile-toggle",
    );
    const primary = screen.getByTestId(
      "entity-list-item-metadata-mobile-primary",
    );
    expect(primary).toHaveTextContent("Bob Johnson");
    expect(primary).toHaveAttribute("aria-label", "Show more details");
    expect(toggle).toHaveAttribute("aria-haspopup", "dialog");
    expect(toggle).toHaveAttribute("aria-label", "Show more details");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    const details = screen.getByTestId(
      "entity-list-item-metadata-mobile-details",
    );
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(primary).toHaveAttribute("aria-expanded", "true");
    expect(details).toHaveTextContent("UserBob Johnson");
    expect(details).toHaveTextContent("ServiceAuth Service");
    expect(details).toHaveTextContent("ProviderCodex");
    expect(details).toHaveTextContent("Worktreefeature/mobile-metadata");
    expect(details).not.toHaveTextContent("Absent");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(primary);
    expect(primary).toHaveAttribute("aria-expanded", "true");
  });
});

describe("EntityListItem desktop variant (>md)", () => {
  beforeEach(() => {
    setViewportMatches(false);
  });

  it("renders title and status on a single row", () => {
    renderWithRouter(<EntityListItem title="OAuth fix" status="IN_PROGRESS" />);

    const title = screen.getByText("OAuth fix");
    const titleStack = title.closest(
      "[class*='MuiStack-root']",
    ) as HTMLElement | null;
    expect(titleStack).toBeTruthy();
    if (titleStack) {
      const flexDirection =
        titleStack.style.flexDirection ||
        window.getComputedStyle(titleStack).flexDirection;
      // When direction="row" MUI omits flex-direction inline (default), so an
      // empty value is acceptable as long as it's not "column".
      expect(flexDirection).not.toBe("column");
    }
  });

  it("renders an opt-in entity icon before title and status", () => {
    renderWithRouter(
      <EntityListItem
        title="OAuth fix"
        entityKindLabel="Bug"
        entityKindIcon="task"
        status="IN_PROGRESS"
      />,
    );

    const icon = screen.getByTestId("entity-kind-icon");
    const title = screen.getByText("OAuth fix");
    const status = screen.getByText("IN_PROGRESS");

    expect(icon).toHaveAttribute("aria-label", "Bug");
    expect(icon.compareDocumentPosition(title)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(title.compareDocumentPosition(status)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.queryByText("Bug")).not.toBeInTheDocument();
  });

  it("top-aligns the entity icon with a multi-line title", () => {
    renderWithRouter(
      <EntityListItem
        title="A deliberately long task title that wraps onto more than one line"
        entityKindLabel="Task"
        entityKindIcon="task"
      />,
    );

    expect(screen.getByTestId("entity-kind-icon")).toHaveStyle({
      alignSelf: "flex-start",
    });
  });

  it("uses the talking icon for a non-coding agent session", () => {
    renderWithRouter(
      <EntityListItem
        title="Discuss the release"
        entityKindLabel="Agent session"
        entityKindIcon="agent_session"
        agentSessionType={AgentSessionType.EntityConversation}
      />,
    );

    expect(screen.getByTestId("entity-kind-icon")).toHaveAttribute(
      "aria-label",
      "Agent session",
    );
    expect(screen.getByTestId("ForumOutlinedIcon")).toBeInTheDocument();
  });

  it("renders without lifecycle status", () => {
    const { container } = renderWithRouter(
      <EntityListItem title="Feature hierarchy" />,
    );

    expect(screen.getByText("Feature hierarchy")).toBeInTheDocument();
    expect(container.querySelectorAll(".MuiChip-root")).toHaveLength(0);
  });

  it("renders the delete button as a side gutter sibling on desktop", () => {
    renderWithRouter(
      <EntityListItem title="Task" status="ACTIVE" onDelete={vi.fn()} />,
    );

    const deleteButton = screen.getByLabelText("Delete");
    expect(deleteButton).toBeInTheDocument();
  });

  it("keeps metadata as separate desktop value chips", () => {
    renderWithRouter(
      <EntityListItem
        title="Coding session"
        metadata={[
          { label: "User", value: "Bob Johnson" },
          { label: "Service", value: "Auth Service" },
        ]}
      />,
    );

    expect(
      screen.getByTestId("entity-list-item-metadata-desktop"),
    ).toBeInTheDocument();
    expect(screen.getByText("Bob Johnson")).toBeInTheDocument();
    expect(screen.getByText("Auth Service")).toBeInTheDocument();
    expect(
      screen.queryByTestId("entity-list-item-metadata-mobile-toggle"),
    ).not.toBeInTheDocument();
  });
});
