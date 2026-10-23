import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryState: Record<string, string | null> = {
  feature: null,
};
const setQueryMock = vi.fn();

vi.mock("nuqs", () => ({
  parseAsString: { __id: "string" },
  useQueryState: (key: string) => {
    const value = queryState[key];
    return [
      value,
      (next: string | null) => {
        queryState[key] = next;
        setQueryMock(key, next);
      },
    ];
  },
}));

interface MockFeatureNode {
  feature: { id: string; name: string };
  children: MockFeatureNode[];
}

const useFeatureTreeMock = vi.fn();

vi.mock("@hey-hey/ui-common/data", () => ({
  useFeatureTreePageData: (...args: unknown[]) => useFeatureTreeMock(...args),
}));

// FeatureTreeVisualization is lazy-loaded; the mock records the activeFeatureId
// prop as a data attribute so tests can assert the TOC selection reached it.
vi.mock("@hey-hey/ui-common/feature-tree-visualization", () => ({
  default: ({ activeFeatureId }: { activeFeatureId?: string }) => (
    <div
      data-testid="feature-tree-visualization"
      data-active-feature-id={activeFeatureId ?? ""}
    >
      tree
    </div>
  ),
}));

import { FeaturesTreeView } from "./FeaturesTreeView";

const leaf = (id: string, name: string): MockFeatureNode => ({
  feature: { id, name },
  children: [],
});

const makeRoots = (): MockFeatureNode[] => [
  {
    feature: { id: "f-alpha", name: "Alpha" },
    children: [leaf("f-alpha-1", "Alpha One")],
  },
  leaf("f-beta", "Beta"),
];

const renderTreeView = (
  props: Partial<React.ComponentProps<typeof FeaturesTreeView>> = {},
): ReturnType<typeof render> =>
  render(
    <FeaturesTreeView
      organizationId="org-1"
      projectId="project-1"
      {...props}
    />,
  );

describe("FeaturesTreeView", () => {
  beforeEach(() => {
    queryState.feature = null;
    setQueryMock.mockClear();
    useFeatureTreeMock.mockReset();
    useFeatureTreeMock.mockReturnValue({
      roots: makeRoots(),
      isLoading: false,
    });
  });

  it("renders the table of contents alongside the feature tree", async () => {
    renderTreeView();
    expect(screen.getByTestId("features-wiki-toc")).toBeInTheDocument();
    expect(
      screen.getByTestId("features-wiki-toc-entry-f-alpha"),
    ).toHaveTextContent("Alpha");
    expect(
      await screen.findByTestId("feature-tree-visualization"),
    ).toBeInTheDocument();
  });

  it("renders a loading spinner while the feature tree is loading", () => {
    useFeatureTreeMock.mockReturnValue({ roots: [], isLoading: true });
    renderTreeView();
    expect(
      screen.queryByTestId("features-wiki-toc-entry-f-alpha"),
    ).not.toBeInTheDocument();
  });

  it("passes the selected feature id to the tree as activeFeatureId", async () => {
    const { rerender } = renderTreeView();
    expect(
      await screen.findByTestId("feature-tree-visualization"),
    ).toHaveAttribute("data-active-feature-id", "");

    await userEvent.click(screen.getByTestId("features-wiki-toc-entry-f-beta"));
    expect(setQueryMock).toHaveBeenCalledWith("feature", "f-beta");

    queryState.feature = "f-beta";
    rerender(<FeaturesTreeView organizationId="org-1" projectId="project-1" />);

    expect(
      await screen.findByTestId("feature-tree-visualization"),
    ).toHaveAttribute("data-active-feature-id", "f-beta");
  });

  it("activates a sub-feature entry by writing its id to the URL", async () => {
    renderTreeView();
    await userEvent.click(
      screen.getByTestId("features-wiki-toc-toggle-f-alpha"),
    );
    await userEvent.click(
      screen.getByTestId("features-wiki-toc-entry-f-alpha-1"),
    );
    expect(setQueryMock).toHaveBeenCalledWith("feature", "f-alpha-1");
  });

  it("activates a deeply nested entry by writing its id to the URL", async () => {
    useFeatureTreeMock.mockReturnValue({
      roots: [
        {
          feature: { id: "f-alpha", name: "Alpha" },
          children: [
            {
              feature: { id: "f-alpha-1", name: "Alpha One" },
              children: [leaf("f-alpha-1-a", "Alpha One A")],
            },
          ],
        },
      ],
      isLoading: false,
    });
    renderTreeView();

    await userEvent.click(
      screen.getByTestId("features-wiki-toc-toggle-f-alpha"),
    );
    await userEvent.click(
      screen.getByTestId("features-wiki-toc-toggle-f-alpha-1"),
    );
    await userEvent.click(
      screen.getByTestId("features-wiki-toc-entry-f-alpha-1-a"),
    );
    expect(setQueryMock).toHaveBeenCalledWith("feature", "f-alpha-1-a");
  });
});
