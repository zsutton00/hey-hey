import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FeatureTreeNode } from "@hey-hey/ui-common/data";
import {
  FeaturesTableOfContents,
  type TocEntry,
} from "./FeaturesTableOfContents";

const leaf = (id: string, name: string): FeatureTreeNode =>
  ({ feature: { id, name }, children: [] }) as unknown as FeatureTreeNode;

const root = (
  id: string,
  name: string,
  children: FeatureTreeNode[] = [],
): FeatureTreeNode =>
  ({ feature: { id, name }, children }) as unknown as FeatureTreeNode;

const makeRoots = (): FeatureTreeNode[] => [
  root("f-alpha", "Alpha", [
    leaf("f-alpha-1", "Alpha One"),
    leaf("f-alpha-2", "Alpha Two"),
  ]),
  leaf("f-beta", "Beta"),
];

// A three-level tree used by the deep-nesting and depth-aware search tests.
const makeDeepRoots = (): FeatureTreeNode[] => [
  root("f-alpha", "Alpha", [
    root("f-alpha-1", "Alpha One", [leaf("f-alpha-1-a", "Alpha One A")]),
    leaf("f-alpha-2", "Alpha Two"),
  ]),
  leaf("f-beta", "Beta"),
];

const renderToc = (
  props: Partial<React.ComponentProps<typeof FeaturesTableOfContents>> = {},
): {
  onActivate: ReturnType<typeof vi.fn>;
  onToggleExpand: ReturnType<typeof vi.fn>;
} => {
  const onActivate = vi.fn();
  const onToggleExpand = vi.fn();
  render(
    <FeaturesTableOfContents
      roots={makeRoots()}
      expandedIds={new Set()}
      selectedFeatureId={null}
      onActivate={onActivate}
      onToggleExpand={onToggleExpand}
      {...props}
    />,
  );
  return { onActivate, onToggleExpand };
};

describe("FeaturesTableOfContents", () => {
  it("renders one entry per root feature", () => {
    renderToc();
    expect(
      screen.getByTestId("features-wiki-toc-entry-f-alpha"),
    ).toHaveTextContent("Alpha");
    expect(
      screen.getByTestId("features-wiki-toc-entry-f-beta"),
    ).toHaveTextContent("Beta");
  });

  it("gives root entries distinct typography while preserving nested sizing", () => {
    renderToc({ expandedIds: new Set(["f-alpha"]) });
    const entry = screen.getByTestId("features-wiki-toc-entry-f-alpha");
    const emotionClass = Array.from(entry.classList).find((name) =>
      name.startsWith("css-"),
    );
    const entryStyles = Array.from(document.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .filter((styles) => emotionClass && styles.includes(`.${emotionClass}`))
      .join("\n");
    const label = entry.querySelector(".MuiTypography-root");
    const labelEmotionClass = label
      ? Array.from(label.classList).find((name) => name.startsWith("css-"))
      : undefined;
    const labelStyles = Array.from(document.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .filter(
        (styles) =>
          labelEmotionClass && styles.includes(`.${labelEmotionClass}`),
      )
      .join("\n");
    const nestedLabel = screen
      .getByTestId("features-wiki-toc-entry-f-alpha-1")
      .querySelector(".MuiTypography-root");
    const nestedLabelEmotionClass = nestedLabel
      ? Array.from(nestedLabel.classList).find((name) =>
          name.startsWith("css-"),
        )
      : undefined;
    const nestedLabelStyles = Array.from(document.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .filter(
        (styles) =>
          nestedLabelEmotionClass &&
          styles.includes(`.${nestedLabelEmotionClass}`),
      )
      .join("\n");

    expect(entryStyles).toMatch(/min-height:48px/);
    expect(entryStyles).toMatch(/min-height:auto/);
    expect(labelStyles).toMatch(/font-size:1\.1rem/);
    expect(labelStyles).toMatch(/font-weight:600/);
    expect(nestedLabelStyles).toMatch(/font-size:1rem/);
    expect(nestedLabelStyles).toMatch(/font-weight:400/);
  });

  it("uses a contained panel background and all-sided border", () => {
    renderToc();

    const toc = screen.getByTestId("features-wiki-toc");
    const tocStyle = getComputedStyle(toc);
    expect(tocStyle.borderTopWidth).toBe("1px");
    expect(tocStyle.borderRightWidth).toBe("1px");
    expect(tocStyle.borderBottomWidth).toBe("1px");
    expect(tocStyle.borderLeftWidth).toBe("1px");
    expect(tocStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(tocStyle.borderRadius).not.toBe("0px");
    expect(
      getComputedStyle(screen.getByTestId("features-wiki-toc-entry-f-alpha"))
        .borderLeftWidth,
    ).not.toBe("1px");

    const scrollStyle = getComputedStyle(
      screen.getByTestId("features-wiki-toc-scroll"),
    );
    expect(scrollStyle.paddingTop).toBe("12px");
    expect(scrollStyle.paddingRight).toBe("8px");
  });

  it("hides child entries until their parent is expanded", () => {
    const { rerender } = render(
      <FeaturesTableOfContents
        roots={makeRoots()}
        expandedIds={new Set()}
        selectedFeatureId={null}
        onActivate={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("features-wiki-toc-entry-f-alpha-1"),
    ).not.toBeInTheDocument();

    rerender(
      <FeaturesTableOfContents
        roots={makeRoots()}
        expandedIds={new Set(["f-alpha"])}
        selectedFeatureId={null}
        onActivate={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("features-wiki-toc-entry-f-alpha-1"),
    ).toHaveTextContent("Alpha One");
    expect(
      screen.getByTestId("features-wiki-toc-entry-f-alpha-2"),
    ).toHaveTextContent("Alpha Two");
  });

  it("renders entries at every depth once their ancestors are expanded", () => {
    render(
      <FeaturesTableOfContents
        roots={makeDeepRoots()}
        expandedIds={new Set(["f-alpha", "f-alpha-1"])}
        selectedFeatureId={null}
        onActivate={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    const deepEntry = screen.getByTestId(
      "features-wiki-toc-entry-f-alpha-1-a",
    );
    expect(deepEntry).toHaveTextContent("Alpha One A");
    expect(deepEntry).toHaveAttribute("data-depth", "2");
  });

  it("keeps a depth-2 entry hidden until its non-root parent is expanded", () => {
    const { rerender } = render(
      <FeaturesTableOfContents
        roots={makeDeepRoots()}
        expandedIds={new Set(["f-alpha"])}
        selectedFeatureId={null}
        onActivate={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("features-wiki-toc-entry-f-alpha-1-a"),
    ).not.toBeInTheDocument();

    rerender(
      <FeaturesTableOfContents
        roots={makeDeepRoots()}
        expandedIds={new Set(["f-alpha", "f-alpha-1"])}
        selectedFeatureId={null}
        onActivate={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("features-wiki-toc-entry-f-alpha-1-a"),
    ).toBeInTheDocument();
  });

  it("renders an expand toggle on any entry that has children", () => {
    render(
      <FeaturesTableOfContents
        roots={makeDeepRoots()}
        expandedIds={new Set(["f-alpha"])}
        selectedFeatureId={null}
        onActivate={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    // f-alpha-1 is a non-root feature with children, so it carries a toggle.
    expect(
      screen.getByTestId("features-wiki-toc-toggle-f-alpha-1"),
    ).toBeInTheDocument();
    // f-alpha-2 is a leaf, so it does not.
    expect(
      screen.queryByTestId("features-wiki-toc-toggle-f-alpha-2"),
    ).not.toBeInTheDocument();
  });

  it("renders an empty message when there are no features", () => {
    render(
      <FeaturesTableOfContents
        roots={[]}
        expandedIds={new Set()}
        selectedFeatureId={null}
        onActivate={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("features-wiki-toc-entry-f-alpha"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No features to display.")).toBeInTheDocument();
  });

  it("calls onToggleExpand when an entry's expand toggle is clicked", async () => {
    const { onToggleExpand } = renderToc();
    await userEvent.click(
      screen.getByTestId("features-wiki-toc-toggle-f-alpha"),
    );
    expect(onToggleExpand).toHaveBeenCalledWith("f-alpha");
  });

  it("calls onToggleExpand for a non-root entry's toggle", async () => {
    const onToggleExpand = vi.fn();
    render(
      <FeaturesTableOfContents
        roots={makeDeepRoots()}
        expandedIds={new Set(["f-alpha"])}
        selectedFeatureId={null}
        onActivate={vi.fn()}
        onToggleExpand={onToggleExpand}
      />,
    );
    await userEvent.click(
      screen.getByTestId("features-wiki-toc-toggle-f-alpha-1"),
    );
    expect(onToggleExpand).toHaveBeenCalledWith("f-alpha-1");
  });

  it("calls onActivate with the clicked entry", async () => {
    const { onActivate } = renderToc();
    await userEvent.click(screen.getByTestId("features-wiki-toc-entry-f-beta"));
    expect(onActivate).toHaveBeenCalledTimes(1);
    const entry = onActivate.mock.calls[0][0] as TocEntry;
    expect(entry.node.feature.id).toBe("f-beta");
  });

  it("activates the next visible entry on ArrowDown", async () => {
    const { onActivate } = renderToc();
    screen.getByTestId("features-wiki-toc-entry-f-alpha").focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(onActivate).toHaveBeenCalledTimes(1);
    const entry = onActivate.mock.calls[0][0] as TocEntry;
    expect(entry.node.feature.id).toBe("f-beta");
  });

  it("filters out features whose name and descendants do not match the query", () => {
    renderToc({ searchQuery: "bet" });
    expect(
      screen.queryByTestId("features-wiki-toc-entry-f-alpha"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("features-wiki-toc-entry-f-beta"),
    ).toBeInTheDocument();
  });

  it("reveals a matching feature at any depth and keeps its ancestors as a path", () => {
    render(
      <FeaturesTableOfContents
        roots={makeDeepRoots()}
        expandedIds={new Set()}
        selectedFeatureId={null}
        onActivate={vi.fn()}
        onToggleExpand={vi.fn()}
        searchQuery="Alpha One A"
      />,
    );
    // The deep match shows without any manual expansion...
    expect(
      screen.getByTestId("features-wiki-toc-entry-f-alpha-1-a"),
    ).toBeInTheDocument();
    // ...and its ancestors stay visible as the path to it.
    expect(
      screen.getByTestId("features-wiki-toc-entry-f-alpha"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("features-wiki-toc-entry-f-alpha-1"),
    ).toBeInTheDocument();
    // Non-matching branches are dropped.
    expect(
      screen.queryByTestId("features-wiki-toc-entry-f-alpha-2"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("features-wiki-toc-entry-f-beta"),
    ).not.toBeInTheDocument();
  });

  it("does not render an embedded search input", () => {
    const { rerender } = render(
      <FeaturesTableOfContents
        roots={makeRoots()}
        expandedIds={new Set()}
        selectedFeatureId={null}
        onActivate={vi.fn()}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("features-search-input"),
    ).not.toBeInTheDocument();

    rerender(
      <FeaturesTableOfContents
        roots={makeRoots()}
        expandedIds={new Set()}
        selectedFeatureId={null}
        onActivate={vi.fn()}
        onToggleExpand={vi.fn()}
        searchQuery="alp"
      />,
    );
    expect(
      screen.queryByTestId("features-search-input"),
    ).not.toBeInTheDocument();
  });
});
