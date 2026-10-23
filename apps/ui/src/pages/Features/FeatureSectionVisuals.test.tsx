import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FeatureSectionVisuals } from "./FeatureSectionVisuals";

const { childrenQuery, contextQuery } = vi.hoisted(() => ({
  childrenQuery: vi.fn(),
  contextQuery: vi.fn(),
}));
vi.mock("@hey-hey/ui-common/data", () => ({
  useWorkItems: childrenQuery,
  useFullEntityContext: contextQuery,
}));
vi.mock("@hey-hey/ui-common/components", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/components")>()),
  VisualArtifactCard: ({ artifact }: { artifact: { entityId: string; displayName: string } }) => (
    <div data-testid={`artifact-${artifact.entityId}`}>{artifact.displayName}</div>
  ),
}));

let intersect: (near: boolean) => void;
let options: IntersectionObserverInit | undefined;
const disconnect = vi.fn();
class Observer {
  constructor(callback: IntersectionObserverCallback, init?: IntersectionObserverInit) {
    options = init;
    intersect = (isIntersecting) => callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  observe() {}
  disconnect = disconnect;
}

const section = (featureId: string, suspended: boolean) => (
  <div data-testid="features-wiki-document-panel">
    <FeatureSectionVisuals organizationId="org" projectId="project" featureId={featureId} suspended={suspended} />
  </div>
);
const renderSection = (featureId = "feature", suspended = false) => render(section(featureId, suspended));
const near = () => act(() => intersect(true));

describe("FeatureSectionVisuals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IntersectionObserver", Observer);
    childrenQuery.mockReturnValue({ workItems: [] });
    contextQuery.mockReturnValue({ data: { relatedEntities: [] } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mounts no query hooks until near, then runs all four type-filtered, direct-neighbor queries", () => {
    renderSection();
    expect(options).toEqual({
      root: screen.getByTestId("features-wiki-document-panel"),
      rootMargin: "240px 0px",
    });
    act(() => intersect(false));
    expect(childrenQuery).not.toHaveBeenCalled();
    expect(screen.getByTestId("feature-section-visuals-anchor-feature")).toBeEmptyDOMElement();
    near();
    const queryOptions = childrenQuery.mock.calls.slice(-4).map((call) => call[4]);
    expect(queryOptions.slice(0, 2)).toEqual([
      { parentTaskId: "feature", taskType: "mockup", includeEdges: false, enabled: true },
      { parentTaskId: "feature", taskType: "DIAGRAM", includeEdges: false, enabled: true },
    ]);
    expect(queryOptions.slice(2).map((query) => query.taskType)).toEqual(["mockup", "DIAGRAM"]);
    for (const query of queryOptions.slice(2)) {
      expect(query).toMatchObject({ relatedEntityId: "feature", relatedEntityType: "TASK", enabled: true, includeEdges: false });
      expect(query.parentTaskId).toBeUndefined();
      expect(query.includeDescendants).toBeUndefined();
      expect(query.edgeTypes).toContain("RELATED_TO");
      expect(query.edgeTypes).toContain("PROPOSED_TOGETHER");
      expect(query.edgeTypes).not.toContain("STANDARD");
      expect(query.edgeTypes).not.toContain("CONDITIONAL");
      expect(query.edgeTypes).not.toContain("LOOP");
    }
    expect(contextQuery).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
    expect(screen.queryByTestId("feature-section-visuals-feature")).toBeNull();
  });

  it("selects only direct visual children first, then unique linked visuals", () => {
    childrenQuery.mockImplementation((_org, _entityType, _project, _unused, query) => ({
      workItems: query.relatedEntityId
        ? query.taskType === "mockup"
          ? [{ id: "mockup", type: "mockup", name: "Duplicate linked name" }, { id: "linked", type: "mockup", name: "Linked mockup" }]
          : [{ id: "linked-diagram", type: "DIAGRAM", name: "Linked diagram" }, { id: "task", type: "STANDARD", name: "Task" }]
        : query.taskType === "mockup"
          ? [{ id: "mockup", type: "mockup", name: "Mockup", parentTaskId: "feature" }, { id: "descendant", type: "mockup", name: "Descendant", parentTaskId: "nested" }]
          : [{ id: "diagram", type: "DIAGRAM", name: "Diagram", parentTaskId: "feature" }],
    }));
    renderSection();
    near();
    const grid = screen.getByTestId("feature-section-visuals-feature");
    expect(Array.from(grid.children).map((el) => el.textContent)).toEqual(["Mockup", "Diagram", "Linked mockup", "Linked diagram"]);
    expect(grid).toHaveStyle({ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "16px" });
    expect(screen.queryByText("Descendant")).toBeNull();
  });

  it("keeps separate section requests scoped to their own feature", () => {
    const first = renderSection("first");
    near();
    expect(childrenQuery.mock.calls.slice(-4).every((call) => (call[4].parentTaskId ?? call[4].relatedEntityId) === "first")).toBe(true);
    first.unmount();
    childrenQuery.mockClear();
    renderSection("nested");
    expect(childrenQuery).not.toHaveBeenCalled();
    near();
    expect(childrenQuery.mock.calls.slice(-4).every((call) => (call[4].parentTaskId ?? call[4].relatedEntityId) === "nested")).toBe(true);
    expect(contextQuery).not.toHaveBeenCalled();
  });

  it("never mounts queries while the Document is positioning, then loads once it settles", () => {
    const view = renderSection("feature", true);
    near();
    expect(childrenQuery).not.toHaveBeenCalled();
    view.rerender(section("feature", false));
    expect(childrenQuery.mock.calls.slice(-4).every((call) => call[4].enabled)).toBe(true);
    view.rerender(section("feature", true));
    expect(childrenQuery.mock.lastCall?.[4].enabled).toBe(true);
  });
});
