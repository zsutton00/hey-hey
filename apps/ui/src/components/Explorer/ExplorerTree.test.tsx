import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  GuidedWalkthroughContext,
  createGuidedWalkthroughRuntime,
} from "@hey-hey/ui-common/components/GuidedWalkthrough/guidedWalkthroughRuntime";
import { GuidedWalkthroughRunner } from "@hey-hey/ui-common/components/GuidedWalkthrough/GuidedWalkthroughRunner";
import { buildGuidedFirstStepsWalkthrough } from "@hey-hey/ui-common/components/Help/buildGuidedFirstStepsWalkthrough";
import { useGuidableTarget } from "@hey-hey/ui-common/components/GuidedWalkthrough/useGuidableTarget";
import { ExplorerTree } from "./ExplorerTree";

const { openPreviewMock } = vi.hoisted(() => ({ openPreviewMock: vi.fn() }));

vi.mock("@hey-hey/ui-common/context", () => ({
  createProjectCollectionPreviewRequest: (collection: string) => ({
    kind: "project_collection",
    collection,
  }),
  usePreviewHost: () => ({ openPreview: openPreviewMock }),
  useTheme: () => ({ mode: "light" }),
}));

vi.mock("@hey-hey/ui-common/i18n", () => ({
  KEYS: {
    explorer: {
      treeAriaLabel: "explorer.treeAriaLabel",
    },
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("./ExplorerTreeNode", () => ({
  ExplorerTreeNode: ({ node }: { node: { id: string; name: string } }) => {
    const ref = React.useRef<HTMLDivElement>(null);
    useGuidableTarget(
      { surface: "explorer-row", entity: { kind: "feature", id: node.id } },
      () => ref.current
    );
    return (
      <div ref={ref} data-testid={`explorer-node-${node.id}`}>
        {node.name}
      </div>
    );
  },
}));

vi.mock("./FeatureChildren", () => ({
  FeatureChildren: () => null,
}));

const LocationProbe: React.FC = () => (
  <div data-testid="location-probe">{useLocation().pathname}</div>
);

describe("ExplorerTree section headers", () => {
  it("links known list sections and leaves sections without a path unlinked", () => {
    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <ExplorerTree
          expandedEntityGroups={new Set()}
          expandedNodes={new Set()}
          isSearching={false}
          nodes={[]}
          onSelectNode={vi.fn()}
          onToggleEntityGroup={vi.fn()}
          onToggleNode={vi.fn()}
          sections={[
            {
              key: "work-item:FEATURE",
              label: "Features",
              path: "/projects/project-1/features",
              previewCollection: "features",
              nodes: [],
            },
            {
              key: "work-item:CUSTOM_DELIVERABLE",
              label: "Deliverables",
              nodes: [],
            },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: "FEATURES (0)" })).toHaveAttribute(
      "href",
      "/projects/project-1/features"
    );

    const featureLabel = screen
      .getByRole("link", { name: "FEATURES (0)" })
      .querySelector(".MuiTypography-root");
    expect(featureLabel).toHaveStyle({ fontSize: "0.875rem" });

    fireEvent.click(screen.getByRole("button", { name: "Preview Features" }));
    expect(openPreviewMock).toHaveBeenCalledWith({
      kind: "project_collection",
      collection: "features",
    });

    const customLabel = screen.getByText("DELIVERABLES (0)");
    expect(customLabel.closest("a")).toBeNull();

    fireEvent.click(customLabel);
    expect(screen.getByText("DELIVERABLES (0)")).toBeInTheDocument();
  });

  it("navigates to a custom type's collection route from its section title without a preview action", () => {
    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <ExplorerTree
          expandedEntityGroups={new Set()}
          expandedNodes={new Set()}
          isSearching={false}
          nodes={[]}
          onSelectNode={vi.fn()}
          onToggleEntityGroup={vi.fn()}
          onToggleNode={vi.fn()}
          sections={[
            {
              key: "work-item:CUSTOM_DELIVERABLE",
              label: "Deliverables",
              path: "/projects/project-1/collections/CUSTOM_DELIVERABLE",
              nodes: [],
            },
          ]}
        />
        <LocationProbe />
      </MemoryRouter>
    );

    const title = screen.getByRole("link", { name: "DELIVERABLES (0)" });
    expect(title).toHaveAttribute(
      "href",
      "/projects/project-1/collections/CUSTOM_DELIVERABLE"
    );
    expect(
      screen.queryByRole("button", { name: "Preview Deliverables" })
    ).not.toBeInTheDocument();

    fireEvent.click(title);

    expect(screen.getByTestId("location-probe")).toHaveTextContent(
      "/projects/project-1/collections/CUSTOM_DELIVERABLE"
    );
  });

  it("keeps every section visible and expanded while rendering filtered rows by section", () => {
    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <ExplorerTree
          expandedEntityGroups={new Set()}
          expandedNodes={new Set()}
          isSearching
          nodes={[
            {
              id: "feature-match",
              name: "Matching feature",
              sectionKey: "work-item:FEATURE",
              type: "feature",
              hasChildren: false,
              depth: 0,
            },
            {
              id: "service-match",
              name: "Matching service",
              sectionKey: "services",
              type: "service",
              hasChildren: false,
              depth: 0,
            },
          ]}
          onSelectNode={vi.fn()}
          onToggleEntityGroup={vi.fn()}
          onToggleNode={vi.fn()}
          sections={[
            {
              key: "work-item:FEATURE",
              label: "Features",
              count: 1,
              nodes: [
                {
                  id: "feature-match",
                  name: "Matching feature",
                  sectionKey: "work-item:FEATURE",
                  type: "feature",
                  hasChildren: false,
                  depth: 0,
                },
              ],
            },
            {
              key: "work-item:PLAN",
              label: "Plans",
              count: 0,
              nodes: [],
            },
            {
              key: "services",
              label: "Services",
              count: 1,
              nodes: [
                {
                  id: "service-match",
                  name: "Matching service",
                  sectionKey: "services",
                  type: "service",
                  hasChildren: false,
                  depth: 0,
                },
              ],
            },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("FEATURES (1)")).toBeInTheDocument();
    expect(screen.getByText("PLANS (0)")).toBeInTheDocument();
    expect(screen.getByText("SERVICES (1)")).toBeInTheDocument();
    expect(
      screen.getByTestId("explorer-node-feature-match")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("explorer-node-service-match")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse features" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse plans" })
    ).toBeInTheDocument();
  });
});

describe("Explorer walkthrough disclosure wiring", () => {
  it.each([false, true])(
    "uses the live toggle and expansion completion when initially expanded is %s",
    async (initiallyExpanded) => {
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect"
      ).mockImplementation(() => new DOMRect(20, 20, 100, 30));
      Element.prototype.scrollIntoView = vi.fn();
      const runtime = createGuidedWalkthroughRuntime();
      const runner = new GuidedWalkthroughRunner(runtime);
      const node = {
        id: "billing",
        name: "Billing",
        sectionKey: "work-item:FEATURE",
        type: "feature" as const,
        depth: 0,
        hasChildren: false,
      };
      function Workspace() {
        const [expanded, setExpanded] = React.useState(initiallyExpanded);
        return (
          <ExplorerTree
            projectId="project-1"
            expandedEntityGroups={
              new Set(expanded ? ["work-item:FEATURE"] : [])
            }
            expandedNodes={new Set()}
            isSearching={false}
            nodes={[node]}
            onSelectNode={vi.fn()}
            onToggleNode={vi.fn()}
            onToggleEntityGroup={() => setExpanded((value) => !value)}
            sections={[
              { key: "work-item:FEATURE", label: "Features", nodes: [node] },
            ]}
          />
        );
      }
      const mounted = render(
        <MemoryRouter>
          <GuidedWalkthroughContext.Provider value={runtime}>
            <Workspace />
          </GuidedWalkthroughContext.Provider>
        </MemoryRouter>
      );
      try {
        act(() =>
          runner.start(
            buildGuidedFirstStepsWalkthrough({
              feature: {
                id: "billing",
                name: "Billing",
                href: "/features/billing",
              },
              kind: "TASKS",
              rationale: "Start here",
              starterPrompt: "Plan Billing",
            })
          )
        );
        if (!initiallyExpanded) {
          const toggle = screen.getByRole("button", {
            name: "Expand features",
          });
          expect(
            (() => {
              const view = runner.getView();
              return view.status === "active" ? view.stepNumber : null;
            })()
          ).toBe(1);
          const view = runner.getView();
          expect(view.status === "active" ? view.target : null).toBe(toggle);
          expect(
            runtime.targets.lookup({
              surface: "explorer-row",
              entity: { kind: "feature", id: "billing" },
            })
          ).not.toBeNull();
          fireEvent.click(toggle);
          // Committed expansion state alone cannot finish the action.
          expect(runtime.explorerSections.current("work-item:FEATURE")).toBe(
            true
          );
          expect(
            (() => {
              const view = runner.getView();
              return view.status === "active" ? view.stepNumber : null;
            })()
          ).toBe(1);
        }
        await waitFor(() => {
          const view = runner.getView();
          expect(view.status === "active" && view.stepNumber).toBe(2);
          expect(view.status === "active" ? view.target : null).toBe(
            screen.getByTestId("explorer-node-billing")
          );
        });
        act(() =>
          runtime.events.emit({
            type: "canonical-page-shown",
            entity: { kind: "feature", id: "billing" },
          })
        );
        const afterNavigation = runner.getView();
        expect(
          afterNavigation.status === "active" && afterNavigation.stepNumber
        ).toBe(3);
      } finally {
        runner.dispose();
        mounted.unmount();
        vi.restoreAllMocks();
      }
      expect(runtime.explorerSections.current("work-item:FEATURE")).toBeNull();
      expect(
        runtime.targets.lookup({
          name: "explorer-section-toggle",
          sectionKey: "work-item:FEATURE",
        })
      ).toBeNull();
    }
  );
});
