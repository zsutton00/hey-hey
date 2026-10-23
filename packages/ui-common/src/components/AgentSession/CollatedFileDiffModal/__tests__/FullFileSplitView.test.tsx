import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DIFF_PRESENTATION_MODES,
  FullFileSplitView,
} from "../FullFileSplitView";
import type { LocatedDecision } from "../locatedDecisions";
import { installDiffViewerLayoutShims } from "./diffViewerLayoutShims";

// MUI's `sx` compiles to emotion class rules, so the dynamic height /
// transform values land on the CSSOM rather than the `style` attribute. jsdom
// resolves them through `getComputedStyle`, which is what the helpers below
// rely on to read the virtualizer's per-row offsets and the pane's reserved
// height.
const parseTranslateYPx = (transform: string): number => {
  const match = /translateY\(([-\d.]+)px\)/.exec(transform);
  if (!match) {
    throw new Error(`Could not parse translateY from "${transform}"`);
  }
  return Number(match[1]);
};

const getRowWrapper = (
  paneTestId: string,
  rowIndex: number,
  pane: "old" | "new",
): HTMLElement => {
  const paneEl = screen.getByTestId(paneTestId);
  const node = paneEl.querySelector<HTMLElement>(
    `[data-index="${String(rowIndex)}"][data-pane="${pane}"]`,
  );
  if (!node) {
    throw new Error(
      `Row wrapper for index ${String(rowIndex)} / pane ${pane} not found`,
    );
  }
  return node;
};

const getRowTranslateY = (
  paneTestId: string,
  rowIndex: number,
  pane: "old" | "new",
): number => {
  const node = getRowWrapper(paneTestId, rowIndex, pane);
  return parseTranslateYPx(window.getComputedStyle(node).transform);
};

const parsePx = (value: string): number => {
  const match = /([\d.]+)px/.exec(value);
  if (!match) {
    throw new Error(`Could not parse pixels from "${value}"`);
  }
  return Number(match[1]);
};

const getPaneHeightPx = (paneTestId: string): number => {
  const paneEl = screen.getByTestId(paneTestId);
  return parsePx(window.getComputedStyle(paneEl).height);
};

// A short file with three changed rows is enough to exercise the union and
// alignment paths without filling the viewport. Each row is a replace, so both
// panes mount a wrapper at every index.
const PRE_CONTENT = "alpha-old\nbeta-old\ngamma-old\n";
const POST_CONTENT = "alpha-new\nbeta-new\ngamma-new\n";

describe("FullFileSplitView variable-height rows", () => {
  let layoutShims: ReturnType<typeof installDiffViewerLayoutShims>;

  beforeEach(() => {
    layoutShims = installDiffViewerLayoutShims();
  });

  afterEach(() => {
    layoutShims.restore();
  });

  it("reserves a left line's settled wrapped height on the initial constrained-width layout", () => {
    const wrappedBeforeLine =
      "const constrainedWidthValue = buildAValueThatMustWrapAcrossSeveralVisualLines();";
    const preContent = `${wrappedBeforeLine}\nnext-line\n`;
    const postContent = "short-value\nnext-line\n";

    // The first left-side ref measurement sees the pre-layout single-line
    // height. Once both grid panes are committed at their constrained widths,
    // the same content occupies three visual lines. The initial layout pass
    // must read that settled height without waiting for a resize event.
    layoutShims.setRowHeights({
      0: { old: [20, 60], new: 20 },
      1: { old: 20, new: 20 },
    });

    render(
      <div style={{ width: 360, height: 200 }}>
        <FullFileSplitView
        presentationMode={DIFF_PRESENTATION_MODES.sideBySide}
          preContent={preContent}
          postContent={postContent}
          filePath="src/sample.ts"
        />
      </div>,
    );

    const wrappedRow = getRowWrapper("full-file-split-pane-old", 0, "old");
    expect(wrappedRow).toHaveTextContent(wrappedBeforeLine);
    const codeRow = wrappedRow.querySelector("code");
    expect(codeRow).not.toBeNull();
    expect(codeRow?.children[0]).toHaveTextContent("1");
    expect(codeRow?.children).toHaveLength(3);

    const row0Top = getRowTranslateY("full-file-split-pane-old", 0, "old");
    const row1Top = getRowTranslateY("full-file-split-pane-old", 1, "old");
    expect(row1Top - row0Top).toBe(60);
  });

  it("reserves the per-row height union when one pane is taller than the other", () => {
    // Row 1's After side is 80px (a wrapped long line); the Before side stays
    // at a single line. The pane must reserve the union (80px) for row 1, and
    // the rows above and below must stay at the heights they were given.
    layoutShims.setRowHeights({
      0: { old: 20, new: 20 },
      1: { old: 20, new: 80 },
      2: { old: 20, new: 20 },
    });

    render(
      <FullFileSplitView
        presentationMode={DIFF_PRESENTATION_MODES.sideBySide}
        preContent={PRE_CONTENT}
        postContent={POST_CONTENT}
        filePath="src/sample.ts"
      />,
    );

    // totalSize = row0 + row1 + row2 = 20 + 80 + 20 = 120 (the After-side 80
    // wins for row 1 because both panes share the same per-index measurement).
    expect(getPaneHeightPx("full-file-split-pane-old")).toBe(120);
    expect(getPaneHeightPx("full-file-split-pane-new")).toBe(120);
  });

  it("keeps Before and After panes aligned when a row's two sides differ in height", () => {
    layoutShims.setRowHeights({
      0: { old: 20, new: 20 },
      1: { old: 20, new: 80 },
      2: { old: 20, new: 20 },
    });

    render(
      <FullFileSplitView
        presentationMode={DIFF_PRESENTATION_MODES.sideBySide}
        preContent={PRE_CONTENT}
        postContent={POST_CONTENT}
        filePath="src/sample.ts"
      />,
    );

    // The two panes' row wrappers at each index must sit at the same vertical
    // offset. Both consume the same virtualItems slice, so any drift would
    // mean the union isn't being applied consistently across the panes.
    for (const rowIndex of [0, 1, 2]) {
      const oldTop = getRowTranslateY(
        "full-file-split-pane-old",
        rowIndex,
        "old",
      );
      const newTop = getRowTranslateY(
        "full-file-split-pane-new",
        rowIndex,
        "new",
      );
      expect(oldTop).toBe(newTop);
    }

    // Row 2 must start past row 1's taller (80px) side, not its shorter (20px)
    // side, so the wrapped line on the After pane doesn't collide with the
    // next row's content.
    const row1Top = getRowTranslateY("full-file-split-pane-new", 1, "new");
    const row2Top = getRowTranslateY("full-file-split-pane-new", 2, "new");
    expect(row2Top - row1Top).toBe(80);
  });

  it("re-measures rows after a width-driven re-wrap fires the ResizeObserver", () => {
    // Start with every row a single line tall.
    layoutShims.setRowHeights({
      0: { old: 20, new: 20 },
      1: { old: 20, new: 20 },
      2: { old: 20, new: 20 },
    });

    render(
      <FullFileSplitView
        presentationMode={DIFF_PRESENTATION_MODES.sideBySide}
        preContent={PRE_CONTENT}
        postContent={POST_CONTENT}
        filePath="src/sample.ts"
      />,
    );

    expect(getPaneHeightPx("full-file-split-pane-new")).toBe(60);

    // Simulate the pane narrowing: row 1's After side wraps to 80px. Update
    // the height table and fire the ResizeObserver entries the virtualizer is
    // subscribed to. The next measure pass picks up the new heights and grows
    // the reserved band.
    layoutShims.setRowHeights({
      0: { old: 20, new: 20 },
      1: { old: 20, new: 80 },
      2: { old: 20, new: 20 },
    });
    act(() => {
      layoutShims.triggerResizeAll();
    });

    expect(getPaneHeightPx("full-file-split-pane-new")).toBe(120);
    expect(getPaneHeightPx("full-file-split-pane-old")).toBe(120);
  });

  it("includes the annotation slot in the reserved band when a row carries one", () => {
    // Row 0 carries an annotation that the After-side wrapper renders inline.
    // The Before-side wrapper renders a same-height hidden spacer, so the
    // measured heights here cover wrapper + annotation slot together.
    const annotations: LocatedDecision[] = [
      {
        topic: "Annotated row",
        choice: "Carries an inline decision",
        location: { file: "src/sample.ts", startLine: 1 },
      },
    ];

    layoutShims.setRowHeights({
      0: { old: 60, new: 60 },
      1: { old: 20, new: 20 },
      2: { old: 20, new: 20 },
    });

    render(
      <FullFileSplitView
        presentationMode={DIFF_PRESENTATION_MODES.sideBySide}
        preContent={PRE_CONTENT}
        postContent={POST_CONTENT}
        filePath="src/sample.ts"
        annotations={annotations}
      />,
    );

    // The annotation slot mounts on the After side at row 0; the union pushes
    // row 1 down by the full annotated row height.
    const newPane = screen.getByTestId("full-file-split-pane-new");
    expect(
      within(newPane).getByTestId("full-file-split-annotations-row-0"),
    ).toBeInTheDocument();

    expect(getRowTranslateY("full-file-split-pane-new", 1, "new")).toBe(60);
    expect(getPaneHeightPx("full-file-split-pane-new")).toBe(100);
  });

  it("only mounts the annotation slot when the anchor row enters the windowed slice", () => {
    // 300 lines of context with a single replace at the top. With the shimmed
    // 800px viewport and ~19.2px per estimated row, the initial windowed slice
    // (rows 0..~58 with overscan 16) sits well above the annotation anchor at
    // line 250, so neither the row wrapper nor the annotation slot mounts at
    // open. Scrolling brings the anchor into the windowed band and the slot
    // co-mounts because it lives inside the windowed row wrapper.
    const totalLines = 300;
    const annotationLine = 250;
    const anchorRowIndex = annotationLine - 1;

    const preLines: string[] = ["old-line-1"];
    const postLines: string[] = ["new-line-1"];
    for (let i = 2; i <= totalLines; i += 1) {
      preLines.push(`context-line-${String(i)}`);
      postLines.push(`context-line-${String(i)}`);
    }
    const preContent = `${preLines.join("\n")}\n`;
    const postContent = `${postLines.join("\n")}\n`;

    const annotations: LocatedDecision[] = [
      {
        topic: "Offscreen annotation",
        choice: "Anchored at line 250",
        location: { file: "src/sample.ts", startLine: annotationLine },
      },
    ];

    // Seed a real measured height for the anchor row so its measure pass after
    // mount reserves a band that includes the annotation slot, not just a
    // zero-height shimmed default.
    layoutShims.setRowHeights({
      [anchorRowIndex]: { old: 60, new: 60 },
    });

    render(
      <FullFileSplitView
        presentationMode={DIFF_PRESENTATION_MODES.sideBySide}
        preContent={preContent}
        postContent={postContent}
        filePath="src/sample.ts"
        annotations={annotations}
      />,
    );

    // Initial render: the anchor row sits below the windowed band, so its
    // wrapper has not mounted on either pane and the annotation slot is absent.
    expect(
      screen.queryByTestId(
        `full-file-split-annotations-row-${String(anchorRowIndex)}`,
      ),
    ).toBeNull();
    expect(
      screen
        .getByTestId("full-file-split-pane-new")
        .querySelector(`[data-index="${String(anchorRowIndex)}"]`),
    ).toBeNull();

    // Drive the shared scroll container's scrollTop past the anchor row and
    // fire the scroll event the same way @tanstack/react-virtual's listener
    // is wired: the handler reads scrollTop and recomputes the windowed range.
    // 4800px ≈ row 250 at the ~19.2px estimate, which puts the anchor inside
    // the windowed slice plus overscan.
    const scrollEl = screen.getByTestId("full-file-split-view-scroll");
    act(() => {
      scrollEl.scrollTop = 4800;
      scrollEl.dispatchEvent(new Event("scroll"));
    });

    // The After-pane wrapper mounts at the anchor index and carries both the
    // row-level annotation testId and the per-decision testId.
    const newPane = screen.getByTestId("full-file-split-pane-new");
    expect(
      within(newPane).getByTestId(
        `full-file-split-annotations-row-${String(anchorRowIndex)}`,
      ),
    ).toBeInTheDocument();
    expect(
      within(newPane).getByTestId(
        `diff-decision-annotation-${String(anchorRowIndex)}-0`,
      ),
    ).toBeInTheDocument();

    // The Before pane mounts a sibling wrapper at the same data-index, but the
    // slot inside it is the aria-hidden spacer with no test hooks of its own.
    const oldPane = screen.getByTestId("full-file-split-pane-old");
    const beforeWrapper = oldPane.querySelector(
      `[data-index="${String(anchorRowIndex)}"][data-pane="old"]`,
    );
    expect(beforeWrapper).not.toBeNull();
    expect(
      within(oldPane).queryByTestId(
        `full-file-split-annotations-row-${String(anchorRowIndex)}`,
      ),
    ).toBeNull();
    expect(
      within(oldPane).queryByTestId(
        `diff-decision-annotation-${String(anchorRowIndex)}-0`,
      ),
    ).toBeNull();
  });

  it("re-windows, re-anchors annotations and ruler when hide-comments toggles on a virtualized file", () => {
    // A TypeScript file with two `//` comment rows interleaved with three
    // non-comment rows, two of which change. Toggling hide-comments drops the
    // two comment rows, which shifts every surviving row's index down — the
    // first change moves from index 1 to index 0, and the second from index 4
    // to index 2. The annotation is anchored to the first change by line
    // number, so it must follow the same shift.
    const preContent = "// header\nalpha-old\nbeta\n// middle\ngamma-old\n";
    const postContent = "// header\nalpha-new\nbeta\n// middle\ngamma-new\n";

    const annotations: LocatedDecision[] = [
      {
        topic: "Anchored on alpha",
        choice: "Carries an inline decision",
        // Matches the new-side line number of the alpha replace row.
        location: { file: "src/sample.ts", startLine: 2 },
      },
    ];

    // Seed measured heights against the unfiltered indices: the two comment
    // rows are tall (60px) and the three real rows are short (20px). If the
    // virtualizer's per-index size cache were not invalidated on toggle, the
    // 60px measurements at indices 0 and 1 of the pre-toggle layout (the
    // header comment and the alpha replace) would be reused for indices 0
    // and 1 of the post-toggle layout — yielding a post-toggle total of
    // 60 + 20 + 20 = 100, which the assertion below rules out.
    layoutShims.setRowHeights({
      0: { old: 60, new: 60 },
      1: { old: 20, new: 20 },
      2: { old: 20, new: 20 },
      3: { old: 60, new: 60 },
      4: { old: 20, new: 20 },
    });

    const { rerender } = render(
      <FullFileSplitView
        presentationMode={DIFF_PRESENTATION_MODES.sideBySide}
        preContent={preContent}
        postContent={postContent}
        filePath="src/sample.ts"
        hideComments={false}
        annotations={annotations}
      />,
    );

    // Unfiltered baseline: five rows, total height is the per-index union
    // (60 + 20 + 20 + 60 + 20 = 180), the annotation sits on the After pane at
    // row index 1, and the first ruler segment points at index 1.
    expect(getPaneHeightPx("full-file-split-pane-new")).toBe(180);
    const newPaneBefore = screen.getByTestId("full-file-split-pane-new");
    expect(
      within(newPaneBefore).getByTestId("full-file-split-annotations-row-1"),
    ).toBeInTheDocument();
    const rulerBefore = screen.getByTestId("full-file-split-overview-ruler");
    const firstSegmentBefore = within(rulerBefore).getByTestId(
      "full-file-split-overview-ruler-segment-0",
    );
    expect(firstSegmentBefore.dataset.startIndex).toBe("1");

    // Re-key the seeded heights against the post-toggle indices: alpha moves
    // to index 0, beta to index 1, gamma to index 2. All short (20px). These
    // are what the new wrappers would measure to if their ResizeObservers
    // re-fire post-toggle.
    layoutShims.setRowHeights({
      0: { old: 20, new: 20 },
      1: { old: 20, new: 20 },
      2: { old: 20, new: 20 },
    });

    rerender(
      <FullFileSplitView
        presentationMode={DIFF_PRESENTATION_MODES.sideBySide}
        preContent={preContent}
        postContent={postContent}
        filePath="src/sample.ts"
        hideComments={true}
        annotations={annotations}
      />,
    );

    // The post-toggle pane reflects the smaller filtered row set without
    // carrying stale measurements forward. In a browser the new wrappers'
    // ResizeObservers re-fire and the union settles at the filtered sum
    // (3 × 20 = 60); in jsdom the controllable observer doesn't auto-fire,
    // so the virtualizer falls back to its per-row estimate after
    // rowVirtualizer.measure() runs in the cache-clear effect. Strictly less
    // than 100 — the worst-case "stale" outcome where indices 0/1/2 reuse
    // pre-toggle sizes (60 + 20 + 20) — distinguishes both correct paths from
    // a regression that skips the invalidation.
    expect(getPaneHeightPx("full-file-split-pane-new")).toBeLessThan(100);
    expect(getPaneHeightPx("full-file-split-pane-old")).toBeLessThan(100);

    // The annotation re-anchors to filtered row 0 (alpha) — the unfiltered
    // row-1 testId must be gone and the row-0 testId must be present.
    const newPaneAfter = screen.getByTestId("full-file-split-pane-new");
    expect(
      within(newPaneAfter).queryByTestId("full-file-split-annotations-row-1"),
    ).toBeNull();
    expect(
      within(newPaneAfter).getByTestId("full-file-split-annotations-row-0"),
    ).toBeInTheDocument();

    // The overview ruler reflects the filtered row set: the first segment now
    // anchors at filtered index 0, and a second segment exists at filtered
    // index 2 (gamma). The unfiltered indices 1 and 4 must no longer appear.
    const rulerAfter = screen.getByTestId("full-file-split-overview-ruler");
    const segmentsAfter = within(rulerAfter).getAllByTestId(
      /full-file-split-overview-ruler-segment-\d+$/,
    );
    const startIndicesAfter = segmentsAfter
      .map((el) => el.dataset.startIndex)
      .sort();
    expect(startIndicesAfter).toEqual(["0", "2"]);
  });

  it("anchors a non-matching annotation at the first-changed row under virtualization", () => {
    // Two context rows, then a replace at row index 2 (newLineNumber=3), then
    // more context. The first-change row sits inside the initial windowed
    // slice, so the fallback path can be exercised without scrolling.
    const preContent =
      "context-1\ncontext-2\nold-line-3\ncontext-4\ncontext-5\n";
    const postContent =
      "context-1\ncontext-2\nnew-line-3\ncontext-4\ncontext-5\n";
    const firstChangeRowIndex = 2;

    // The annotation's startLine matches no row in the file, so it falls back
    // to the first-changed row index.
    const annotations: LocatedDecision[] = [
      {
        topic: "Unanchored annotation",
        choice: "Falls back to first change",
        location: { file: "src/sample.ts", startLine: 9999 },
      },
    ];

    render(
      <FullFileSplitView
        presentationMode={DIFF_PRESENTATION_MODES.sideBySide}
        preContent={preContent}
        postContent={postContent}
        filePath="src/sample.ts"
        annotations={annotations}
      />,
    );

    // After-pane wrapper at the first-change index carries both the row-level
    // and per-decision testIds.
    const newPane = screen.getByTestId("full-file-split-pane-new");
    expect(
      within(newPane).getByTestId(
        `full-file-split-annotations-row-${String(firstChangeRowIndex)}`,
      ),
    ).toBeInTheDocument();
    expect(
      within(newPane).getByTestId(
        `diff-decision-annotation-${String(firstChangeRowIndex)}-0`,
      ),
    ).toBeInTheDocument();

    // Before pane mounts its row wrapper at the same index but the slot is the
    // aria-hidden spacer — no test hooks.
    const oldPane = screen.getByTestId("full-file-split-pane-old");
    const beforeWrapper = oldPane.querySelector(
      `[data-index="${String(firstChangeRowIndex)}"][data-pane="old"]`,
    );
    expect(beforeWrapper).not.toBeNull();
    expect(
      within(oldPane).queryByTestId(
        `full-file-split-annotations-row-${String(firstChangeRowIndex)}`,
      ),
    ).toBeNull();
    expect(
      within(oldPane).queryByTestId(
        `diff-decision-annotation-${String(firstChangeRowIndex)}-0`,
      ),
    ).toBeNull();
  });

  it("scrolls the diff to the row at the click's vertical fraction of the ruler", () => {
    // A long enough file that a half-height click maps to a row deep into the
    // file (well past row 0 / scrollTop 0), so the spy's `top` argument has a
    // meaningful non-zero value to assert on.
    const totalLines = 200;
    const preLines: string[] = ["old-line-1"];
    const postLines: string[] = ["new-line-1"];
    for (let i = 2; i <= totalLines; i += 1) {
      preLines.push(`context-line-${String(i)}`);
      postLines.push(`context-line-${String(i)}`);
    }
    const preContent = `${preLines.join("\n")}\n`;
    const postContent = `${postLines.join("\n")}\n`;

    render(
      <FullFileSplitView
        presentationMode={DIFF_PRESENTATION_MODES.sideBySide}
        preContent={preContent}
        postContent={postContent}
        filePath="src/sample.ts"
      />,
    );

    const scrollEl = screen.getByTestId("full-file-split-view-scroll");
    const scrollToSpy = vi.fn();
    scrollEl.scrollTo = scrollToSpy as unknown as typeof scrollEl.scrollTo;

    // Pin the ruler's rect so the click's vertical fraction is deterministic.
    // The default jsdom getBoundingClientRect on a non-row element returns
    // zeros, which would make the handler bail on the height === 0 guard.
    const ruler = screen.getByTestId("full-file-split-overview-ruler");
    ruler.getBoundingClientRect = (): DOMRect =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 12,
        bottom: 400,
        width: 12,
        height: 400,
        toJSON: () => ({}),
      } as DOMRect);

    // Click at the midpoint of the 400px-tall ruler → fraction 0.5 → row ~100.
    // The virtualizer's scrollToIndex resolves that to a scrollTo({ top: N })
    // where N is well past zero (~100 * ~19.2px estimate).
    act(() => {
      ruler.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: 6,
          clientY: 200,
        }),
      );
    });

    expect(scrollToSpy).toHaveBeenCalled();
    const firstCall = scrollToSpy.mock.calls[0][0] as ScrollToOptions;
    expect(typeof firstCall.top).toBe("number");
    expect(firstCall.top).toBeGreaterThan(0);
  });

  it("treats a click on a ruler segment the same as a click on the surrounding track", () => {
    // A long file with a change at the very top so a segment is rendered near
    // y=0. Clicking inside that segment must produce the same low scrollTop a
    // click at the same coordinate on empty track would — i.e. segments do not
    // shortcut the jump to their own startIndex.
    const totalLines = 200;
    const preLines: string[] = ["alpha-old"];
    const postLines: string[] = ["alpha-new"];
    for (let i = 2; i <= totalLines; i += 1) {
      preLines.push(`context-line-${String(i)}`);
      postLines.push(`context-line-${String(i)}`);
    }
    const preContent = `${preLines.join("\n")}\n`;
    const postContent = `${postLines.join("\n")}\n`;

    render(
      <FullFileSplitView
        presentationMode={DIFF_PRESENTATION_MODES.sideBySide}
        preContent={preContent}
        postContent={postContent}
        filePath="src/sample.ts"
      />,
    );

    const scrollEl = screen.getByTestId("full-file-split-view-scroll");
    const scrollToSpy = vi.fn();
    scrollEl.scrollTo = scrollToSpy as unknown as typeof scrollEl.scrollTo;

    const ruler = screen.getByTestId("full-file-split-overview-ruler");
    ruler.getBoundingClientRect = (): DOMRect =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 12,
        bottom: 400,
        width: 12,
        height: 400,
        toJSON: () => ({}),
      } as DOMRect);

    // Click near the bottom of the ruler. There is no segment near y≈360, but
    // the click still must scroll deep into the file rather than landing on
    // any segment's start index.
    act(() => {
      ruler.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: 6,
          clientY: 360,
        }),
      );
    });

    expect(scrollToSpy).toHaveBeenCalled();
    const emptyTrackCall = scrollToSpy.mock.calls[0][0] as ScrollToOptions;
    const emptyTrackTop = emptyTrackCall.top;
    expect(typeof emptyTrackTop).toBe("number");
    expect(emptyTrackTop).toBeGreaterThan(0);
  });

  it("renders each vertical replacement with the old line immediately above the new line", () => {
    render(
      <FullFileSplitView
        presentationMode={DIFF_PRESENTATION_MODES.vertical}
        preContent="const value = 1;\n"
        postContent="const value = 2;\n"
        filePath="src/sample.ts"
      />,
    );

    const row = screen
      .getByTestId("full-file-split-pane-vertical")
      .querySelector('[data-index="0"]');
    expect(row).not.toBeNull();
    const emittedSides = Array.from(
      row?.querySelectorAll<HTMLElement>("[data-diff-side]") ?? [],
    );
    expect(emittedSides.map((line) => line.dataset.diffSide)).toEqual([
      "old",
      "new",
    ]);
    expect(emittedSides[0]).toHaveTextContent("const value = 1;");
    expect(emittedSides[1]).toHaveTextContent("const value = 2;");
    expect(emittedSides[0].querySelector("span[style]")).not.toBeNull();
    expect(emittedSides[1].querySelector("span[style]")).not.toBeNull();
    expect(screen.queryByTestId("full-file-split-divider")).toBeNull();
  });

  it("suppresses only the absent side for vertical added and deleted files", () => {
    const { rerender } = render(
      <FullFileSplitView
        presentationMode={DIFF_PRESENTATION_MODES.vertical}
        preContent={null}
        postContent="added line\n"
        filePath="src/sample.ts"
      />,
    );

    let emittedSides = screen
      .getByTestId("full-file-split-pane-vertical")
      .querySelectorAll("[data-diff-side]");
    expect(Array.from(emittedSides, (line) => line.getAttribute("data-diff-side"))).toEqual([
      "new",
    ]);

    rerender(
      <FullFileSplitView
        presentationMode={DIFF_PRESENTATION_MODES.vertical}
        preContent="deleted line\n"
        postContent={null}
        filePath="src/sample.ts"
      />,
    );
    emittedSides = screen
      .getByTestId("full-file-split-pane-vertical")
      .querySelectorAll("[data-diff-side]");
    expect(Array.from(emittedSides, (line) => line.getAttribute("data-diff-side"))).toEqual([
      "old",
    ]);
  });

  it("places vertical annotations after the new line and preserves ruler indexing", () => {
    render(
      <FullFileSplitView
        presentationMode={DIFF_PRESENTATION_MODES.vertical}
        preContent="old value\ncontext\n"
        postContent="new value\ncontext\n"
        filePath="src/sample.ts"
        annotations={[
          {
            topic: "Presentation",
            choice: "Keep annotation after the new line",
            location: { file: "src/sample.ts", startLine: 1 },
          },
        ]}
      />,
    );

    const row = screen
      .getByTestId("full-file-split-pane-vertical")
      .querySelector('[data-index="0"]');
    const children = Array.from(row?.children ?? []);
    expect(children.map((child) => child.getAttribute("data-diff-side"))).toEqual([
      "old",
      "new",
      null,
    ]);
    expect(children[2]).toHaveAttribute(
      "data-testid",
      "full-file-split-annotations-row-0",
    );
    expect(
      screen.getByTestId("full-file-split-overview-ruler-segment-0"),
    ).toHaveAttribute("data-start-index", "0");
  });

  it("clears row measurements when switching presentation modes", () => {
    layoutShims.setRowHeights({
      0: { old: 30, new: 40, vertical: 90 },
    });
    const { rerender } = render(
      <FullFileSplitView
        presentationMode={DIFF_PRESENTATION_MODES.sideBySide}
        preContent="old value\n"
        postContent="new value\n"
        filePath="src/sample.ts"
      />,
    );
    expect(getPaneHeightPx("full-file-split-pane-new")).toBe(40);

    rerender(
      <FullFileSplitView
        presentationMode={DIFF_PRESENTATION_MODES.vertical}
        preContent="old value\n"
        postContent="new value\n"
        filePath="src/sample.ts"
      />,
    );
    expect(getPaneHeightPx("full-file-split-pane-vertical")).toBe(90);
  });
});
