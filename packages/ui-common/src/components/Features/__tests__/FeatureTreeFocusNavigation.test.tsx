import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSource, WorkStatus, type TaskResponseDto } from "../../../api";
import { PathServiceProvider } from "../../../contexts";
import type { PathService } from "../../../services/webPathService";
import {
  entityContextClient,
  unifiedApiClient,
} from "../../../clients/serviceClients";
import { FeatureTreeVisualization } from "../FeatureTreeVisualization";
import { referencesResponse } from "./featureTreeReferences";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    getTasks: vi.fn(),
    listWorkItemReferences: vi.fn(),
    updateTask: vi.fn(),
  },
  entityContextClient: {
    getEntityContext: vi.fn(),
  },
}));

const ORG_ID = "org-1";
const PROJ_ID = "proj-1";

const makeFeature = (id: string, parentTaskId?: string): TaskResponseDto => ({
  id,
  name: `Feature ${id}`,
  type: "FEATURE",
  organizationId: ORG_ID,
  projectId: PROJ_ID,
  status: WorkStatus.Backlog,
  source: TaskSource.User,
  parentTaskId,
});

const features = [
  makeFeature("A"),
  makeFeature("B", "A"),
  makeFeature("C", "B"),
];

const pathService: PathService = {
  feature: ({ featureId }: { projectId: string; featureId: string }) =>
    `/features/${featureId}`,
} as PathService;

const rect = (left: number, width: number): DOMRect =>
  ({
    left,
    right: left + width,
    top: 0,
    bottom: 80,
    width,
    height: 80,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);

interface RenderTreeOptions {
  orientation?: "left-to-right" | "top-down";
  activeFeatureId?: string;
  searchQuery?: string;
  focusNavigationEnabled?: boolean;
}

const tree = ({
  orientation,
  activeFeatureId,
  searchQuery = "",
  focusNavigationEnabled = true,
}: RenderTreeOptions): React.ReactElement => (
  <Provider>
    <MemoryRouter>
      <PathServiceProvider pathService={pathService}>
        <FeatureTreeVisualization
          orientation={orientation}
          organizationId={ORG_ID}
          projectId={PROJ_ID}
          activeFeatureId={activeFeatureId}
          searchQuery={searchQuery}
          onSearchChange={vi.fn()}
          focusNavigationEnabled={focusNavigationEnabled}
        />
      </PathServiceProvider>
    </MemoryRouter>
  </Provider>
);

describe("FeatureTreeVisualization focus navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(unifiedApiClient.listWorkItemReferences).mockResolvedValue(
      referencesResponse(features) as never
    );
    vi.mocked(unifiedApiClient.getTasks).mockResolvedValue({
      data: { data: features },
    } as never);
    vi.mocked(unifiedApiClient.updateTask).mockResolvedValue({
      data: { data: {} },
    } as never);
    vi.mocked(entityContextClient.getEntityContext).mockResolvedValue({
      data: { data: { featureHierarchy: [] } },
    } as never);

    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.testid === "feature-tree-scroll-viewport") {
          return rect(100, 400);
        }
        if (this.querySelector('a[href="/features/A"]')) return rect(120, 220);
        if (this.querySelector('a[href="/features/B"]')) return rect(410, 220);
        if (this.querySelector('a[href="/features/C"]')) return rect(700, 220);
        return rect(0, 0);
      }
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.testid === "feature-tree-scroll-viewport" ? 400 : 0;
      },
    );
  });

  it("centers top-down focus on both local axes once", async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.testid === "feature-tree-scroll-viewport")
          return { ...rect(100, 400), top: 100, height: 300 };
        if (this.querySelector('a[href="/features/C"]'))
          return { ...rect(700, 220), top: 800, height: 80 };
        return rect(0, 0);
      },
    );
    const rendered = render(
      tree({ activeFeatureId: "C", orientation: "top-down" }),
    );
    const viewport = await screen.findByTestId("feature-tree-scroll-viewport");
    await waitFor(() => {
      expect(viewport.scrollLeft).toBe(510);
      expect(viewport.scrollTop).toBe(590);
    });
    viewport.scrollTop = 123;
    rendered.rerender(
      tree({
        activeFeatureId: "C",
        orientation: "top-down",
        searchQuery: "Feature",
      }),
    );
    expect(viewport.scrollTop).toBe(123);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("centers the initial active feature instantly in the tree viewport", async () => {
    render(tree({ activeFeatureId: "C" }));

    const viewport = await screen.findByTestId("feature-tree-scroll-viewport");
    await waitFor(() => expect(viewport.scrollLeft).toBe(510));

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("runs once for each explicit active-feature transition", async () => {
    const rendered = render(tree({ activeFeatureId: "A" }));
    const viewport = await screen.findByTestId("feature-tree-scroll-viewport");
    await waitFor(() => expect(viewport.scrollLeft).toBe(0));

    rendered.rerender(tree({ activeFeatureId: "C" }));
    await waitFor(() => expect(viewport.scrollLeft).toBe(510));

    viewport.scrollLeft = 333;
    rendered.rerender(tree({ activeFeatureId: "C", searchQuery: "Feature" }));
    expect(viewport.scrollLeft).toBe(333);
  });

  it("does not pull back manual page or horizontal scrolling on rerender", async () => {
    const rendered = render(tree({ activeFeatureId: "C" }));
    const viewport = await screen.findByTestId("feature-tree-scroll-viewport");
    await waitFor(() => expect(viewport.scrollLeft).toBe(510));

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 640,
    });
    viewport.scrollLeft = 275;

    rendered.rerender(tree({ activeFeatureId: "C", searchQuery: "Feature C" }));

    expect(window.scrollY).toBe(640);
    expect(viewport.scrollLeft).toBe(275);
  });

  it("waits until the instance owns focus navigation", async () => {
    const rendered = render(
      tree({ activeFeatureId: "C", focusNavigationEnabled: false })
    );
    const viewport = await screen.findByTestId("feature-tree-scroll-viewport");
    expect(viewport.scrollLeft).toBe(0);

    await act(async () => {
      rendered.rerender(
        tree({ activeFeatureId: "C", focusNavigationEnabled: true })
      );
    });

    await waitFor(() => expect(viewport.scrollLeft).toBe(510));
  });
});
