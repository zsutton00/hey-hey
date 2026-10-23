import { fireEvent, render, screen } from "@testing-library/react";
import React, { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { WorkItemHtmlCssAnnotation } from "../../../api";
import {
  getHtmlCssElementAnnotationPoint,
  getHtmlCssPositionAnnotationPoint,
  getHtmlCssPositionTargetFromViewportPoint,
} from "../htmlCssAnnotationGeometry";
import {
  getHtmlCssAnnotationDisplayState,
  HTML_CSS_ELEMENT_SELECTION_EVENT,
  HtmlCssAnnotationControls,
  HtmlCssAnnotationLayer,
  type HtmlCssAnnotationDisplayMode,
  type HtmlCssAnnotationPlacementMode,
} from "../HtmlCssAnnotationLayer";

const annotation: WorkItemHtmlCssAnnotation = {
  id: "10000000-0000-4000-8000-000000000001",
  note: "Keep this prominent.",
  author: {
    type: "human",
    userId: "10000000-0000-4000-8000-000000000002",
  },
  category: "suggestion",
  lifecycle: "resolved",
  authoredProposalId: "20000000-0000-4000-8000-000000000001",
  authoredSizeKey: "desktop",
  target: { type: "position", x: 0.25, y: 0.75, sizeKey: "desktop" },
};

const Harness = ({
  onCreate,
  onLifecycleChange,
}: {
  onCreate?: (
    target: Parameters<
      NonNullable<
        React.ComponentProps<typeof HtmlCssAnnotationLayer>["onCreate"]
      >
    >[0]
  ) => void;
  onLifecycleChange?: NonNullable<
    React.ComponentProps<typeof HtmlCssAnnotationLayer>["onLifecycleChange"]
  >;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<HtmlCssAnnotationDisplayMode>("pins");
  const [placementMode, setPlacementMode] =
    useState<HtmlCssAnnotationPlacementMode>(null);
  return (
    <>
      <HtmlCssAnnotationControls
        mode={mode}
        placementMode={placementMode}
        canCreate={Boolean(onCreate)}
        onModeChange={setMode}
        onPlacementModeChange={setPlacementMode}
      />
      <div ref={ref}>
        <HtmlCssAnnotationLayer
          annotations={[annotation]}
          materializedProposalId={annotation.authoredProposalId}
          presentationSizeKey="desktop"
          canvasRef={ref}
          mode={mode}
          placementMode={placementMode}
          onPlacementModeChange={setPlacementMode}
          resolveAuthorName={() => "Zac"}
          onCreate={onCreate}
          onLifecycleChange={onLifecycleChange}
        />
      </div>
    </>
  );
};

describe("HtmlCssAnnotationLayer", () => {
  const viewport = {
    scrollX: 0,
    scrollY: 0,
    viewportWidth: 320,
    viewportHeight: 200,
    documentWidth: 320,
    documentHeight: 1000,
  };

  it("stores positional targets in document coordinates and transforms them into the viewport", () => {
    expect(
      getHtmlCssPositionTargetFromViewportPoint({
        clientX: 80,
        clientY: 120,
        canvasRect: { left: 0, top: 0, width: 320, height: 200 },
        viewport: { ...viewport, scrollY: 200 },
        sizeKey: "desktop",
      })
    ).toEqual({ type: "position", x: 0.25, y: 0.32, sizeKey: "desktop" });
    expect(
      getHtmlCssPositionAnnotationPoint({
        target: { type: "position", x: 0.25, y: 0.32, sizeKey: "desktop" },
        viewport: { ...viewport, scrollY: 200 },
        canvasSize: { width: 320, height: 200 },
      })
    ).toEqual({ x: 0.25, y: 0.6 });
  });

  it("translates element bounds with the iframe scroll position", () => {
    expect(
      getHtmlCssElementAnnotationPoint({
        metadata: {
          nodeId: "hero",
          tag: "section",
          textExcerpt: "Hero",
          x: 0.5,
          y: 0.7,
          outerHtmlExcerpt: '<section data-hh-id="hero">Hero</section>',
          bounds: { x: 40, y: 120, width: 80, height: 40 },
        },
        capturedViewport: viewport,
        currentViewport: { ...viewport, scrollY: 80 },
        canvasSize: { width: 320, height: 200 },
      })
    ).toEqual({ x: 0.25, y: 0.3 });
  });

  it("keeps lifecycle independent from proposal and size currency", () => {
    expect(
      getHtmlCssAnnotationDisplayState(
        annotation,
        annotation.authoredProposalId,
        "desktop"
      )
    ).toBe("resolved");
    expect(
      getHtmlCssAnnotationDisplayState(
        annotation,
        "20000000-0000-4000-8000-000000000002",
        "desktop"
      )
    ).toBe("outdated");
    expect(
      getHtmlCssAnnotationDisplayState(
        annotation,
        annotation.authoredProposalId,
        "mobile"
      )
    ).toBe("outdated");
  });

  it("renders normalized pins and expanded lifecycle controls", () => {
    const onLifecycleChange = vi.fn();
    render(<Harness onLifecycleChange={onLifecycleChange} />);

    expect(screen.getByTestId("html-css-annotation-pin")).toHaveStyle({
      left: "25%",
      top: "75%",
    });
    fireEvent.click(screen.getByRole("button", { name: "Expanded" }));
    expect(screen.getByText("Keep this prominent.")).toBeInTheDocument();
    expect(screen.getByText("Zac")).toBeInTheDocument();
    expect(screen.queryByText("suggestion")).not.toBeInTheDocument();
    expect(screen.queryByText("resolved")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Reopen annotation 1" })
    );
    expect(onLifecycleChange).toHaveBeenCalledWith(annotation.id, "open");
    fireEvent.click(screen.getByRole("button", { name: "Hidden" }));
    expect(screen.queryByTestId("html-css-annotation-pin")).toBeNull();
  });

  it("creates normalized positional targets with authored size context", () => {
    const onCreate = vi.fn();
    render(<Harness onCreate={onCreate} />);
    const canvas = screen.getByTestId("html-css-annotation-canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 210,
      bottom: 120,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Add positional note" })
    );
    fireEvent.click(canvas, { clientX: 60, clientY: 95 });

    expect(onCreate).toHaveBeenCalledWith({
      type: "position",
      x: 0.25,
      y: 0.75,
      sizeKey: "desktop",
    });
  });

  it("consumes stable element targets from the selection boundary", () => {
    const onCreate = vi.fn();
    render(<Harness onCreate={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: "Add element note" }));
    expect(screen.getByTestId("html-css-annotation-canvas")).toHaveStyle({
      pointerEvents: "none",
    });
    fireEvent(
      screen.getByTestId("html-css-annotation-layer").parentElement!,
      new CustomEvent(HTML_CSS_ELEMENT_SELECTION_EVENT, {
        bubbles: true,
        detail: { nodeId: "hero", x: 0.5, y: 0.2 },
      })
    );

    expect(onCreate).toHaveBeenCalledWith({ type: "element", nodeId: "hero" });
  });

  it("keeps an element pin attached as the iframe scrolls", () => {
    const ref = React.createRef<HTMLDivElement>();
    const elementAnnotation = {
      ...annotation,
      target: { type: "element" as const, nodeId: "hero" },
    };
    const { rerender } = render(
      <div ref={ref}>
        <HtmlCssAnnotationLayer
          annotations={[elementAnnotation]}
          materializedProposalId={annotation.authoredProposalId}
          presentationSizeKey="desktop"
          canvasRef={ref}
          reviewViewport={viewport}
          elementMetadataViewports={new Map([["hero", viewport]])}
          elementsByNodeId={
            new Map([
              [
                "hero",
                {
                  nodeId: "hero",
                  tag: "section",
                  textExcerpt: "Hero",
                  x: 0.5,
                  y: 0.7,
                  outerHtmlExcerpt: '<section data-hh-id="hero">Hero</section>',
                  bounds: { x: 40, y: 120, width: 80, height: 40 },
                },
              ],
            ])
          }
          mode="pins"
          placementMode={null}
          onPlacementModeChange={vi.fn()}
        />
      </div>
    );
    expect(screen.getByTestId("html-css-annotation-pin")).toHaveStyle({
      left: "25%",
      top: "70%",
    });

    rerender(
      <div ref={ref}>
        <HtmlCssAnnotationLayer
          annotations={[elementAnnotation]}
          materializedProposalId={annotation.authoredProposalId}
          presentationSizeKey="desktop"
          canvasRef={ref}
          reviewViewport={{ ...viewport, scrollY: 80 }}
          elementMetadataViewports={new Map([["hero", viewport]])}
          elementsByNodeId={
            new Map([
              [
                "hero",
                {
                  nodeId: "hero",
                  tag: "section",
                  textExcerpt: "Hero",
                  x: 0.5,
                  y: 0.7,
                  outerHtmlExcerpt: '<section data-hh-id="hero">Hero</section>',
                  bounds: { x: 40, y: 120, width: 80, height: 40 },
                },
              ],
            ])
          }
          mode="pins"
          placementMode={null}
          onPlacementModeChange={vi.fn()}
        />
      </div>
    );
    expect(screen.getByTestId("html-css-annotation-pin")).toHaveStyle({
      left: "25%",
      top: "30%",
    });
  });

  it("allows revision selection only for open current annotations", () => {
    const ref = React.createRef<HTMLDivElement>();
    const onSelectionChange = vi.fn();
    render(
      <div ref={ref}>
        <HtmlCssAnnotationLayer
          annotations={[
            { ...annotation, lifecycle: "open" },
            {
              ...annotation,
              id: "10000000-0000-4000-8000-000000000004",
            },
            {
              ...annotation,
              id: "10000000-0000-4000-8000-000000000003",
              lifecycle: "open",
              authoredProposalId: "20000000-0000-4000-8000-000000000009",
            },
          ]}
          materializedProposalId={annotation.authoredProposalId}
          presentationSizeKey="desktop"
          canvasRef={ref}
          mode="expanded"
          placementMode={null}
          onPlacementModeChange={vi.fn()}
          selectedAnnotationIds={new Set()}
          onSelectedAnnotationIdsChange={onSelectionChange}
        />
      </div>
    );
    const boxes = screen.getAllByTestId("html-css-select-annotation");
    expect(boxes[0].querySelector("input")).toBeEnabled();
    expect(boxes[1].querySelector("input")).toBeDisabled();
    expect(boxes[2].querySelector("input")).toBeDisabled();
    fireEvent.click(boxes[0].querySelector("input")!);
    expect(onSelectionChange).toHaveBeenCalledWith(
      new Set(["10000000-0000-4000-8000-000000000001"])
    );
  });
});
