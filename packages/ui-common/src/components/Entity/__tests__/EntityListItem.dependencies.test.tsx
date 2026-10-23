import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { AgentEdgeType } from "../../../api";
import { ConversationPhase } from "../../../api";
import { Provider, createStore } from "jotai";
import { conversationPhaseByIdAtom } from "../../../data/websockets/conversationPhase";
import { EntityListItem, type EntityDependency } from "../EntityListItem";

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

const renderWithRouter = (ui: React.ReactElement) =>
  render(<BrowserRouter>{ui}</BrowserRouter>);

describe("EntityListItem dependencies section", () => {
  it("does not render the section when the prop is omitted", () => {
    renderWithRouter(<EntityListItem title="Task A" status="BACKLOG" />);

    expect(screen.queryByTestId("entity-dependencies")).not.toBeInTheDocument();
  });

  it("renders the conversation phase icon from the shared phase projection", () => {
    const store = createStore();
    store.set(conversationPhaseByIdAtom, {
      "conversation-1": {
        phase: ConversationPhase.Reviewing,
        revision: 1,
        transitionedAt: "2026-08-07T00:00:00.000Z",
      },
    });

    renderWithRouter(
      <Provider store={store}>
        <EntityListItem
          title="Review conversation"
          conversationId="conversation-1"
        />
      </Provider>
    );

    expect(screen.getByTestId("conversation-phase-indicator")).toHaveAttribute(
      "data-phase",
      ConversationPhase.Reviewing
    );
  });

  it("does not render the section when the prop is an empty array", () => {
    renderWithRouter(
      <EntityListItem title="Task A" status="BACKLOG" dependencies={[]} />
    );

    expect(screen.queryByTestId("entity-dependencies")).not.toBeInTheDocument();
  });

  it.each([1, 2])(
    "does not render a more control for %i supplied edges",
    (dependencyCount) => {
      const dependencies: EntityDependency[] = Array.from(
        { length: dependencyCount },
        (_, index) => ({
          edgeType: AgentEdgeType.RelatedTo,
          direction: "outgoing",
          targetTitle: `Dependency ${index + 1}`,
          href: `/projects/p1/tasks/dependency-${index + 1}`,
        })
      );

      renderWithRouter(
        <EntityListItem title="Task A" dependencies={dependencies} />
      );

      expect(screen.getAllByTestId("entity-dependency-row")).toHaveLength(
        dependencyCount
      );
      expect(
        screen.queryByTestId("entity-dependency-more")
      ).not.toBeInTheDocument();
    }
  );

  it("renders relationship label and links the target via the supplied href", () => {
    const dependencies: EntityDependency[] = [
      {
        edgeType: "DEPENDS_ON",
        direction: "outgoing",
        targetTitle: "Auth migration",
        href: "/projects/p1/tasks/auth-migration",
      },
      {
        edgeType: "RELATED_TO",
        direction: "outgoing",
        targetTitle: "Login redesign",
        href: "/projects/p1/tasks/login-redesign",
      },
    ];

    renderWithRouter(
      <EntityListItem
        title="OAuth fix"
        status="ACTIVE"
        dependencies={dependencies}
      />
    );

    expect(screen.getByTestId("entity-dependencies")).toBeInTheDocument();

    expect(screen.getByText("Depends on")).toBeInTheDocument();
    expect(screen.getByText("Related to")).toBeInTheDocument();

    const blockerLink = screen.getByText("Auth migration").closest("a");
    expect(blockerLink).not.toBeNull();
    expect(blockerLink).toHaveAttribute(
      "href",
      "/projects/p1/tasks/auth-migration"
    );

    const relatedLink = screen.getByText("Login redesign").closest("a");
    expect(relatedLink).toHaveAttribute(
      "href",
      "/projects/p1/tasks/login-redesign"
    );
  });

  it("renders the inverse label for incoming DEPENDS_ON edges", () => {
    const dependencies: EntityDependency[] = [
      {
        edgeType: "DEPENDS_ON",
        direction: "incoming",
        targetTitle: "Downstream consumer",
        href: "/projects/p1/tasks/downstream",
      },
    ];

    renderWithRouter(
      <EntityListItem
        title="Shared library upgrade"
        status="ACTIVE"
        dependencies={dependencies}
      />
    );

    expect(screen.getByText("Blocks")).toBeInTheDocument();
  });

  it("shows the hidden edge count and opens an ordered complete-edge dialog", async () => {
    const onClick = vi.fn();
    const dependencies: EntityDependency[] = [
      {
        edgeType: AgentEdgeType.DependsOn,
        direction: "outgoing",
        entityType: "FEATURE",
        targetTitle: "First dependency",
        href: "/projects/p1/tasks/first-dependency",
      },
      {
        edgeType: AgentEdgeType.RelatedTo,
        direction: "incoming",
        targetTitle: "Second dependency",
        href: "/projects/p1/tasks/second-dependency",
      },
      {
        edgeType: AgentEdgeType.Evolves,
        direction: "outgoing",
        entityType: "TASK",
        targetTitle: "Third dependency",
        href: "/projects/p1/tasks/third-dependency",
      },
      {
        edgeType: AgentEdgeType.Supersedes,
        direction: "incoming",
        targetTitle: "Fourth dependency",
        href: "/projects/p1/tasks/fourth-dependency",
      },
    ];

    renderWithRouter(
      <EntityListItem
        title="Task A"
        dependencies={dependencies}
        onClick={onClick}
      />
    );

    expect(screen.getAllByTestId("entity-dependency-row")).toHaveLength(2);
    expect(
      screen
        .getAllByTestId("entity-dependency-title")
        .map((element) => element.textContent)
    ).toEqual(["First dependency", "Second dependency"]);
    expect(screen.getByTestId("entity-dependency-more")).toHaveTextContent(
      "+2"
    );

    fireEvent.click(screen.getByTestId("entity-dependency-more"));

    expect(onClick).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", {
      name: "All dependencies",
    });
    const dialogRows = within(dialog).getAllByTestId(
      "entity-dependency-dialog-row"
    );

    expect(dialogRows).toHaveLength(dependencies.length);
    expect(
      within(dialog)
        .getAllByTestId("entity-dependency-dialog-title")
        .map((element) => element.textContent)
    ).toEqual([
      "First dependency",
      "Second dependency",
      "Third dependency",
      "Fourth dependency",
    ]);
    expect(within(dialog).getByText("Depends on")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Related to (incoming)")
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Evolves")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Supersedes (incoming)")
    ).toBeInTheDocument();
    expect(
      within(dialog)
        .getAllByTestId("entity-dependency-dialog-link")
        .map((link) => link.getAttribute("href"))
    ).toEqual(dependencies.map((dependency) => dependency.href));
    expect(
      within(dialog).getAllByTestId("entity-dependency-dialog-icon")
    ).toHaveLength(2);

    fireEvent.click(
      within(dialog).getAllByTestId("entity-dependency-dialog-link")[0]
    );
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByTestId("entity-dependency-dialog-close")
    );

    await waitFor(() => {
      expect(
        screen.queryByTestId("entity-dependency-dialog")
      ).not.toBeInTheDocument();
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("supports standard Escape dismissal without bubbling to the list item", async () => {
    const onClick = vi.fn();

    renderWithRouter(
      <EntityListItem
        title="Task A"
        dependencies={[
          {
            edgeType: AgentEdgeType.RelatedTo,
            direction: "outgoing",
            targetTitle: "First dependency",
            href: "/projects/p1/tasks/first-dependency",
          },
          {
            edgeType: AgentEdgeType.RelatedTo,
            direction: "outgoing",
            targetTitle: "Second dependency",
            href: "/projects/p1/tasks/second-dependency",
          },
          {
            edgeType: AgentEdgeType.RelatedTo,
            direction: "outgoing",
            targetTitle: "Third dependency",
            href: "/projects/p1/tasks/third-dependency",
          },
        ]}
        onClick={onClick}
      />
    );

    fireEvent.click(screen.getByTestId("entity-dependency-more"));
    const dialog = await screen.findByRole("dialog", {
      name: "All dependencies",
    });

    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });

    await waitFor(() => {
      expect(
        screen.queryByTestId("entity-dependency-dialog")
      ).not.toBeInTheDocument();
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders the endpoint icon before the linked title", () => {
    const dependencies: EntityDependency[] = [
      {
        edgeType: AgentEdgeType.RelatedTo,
        direction: "outgoing",
        entityType: "FEATURE",
        targetTitle: "Feature dependency",
        href: "/projects/p1/tasks/feature-dependency",
      },
    ];

    renderWithRouter(
      <EntityListItem
        title="Task A"
        status="ACTIVE"
        dependencies={dependencies}
      />
    );

    const link = screen.getByText("Feature dependency").closest("a");
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute(
      "href",
      "/projects/p1/tasks/feature-dependency"
    );
    expect(link?.firstElementChild).toHaveAttribute(
      "data-testid",
      "entity-dependency-icon"
    );
    expect(link?.firstElementChild).toHaveAttribute("aria-label", "FEATURE");
  });

  it("omits the endpoint icon when its type metadata is missing", () => {
    const dependencies: EntityDependency[] = [
      {
        edgeType: AgentEdgeType.RelatedTo,
        direction: "outgoing",
        targetTitle: "Legacy dependency",
        href: "/projects/p1/tasks/legacy-dependency",
      },
    ];

    renderWithRouter(
      <EntityListItem
        title="Task A"
        status="ACTIVE"
        dependencies={dependencies}
      />
    );

    expect(
      screen.queryByTestId("entity-dependency-icon")
    ).not.toBeInTheDocument();
    expect(screen.getByText("Legacy dependency").closest("a")).toHaveAttribute(
      "href",
      "/projects/p1/tasks/legacy-dependency"
    );
  });

  it("renders 'Evolved by' for incoming EVOLVES edges", () => {
    const dependencies: EntityDependency[] = [
      {
        edgeType: AgentEdgeType.Evolves,
        direction: "incoming",
        targetTitle: "Previous version",
        href: "/projects/p1/tasks/previous",
      },
    ];

    renderWithRouter(
      <EntityListItem
        title="Refined task"
        status="ACTIVE"
        dependencies={dependencies}
      />
    );

    expect(screen.getByText("Evolved by")).toBeInTheDocument();
  });

  it("keeps dependency rows on one line and ellipsizes the linked title", () => {
    renderWithRouter(
      <EntityListItem
        title="Task A"
        status="ACTIVE"
        dependencies={[
          {
            edgeType: AgentEdgeType.DependsOn,
            direction: "outgoing",
            targetTitle:
              "A very long dependency title that should be truncated instead of wrapping onto another line",
            href: "/projects/p1/tasks/long-dependency",
          },
        ]}
      />
    );

    const row = screen.getByTestId("entity-dependency-row");
    const title = screen.getByTestId("entity-dependency-title");

    expect(window.getComputedStyle(row).flexWrap).toBe("nowrap");
    expect(window.getComputedStyle(title)).toMatchObject({
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
  });
});
