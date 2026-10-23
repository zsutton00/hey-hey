import React, { useEffect, useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog, DialogContent } from "@mui/material";
import { getContrastRatio, ThemeProvider } from "@mui/material/styles";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CanonicalPageBoundary,
  CanonicalPageProvider,
  createCanonicalPageDescriptor,
} from "../../../contexts/CanonicalPageContext";
import { EntityActivationProvider } from "../../../contexts/EntityActivationContext";
import { createHeyTheme } from "../../../contexts/ThemeContext";
import { computeCalloutPosition } from "../calloutPosition";
import { defineWalkthrough } from "../GuidableActionRegistry";
import { GuidedWalkthroughProvider } from "../GuidedWalkthroughProvider";
import { GuidedWalkthroughOverlay } from "../GuidedWalkthroughOverlay";
import type { GuidedWalkthroughView } from "../GuidedWalkthroughRunner";
import {
  createGuidedWalkthroughRuntime,
  useGuidedWalkthroughControls,
  type GuidedWalkthroughControls,
  type GuidedWalkthroughRuntime,
} from "../guidedWalkthroughRuntime";
import type { DiscussSuggestionView } from "../DiscussModalSessionStore";
import { CanonicalWalkthroughEvents } from "../useCanonicalWalkthroughEvents";
import { useGuidableTarget } from "../useGuidableTarget";
import {
  createDiscussModalInstanceId,
  type GuidableEntity,
  type WalkthroughEvent,
} from "../types";

const feature: GuidableEntity = {
  kind: "feature",
  id: "11111111-1111-4111-8111-111111111111",
};
const PROMPT = "Draft the first tasks for Billing.";
const walkthrough = defineWalkthrough("Start on Billing", [
  {
    actionKey: "open-entity",
    inputs: { entity: feature, entityName: "Billing" },
  },
  { actionKey: "open-discuss", inputs: { entity: feature } },
  {
    actionKey: "compose-and-start",
    inputs: { entity: feature, suggestedPrompt: PROMPT },
  },
]);

let rect = { top: 100, left: 20, width: 200, height: 32 };
let frames: FrameRequestCallback[] = [];
function flushFrames() {
  const pending = frames;
  frames = [];
  for (const frame of pending) frame(0);
}

function ExplorerRow() {
  const [element, setElement] = useState<HTMLButtonElement | null>(null);
  useGuidableTarget(
    { surface: "explorer-row", entity: feature },
    () => element,
  );
  return (
    <button
      ref={(node) => {
        if (node) node.getBoundingClientRect = () => ({ ...rect }) as DOMRect;
        setElement(node);
      }}
      data-testid="explorer-row"
    >
      Billing
    </button>
  );
}

let controls: GuidedWalkthroughControls | null = null;
function CaptureControls() {
  controls = useGuidedWalkthroughControls();
  return null;
}

/**
 * Minimal DiscussModal stand-in: a real MUI Dialog with the same guidance
 * slot, targets and session publishing contract.
 */
function FakeDiscussModal({
  runtime,
  onClose,
  onAccept,
}: {
  runtime: GuidedWalkthroughRuntime;
  onClose: () => void;
  onAccept: () => void;
}) {
  const [modalInstanceId] = useState(createDiscussModalInstanceId);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [suggestion, setSuggestion] = useState<DiscussSuggestionView>({
    status: "none",
  });
  const [editor, setEditor] = useState<HTMLTextAreaElement | null>(null);
  useGuidableTarget(
    { name: "discuss-prompt-editor", entity: feature, modalInstanceId },
    () => editor,
  );
  useEffect(() => {
    runtime.events.emit({
      type: "discuss-modal-opened",
      entity: feature,
      modalInstanceId,
    });
  }, [runtime, modalInstanceId]);
  const [token] = useState(() => Symbol("session"));
  useEffect(
    () =>
      runtime.discussSessions.publish(token, {
        entity: feature,
        modalInstanceId,
        promptReady: false,
        suggestion,
        guidanceContainer: container,
        offerSuggestion: (text) => setSuggestion({ status: "available", text }),
        acceptSuggestion: () => {
          onAccept();
          return true;
        },
      }),
    [runtime, token, modalInstanceId, suggestion, container, onAccept],
  );
  return (
    <Dialog open onClose={onClose} onKeyDown={(e) => e.stopPropagation()}>
      <DialogContent>
        <textarea
          aria-label="Prompt"
          ref={(node) => {
            if (node)
              node.getBoundingClientRect = () => ({ ...rect }) as DOMRect;
            setEditor(node);
          }}
        />
        <div ref={setContainer} data-testid="discuss-walkthrough-guidance" />
      </DialogContent>
    </Dialog>
  );
}

function renderWithProvider(
  runtime: GuidedWalkthroughRuntime,
  children: React.ReactNode,
  mode: "light" | "dark" = "light",
) {
  return render(
    <ThemeProvider theme={createHeyTheme(mode)}>
      <GuidedWalkthroughProvider runtime={runtime}>
        <CaptureControls />
        {children}
      </GuidedWalkthroughProvider>
    </ThemeProvider>,
  );
}

describe("GuidedWalkthroughProvider", () => {
  let runtime: GuidedWalkthroughRuntime;

  beforeEach(() => {
    rect = { top: 100, left: 20, width: 200, height: 32 };
    runtime = createGuidedWalkthroughRuntime();
    controls = null;
    Element.prototype.scrollIntoView = vi.fn();
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("announces the step beside the highlighted target without covering it", () => {
    renderWithProvider(runtime, <ExplorerRow />);
    act(() => controls?.startWalkthrough(walkthrough));

    const bar = screen.getByTestId("guided-walkthrough-bar");
    expect(bar).toHaveTextContent("Start on Billing");
    expect(bar).toHaveTextContent("Step 1 of 3");
    expect(bar).toHaveTextContent("Esc to exit");
    expect(within(bar).queryByRole("button", { name: /next/i })).toBeNull();

    const callout = screen.getByRole("status");
    expect(callout).toHaveTextContent(
      "Your features live in the Explorer. Open Billing.",
    );
    expect(callout).toHaveAttribute("aria-live", "polite");
    expect(callout).toHaveAttribute("data-placement", "right");

    const highlight = screen.getByTestId("guided-walkthrough-highlight");
    expect(getComputedStyle(highlight).pointerEvents).toBe("none");
    expect(getComputedStyle(highlight).position).toBe("fixed");

    // The real control stays usable.
    const onClick = vi.fn();
    screen.getByTestId("explorer-row").addEventListener("click", onClick);
    fireEvent.click(screen.getByTestId("explorer-row"));
    expect(onClick).toHaveBeenCalled();
  });

  it.each(["light", "dark"] as const)(
    "uses readable blue guidance on the page and in Discuss in %s mode",
    async (mode) => {
      const theme = createHeyTheme(mode);
      const page = renderWithProvider(runtime, <ExplorerRow />, mode);
      act(() => controls?.startWalkthrough(walkthrough));
      const pageStyle = getComputedStyle(screen.getByRole("status"));
      expect(pageStyle.backgroundColor).toBe(theme.palette.primary.dark);
      expect(pageStyle.backgroundImage).toBe("none");
      expect(pageStyle.backgroundColor).not.toBe(
        theme.palette.background.paper,
      );
      expect(
        getContrastRatio(pageStyle.backgroundColor, pageStyle.color),
      ).toBeGreaterThanOrEqual(4.5);
      page.unmount();

      const onAccept = vi.fn();
      act(() => runtime.currentPage.publish(Symbol("page"), feature));
      renderWithProvider(
        runtime,
        <FakeDiscussModal
          runtime={runtime}
          onClose={vi.fn()}
          onAccept={onAccept}
        />,
        mode,
      );
      act(() => controls?.startWalkthrough(walkthrough));
      const callout = within(
        screen.getByTestId("discuss-walkthrough-guidance"),
      ).getByRole("status");
      const surface = getComputedStyle(callout);
      expect(surface.backgroundColor).toBe(pageStyle.backgroundColor);
      expect(surface.backgroundImage).toBe("none");
      // jsdom retains the inherit keyword instead of resolving its color.
      expect(getComputedStyle(within(callout).getByText(PROMPT)).color).toBe(
        "inherit",
      );
      const sample = within(callout).getByTestId(
        "guided-walkthrough-suggested-prompt",
      );
      expect(sample).toHaveTextContent("Suggested prompt");
      expect(within(sample).getByText(PROMPT)).toBeInTheDocument();
      expect(getComputedStyle(within(sample).getByText(PROMPT)).fontStyle).toBe(
        "normal",
      );
      const helper = within(callout).getByRole("button");
      expect(helper.querySelector("svg")).not.toBeNull();
      expect(getComputedStyle(helper).color).toBe("inherit");
      screen.getByLabelText("Prompt").focus();
      await userEvent.tab();
      expect(helper).toHaveFocus();
      expect(getComputedStyle(helper).outline).toContain("2px solid");
      await userEvent.keyboard("{Enter}");
      expect(onAccept).toHaveBeenCalledTimes(1);
    },
  );

  it("follows the target on scroll and resize", () => {
    renderWithProvider(runtime, <ExplorerRow />);
    act(() => controls?.startWalkthrough(walkthrough));
    const highlight = screen.getByTestId("guided-walkthrough-highlight");
    expect(getComputedStyle(highlight).top).toBe("96px");

    rect = { ...rect, top: 300 };
    act(() => {
      fireEvent.scroll(document.body);
      flushFrames();
    });
    expect(getComputedStyle(highlight).top).toBe("296px");

    rect = { ...rect, left: 60 };
    act(() => {
      window.dispatchEvent(new Event("resize"));
      flushFrames();
    });
    expect(getComputedStyle(highlight).left).toBe("56px");
  });

  it("follows a target that moves without a scroll or resize event, without replaying the entrance", () => {
    renderWithProvider(runtime, <ExplorerRow />);
    act(() => controls?.startWalkthrough(walkthrough));
    const highlight = screen.getByTestId("guided-walkthrough-highlight");
    const callout = screen.getByTestId("guided-walkthrough-callout");
    const anchor = screen.getByTestId("guided-walkthrough-anchor");
    expect(getComputedStyle(highlight).top).toBe("96px");

    // e.g. the prompt editor grows and pushes the target down.
    rect = { ...rect, top: 260 };
    act(() => flushFrames());
    expect(getComputedStyle(highlight).top).toBe("256px");
    expect(getComputedStyle(anchor).top).toBe("276px");
    expect(screen.getByTestId("guided-walkthrough-callout")).toBe(callout);
  });

  it("animates each new step once, preserves positioning, and supports reduced motion", () => {
    const target = document.createElement("button");
    document.body.appendChild(target);
    target.getBoundingClientRect = () => ({ ...rect }) as DOMRect;
    const view: Extract<GuidedWalkthroughView, { status: "active" }> = {
      status: "active",
      title: "Start on Billing",
      stepNumber: 1,
      stepCount: 3,
      target,
      placement: "right",
      copy: "Open Billing.",
      suggestion: null,
      modalContainer: null,
    };
    const renderOverlay = (stepNumber: number) => (
      <ThemeProvider theme={createHeyTheme("light")}>
        <GuidedWalkthroughOverlay
          view={{ ...view, stepNumber }}
          onExit={vi.fn()}
          onDismissMessage={vi.fn()}
        />
      </ThemeProvider>
    );
    const overlay = render(renderOverlay(1));
    const first = screen.getByTestId("guided-walkthrough-callout");
    expect(getComputedStyle(first).animation).toContain(
      "walkthrough-callout-enter",
    );
    const anchor = screen.getByTestId("guided-walkthrough-anchor");
    expect(getComputedStyle(anchor).transform).toBe("translateY(-50%)");
    expect(getComputedStyle(anchor).animation).not.toContain(
      "walkthrough-callout-enter",
    );
    const css = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules, (rule) => rule.cssText))
      .join("\n");
    expect(css).toContain("scale(1.1)");
    expect(css).toContain("scale(1)");
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none/);

    rect = { ...rect, top: 300 };
    act(() => {
      fireEvent.scroll(document.body);
      flushFrames();
    });
    expect(screen.getByTestId("guided-walkthrough-callout")).toBe(first);
    expect(getComputedStyle(anchor).top).toBe("316px");
    overlay.rerender(renderOverlay(2));
    const second = screen.getByTestId("guided-walkthrough-callout");
    expect(second).not.toBe(first);
    expect(getComputedStyle(second).animation).toContain(
      "walkthrough-callout-enter",
    );
    target.remove();
  });

  it("Exit leaves the app where it is", async () => {
    renderWithProvider(runtime, <ExplorerRow />);
    act(() => controls?.startWalkthrough(walkthrough));

    await userEvent.click(screen.getByTestId("guided-walkthrough-exit"));
    expect(screen.queryByTestId("guided-walkthrough-bar")).toBeNull();
    expect(screen.getByTestId("explorer-row")).toBeInTheDocument();
  });

  it("guides inside Discuss within its keyboard boundary; Escape exits without closing it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onAccept = vi.fn();
    act(() => runtime.currentPage.publish(Symbol("page"), feature));
    renderWithProvider(
      runtime,
      <FakeDiscussModal
        runtime={runtime}
        onClose={onClose}
        onAccept={onAccept}
      />,
    );
    act(() => controls?.startWalkthrough(walkthrough));

    const slot = screen.getByTestId("discuss-walkthrough-guidance");
    const bar = within(slot).getByTestId("guided-walkthrough-bar");
    expect(bar).toHaveTextContent("Step 3 of 3");
    const callout = within(slot).getByRole("status");
    expect(callout).toHaveTextContent(PROMPT);

    // Keyboard reachable from the editor, without a focus trap of its own.
    screen.getByLabelText("Prompt").focus();
    await user.tab();
    const helper = within(callout).getByRole("button", {
      name: "Use our suggestion",
    });
    expect(helper).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onAccept).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("guided-walkthrough-bar")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // With no walkthrough active, Escape belongs to the Dialog again. (MUI's
    // focus trap restores focus into the Dialog in a browser; jsdom does not.)
    screen.getByLabelText("Prompt").focus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an accessible message when the target is missing", async () => {
    vi.useFakeTimers();
    try {
      renderWithProvider(runtime, null);
      act(() => controls?.startWalkthrough(walkthrough));
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      const message = screen.getByTestId("guided-walkthrough-ended");
      expect(message).toHaveAttribute("role", "status");
      expect(message).toHaveTextContent(
        "The walkthrough ended because Billing in the Explorer could not be found.",
      );
      fireEvent.click(within(message).getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByTestId("guided-walkthrough-ended")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CanonicalWalkthroughEvents", () => {
  it("forwards the canonical page as state and a shown event", () => {
    const runtime = createGuidedWalkthroughRuntime();
    const events: WalkthroughEvent[] = [];
    runtime.events.subscribe((event) => events.push(event));
    const descriptor = createCanonicalPageDescriptor("task", feature.id, null);

    const view = render(
      <GuidedWalkthroughProvider runtime={runtime}>
        <EntityActivationProvider sink={{ onEntityActivated: vi.fn() }}>
          <CanonicalPageProvider>
            <CanonicalWalkthroughEvents />
            <CanonicalPageBoundary
              composition={{ kind: "canonical", descriptor }}
            >
              <div />
            </CanonicalPageBoundary>
          </CanonicalPageProvider>
        </EntityActivationProvider>
      </GuidedWalkthroughProvider>,
    );

    expect(runtime.currentPage.current()).toEqual({
      kind: "task",
      id: feature.id,
    });
    expect(events).toEqual([
      {
        type: "canonical-page-shown",
        entity: { kind: "task", id: feature.id },
      },
    ]);

    view.unmount();
    expect(runtime.currentPage.current()).toBeNull();
  });

  it("does not treat an observational (Preview/Peek) composition as a page", () => {
    const runtime = createGuidedWalkthroughRuntime();
    render(
      <GuidedWalkthroughProvider runtime={runtime}>
        <EntityActivationProvider sink={{ onEntityActivated: vi.fn() }}>
          <CanonicalPageProvider>
            <CanonicalWalkthroughEvents />
            <CanonicalPageBoundary composition={{ kind: "observational" }}>
              <div />
            </CanonicalPageBoundary>
          </CanonicalPageProvider>
        </EntityActivationProvider>
      </GuidedWalkthroughProvider>,
    );
    expect(runtime.currentPage.current()).toBeNull();
  });
});

describe("computeCalloutPosition", () => {
  const viewport = { width: 1440, height: 900 };

  it("places beside, above or below the target", () => {
    const target = { top: 400, left: 100, width: 200, height: 40 };
    expect(computeCalloutPosition("right", target, viewport)).toMatchObject({
      placement: "right",
      left: 312,
      top: 420,
    });
    expect(computeCalloutPosition("top", target, viewport)).toMatchObject({
      placement: "top",
      top: 388,
      left: 200,
    });
    expect(computeCalloutPosition("bottom", target, viewport)).toMatchObject({
      placement: "bottom",
      top: 452,
    });
  });

  it("flips when the preferred side has no room and stays on screen", () => {
    const wide = { top: 400, left: 1200, width: 220, height: 40 };
    const right = computeCalloutPosition("right", wide, viewport);
    expect(right.placement).toBe("bottom");
    expect(right.left).toBe(1440 - 150 - 8);

    const atTop = { top: 20, left: 600, width: 100, height: 30 };
    expect(computeCalloutPosition("top", atTop, viewport).placement).toBe(
      "bottom",
    );
    const atBottom = { top: 860, left: 600, width: 100, height: 30 };
    expect(computeCalloutPosition("bottom", atBottom, viewport).placement).toBe(
      "top",
    );
  });
});
