import React from "react";
import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Breadcrumbs } from "../Breadcrumbs";
import type { BreadcrumbItem } from "../../../utils/breadcrumbs";

vi.mock("../../../data/hooks/useProject", () => ({
  useProject: vi.fn(() => ({
    data: null,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
  })),
}));

vi.mock("../../../data/hooks/useInitiative", () => ({
  useInitiative: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
    isStale: false,
    update: vi.fn(),
    refetch: vi.fn(),
    markStale: vi.fn(),
  })),
}));

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: vi.fn(() => ({
    workItem: null,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
  })),
}));

vi.mock("../../../data/hooks/useDesignDoc", () => ({
  useDesignDoc: vi.fn(() => ({
    data: null,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
  })),
}));

vi.mock("../../../services/authService", () => ({
  getAuthToken: vi.fn(() => null),
}));

// Stub InteractionComponent so task/design-doc breadcrumb drag can be asserted
// without its full dependency tree; it still renders children so the inner
// BreadcrumbLink test ids remain queryable.
vi.mock("../../InteractionComponent", () => ({
  InteractionComponent: ({
    entityId,
    entityType,
    children,
  }: {
    entityId: string;
    entityType: string;
    children: React.ReactNode;
  }) => (
    <div
      data-testid="interaction-component"
      data-entity-id={entityId}
      data-entity-type={entityType}
    >
      {children}
    </div>
  ),
}));

type MatchMediaResult = {
  matches: boolean;
  media: string;
  onchange: null;
  addListener: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  dispatchEvent: ReturnType<typeof vi.fn>;
};

const stubMatchMedia = (compact: boolean) => {
  const matcher = (query: string): MatchMediaResult => {
    const matches = compact ? /max-width/.test(query) : /min-width/.test(query);
    return {
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  };

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation(matcher),
  });
};

const sampleItems: BreadcrumbItem[] = [
  { label: "Projects", to: "/projects" },
  { label: "Acme Project", to: "/projects/1", type: "project" },
  {
    label: "Initiative One",
    to: "/projects/1/initiatives/2",
    type: "initiative",
  },
  { label: "Task Detail", isCurrent: true, type: "task" },
];

const draggableItems: BreadcrumbItem[] = [
  { label: "Projects", to: "/projects" },
  {
    label: "Acme Project",
    to: "/projects/1",
    type: "project",
    entityId: "proj-1",
  },
  {
    label: "Initiative One",
    to: "/projects/1/initiatives/2",
    type: "initiative",
    entityId: "init-1",
  },
  { label: "Task Detail", isCurrent: true, type: "task", entityId: "task-1" },
];

describe("Breadcrumbs", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("on wide viewports (> md)", () => {
    beforeEach(() => {
      stubMatchMedia(false);
    });

    it("collapses only middle feature ancestors and preserves their navigation and drag wiring", () => {
      const features: BreadcrumbItem[] = [
        "Root",
        "Middle One",
        "Middle Two",
        "Parent",
      ].map((label, index) => ({
        label,
        kind: "feature",
        type: "feature",
        entityId: `feature-${index}`,
        to: `/features/${index}`,
      }));
      render(
        <MemoryRouter>
          <Breadcrumbs items={[sampleItems[1], ...features, sampleItems[3]]} />
        </MemoryRouter>
      );
      expect(screen.queryByText("Middle One")).toBeNull();
      expect(screen.getByText("Root")).toBeInTheDocument();
      expect(screen.getByText("Parent")).toBeInTheDocument();
      expect(screen.getByText("Task Detail")).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "Show hidden feature ancestors" })
      );
      const hidden = screen.getAllByTestId("breadcrumbs-hidden-feature");
      expect(hidden.map((element) => element.textContent)).toEqual([
        "Middle Onefeature",
        "Middle Twofeature",
      ]);
      expect(screen.getByRole("link", { name: /Middle One/ })).toHaveAttribute(
        "href",
        "/features/1"
      );
      expect(
        hidden[0].querySelector('[data-testid="interaction-component"]')
      ).toHaveAttribute("data-entity-id", "feature-1");
      fireEvent.click(screen.getByRole("link", { name: /Middle One/ }));
      expect(
        screen.getByRole("button", { name: "Show hidden feature ancestors" })
      ).toHaveAttribute("aria-expanded", "false");
    });

    it("renders every crumb as a BreadcrumbLink in a single chain", () => {
      render(
        <MemoryRouter>
          <Breadcrumbs items={sampleItems} />
        </MemoryRouter>
      );

      sampleItems.forEach((_, index) => {
        expect(
          screen.getByTestId(`breadcrumbs-item-${index}`)
        ).toBeInTheDocument();
      });
      expect(screen.queryByTestId("breadcrumbs-back")).toBeNull();
      expect(screen.queryByTestId("breadcrumbs-overflow")).toBeNull();
    });

    it("keeps long breadcrumb chains on one clipped line", () => {
      render(
        <MemoryRouter>
          <Breadcrumbs items={sampleItems} />
        </MemoryRouter>
      );

      const breadcrumbs = screen.getByTestId("breadcrumbs");
      expect(breadcrumbs).toHaveStyle({ overflow: "hidden" });
      screen.getAllByTestId("breadcrumb-link-label").forEach((label) => {
        expect(label).toHaveStyle({ whiteSpace: "nowrap" });
      });
    });
  });

  describe("on compact viewports (<= md)", () => {
    beforeEach(() => {
      stubMatchMedia(true);
    });

    it("discloses every feature ancestor without desktop collapse", () => {
      const features: BreadcrumbItem[] = ["Root", "Middle", "Parent"].map(
        (label) => ({
          label,
          kind: "feature",
          type: "feature",
          to: `/features/${label}`,
        })
      );
      render(
        <MemoryRouter>
          <Breadcrumbs items={[sampleItems[1], ...features, sampleItems[3]]} />
        </MemoryRouter>
      );
      fireEvent.click(screen.getByRole("button"));
      expect(screen.queryByTestId("breadcrumbs-feature-overflow")).toBeNull();
      expect(
        screen
          .getAllByTestId(/breadcrumbs-trail-item-/)
          .map((item) => item.textContent)
      ).toEqual(["Parent", "Middle", "Root", "Acme Project"]);
    });

    it("renders only the centered current crumb", () => {
      render(
        <MemoryRouter>
          <Breadcrumbs items={sampleItems} />
        </MemoryRouter>
      );

      expect(screen.getByTestId("breadcrumbs-current")).toHaveTextContent(
        "Task Detail"
      );
      expect(screen.queryByTestId("breadcrumbs-back")).toBeNull();
      expect(screen.queryByTestId("breadcrumbs-overflow")).toBeNull();
      expect(screen.queryByTestId("breadcrumbs-item-0")).toBeNull();
      expect(screen.queryByTestId("breadcrumbs-item-1")).toBeNull();
    });

    it("opens the ancestor trail without repeating the current header title", () => {
      render(
        <MemoryRouter>
          <Breadcrumbs items={sampleItems} />
        </MemoryRouter>
      );

      const trigger = screen.getByRole("button", { name: "Task Detail" });
      fireEvent.click(trigger);

      expect(screen.getAllByText("Task Detail")).toHaveLength(1);
      expect(screen.getAllByTestId(/breadcrumbs-trail-item-/)).toHaveLength(
        sampleItems.length - 1
      );
      sampleItems.slice(0, -1).forEach((_, index) => {
        expect(
          screen.getByTestId(`breadcrumbs-trail-item-${index}`)
        ).toBeInTheDocument();
      });
    });

    it("clears selection, shows parent first and Projects last, and keeps crumbs navigable", () => {
      const selection = window.getSelection();
      if (!selection) {
        throw new Error("Expected jsdom to provide a text selection");
      }
      const removeAllRanges = vi.spyOn(selection, "removeAllRanges");
      vi.spyOn(window, "getSelection").mockReturnValue(selection);

      render(
        <MemoryRouter>
          <Breadcrumbs items={sampleItems} />
        </MemoryRouter>
      );

      const trigger = screen.getByRole("button", { name: "Task Detail" });
      fireEvent.click(trigger);

      expect(removeAllRanges).toHaveBeenCalledOnce();
      const disclosedTrail = screen.getAllByTestId(/breadcrumbs-trail-item-/);
      expect(disclosedTrail.map((item) => item.textContent?.trim())).toEqual(
        sampleItems
          .slice(0, -1)
          .reverse()
          .map((item) => item.label)
      );

      disclosedTrail.forEach((item, index) => {
        expect(item.parentElement).toHaveStyle({ minHeight: "44px" });
        const sourceItem = sampleItems.slice(0, -1).reverse()[index];
        if (sourceItem.to) {
          expect(item).toHaveAttribute("href", sourceItem.to);
        }
      });
    });

    it("measures wrapped content and updates the bounded extension when it resizes", async () => {
      let resize: (() => void) | undefined;
      const disconnect = vi.fn();
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(callback: () => void) {
            resize = callback;
          }
          observe() {}
          disconnect = disconnect;
        }
      );
      let height = 180;
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect"
      ).mockImplementation(() => ({
        height,
        width: 375,
        top: 48,
        bottom: 48 + height,
        left: 0,
        right: 375,
        x: 0,
        y: 48,
        toJSON: () => ({}),
      }));
      const longLabel =
        "A very long breadcrumb label that must remain fully readable when wrapped";
      render(
        <MemoryRouter>
          <Breadcrumbs
            items={[
              ...sampleItems.slice(0, -1),
              { label: longLabel, to: "/parent" },
              sampleItems[sampleItems.length - 1],
            ]}
          />
        </MemoryRouter>
      );
      const trigger = screen.getByRole("button");
      fireEvent.click(trigger);
      const region = screen.getByTestId("breadcrumbs-trail-region");
      expect(region).toHaveStyle({
        height: "180px",
        maxHeight: "calc(100dvh - 48px)",
        overflowY: "auto",
      });
      expect(screen.getByTestId("breadcrumbs-trail-item-0")).toHaveTextContent(
        longLabel
      );
      height = 900;
      act(() => resize?.());
      expect(region).toHaveStyle({ height: "900px" });
      fireEvent.keyDown(region, { key: "Escape" });
      expect(region).toHaveAttribute("inert");
      await waitFor(() =>
        expect(screen.queryByTestId("breadcrumbs-trail-region")).toBeNull()
      );
      expect(trigger).toHaveFocus();
      expect(disconnect).toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("closes the extension after selecting a destination or toggling the title", async () => {
      render(
        <MemoryRouter>
          <Breadcrumbs items={sampleItems} />
        </MemoryRouter>
      );
      const trigger = screen.getByRole("button");
      fireEvent.click(trigger);
      fireEvent.click(screen.getByTestId("breadcrumbs-trail-item-0"));
      await waitFor(() =>
        expect(screen.queryByTestId("breadcrumbs-trail-region")).toBeNull()
      );
      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    });

    it("prevents current-link navigation while opening the trail on click", () => {
      const itemsWithNavigableCurrent = [
        ...sampleItems.slice(0, -1),
        { label: "Task Detail", to: "/projects/1/tasks/3" },
      ];
      render(
        <MemoryRouter>
          <Breadcrumbs items={itemsWithNavigableCurrent} />
        </MemoryRouter>
      );

      const trigger = screen.getByRole("button", { name: "Task Detail" });
      const clickEvent = createEvent.click(trigger);
      fireEvent(trigger, clickEvent);

      expect(clickEvent.defaultPrevented).toBe(true);
      expect(
        screen.getByTestId("breadcrumbs-trail-region")
      ).toBeInTheDocument();
    });

    it.each(["Enter", " "])("opens the full trail from %s", (key) => {
      render(
        <MemoryRouter>
          <Breadcrumbs items={sampleItems} />
        </MemoryRouter>
      );

      fireEvent.keyDown(screen.getByRole("button", { name: "Task Detail" }), {
        key,
      });

      expect(
        screen.getByTestId("breadcrumbs-trail-region")
      ).toBeInTheDocument();
    });

    it("does not render type labels for the current crumb or disclosed trail", () => {
      render(
        <MemoryRouter>
          <Breadcrumbs items={sampleItems} />
        </MemoryRouter>
      );

      // Type labels are uppercase captions rendered only when the `type` prop is
      // passed to BreadcrumbLink. On mobile neither the current crumb nor the
      // overflow popover items should show them.
      expect(
        screen
          .getByTestId("breadcrumbs-current")
          .querySelector(".MuiTypography-caption")
      ).toBeNull();

      fireEvent.keyDown(screen.getByRole("button", { name: "Task Detail" }), {
        key: "Enter",
      });

      sampleItems.slice(0, -1).forEach((_, index) => {
        expect(
          screen
            .getByTestId(`breadcrumbs-trail-item-${index}`)
            .querySelector(".MuiTypography-caption")
        ).toBeNull();
      });
    });

    it("hides the back affordance when only a single root item exists", () => {
      const rootOnly: BreadcrumbItem[] = [
        { label: "Projects", isCurrent: true },
      ];

      render(
        <MemoryRouter>
          <Breadcrumbs items={rootOnly} />
        </MemoryRouter>
      );

      expect(screen.queryByTestId("breadcrumbs-back")).toBeNull();
      expect(screen.queryByTestId("breadcrumbs-trail-region")).toBeNull();
      expect(screen.getByTestId("breadcrumbs-current")).toHaveTextContent(
        "Projects"
      );
    });
  });

  describe("entity drag sources", () => {
    it("makes every entity segment draggable on wide viewports while plain crumbs stay static", () => {
      stubMatchMedia(false);

      render(
        <MemoryRouter>
          <Breadcrumbs items={draggableItems} />
        </MemoryRouter>
      );

      // project + initiative compose the pure drag source...
      const dragSources = screen.getAllByTestId("breadcrumb-drag-source");
      const draggedIds = dragSources
        .map((el) => el.getAttribute("data-entity-id"))
        .sort();
      expect(draggedIds).toEqual(["init-1", "proj-1"]);

      // ...the task segment keeps the InteractionComponent drag/menu path...
      expect(screen.getByTestId("interaction-component")).toHaveAttribute(
        "data-entity-id",
        "task-1"
      );

      // ...and the "Projects" fragment (no entity id) is not draggable.
      expect(dragSources).toHaveLength(2);
    });

    it("keeps entity segments draggable in the compact current crumb and disclosed trail", () => {
      stubMatchMedia(true);

      render(
        <MemoryRouter>
          <Breadcrumbs items={draggableItems} />
        </MemoryRouter>
      );

      // Current crumb is the task — draggable via InteractionComponent.
      expect(screen.getByTestId("interaction-component")).toHaveAttribute(
        "data-entity-id",
        "task-1"
      );

      fireEvent.keyDown(screen.getByRole("button", { name: "Task Detail" }), {
        key: "Enter",
      });

      const draggedIds = screen
        .getAllByTestId("breadcrumb-drag-source")
        .map((el) => el.getAttribute("data-entity-id"));
      expect(draggedIds).toEqual(expect.arrayContaining(["proj-1", "init-1"]));
    });
  });
});
