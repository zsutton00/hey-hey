import { describe, expect, it, vi } from "vitest";
import {
  createHtmlCssReviewRuntime,
  HTML_CSS_REVIEW_BRIDGE_MESSAGE,
  normalizeHtmlCssReviewText,
  parseHtmlCssReviewBridgeMessage,
} from "../htmlCssReviewBridge";

const metadata = {
  nodeId: "hero",
  tag: "section",
  textExcerpt: "Welcome to Hey Hey",
  x: 0.5,
  y: 0.25,
  outerHtmlExcerpt: '<section data-hh-id="hero">Welcome to Hey Hey</section>',
  bounds: { x: 10, y: 20, width: 100, height: 40 },
};

describe("htmlCssReviewBridge", () => {
  it("accepts only token-authenticated, normalized bridge messages", () => {
    expect(
      parseHtmlCssReviewBridgeMessage(
        {
          type: HTML_CSS_REVIEW_BRIDGE_MESSAGE,
          channelToken: "section-token",
          interaction: "select",
          element: metadata,
        },
        "section-token"
      )
    ).toEqual({
      type: HTML_CSS_REVIEW_BRIDGE_MESSAGE,
      channelToken: "section-token",
      interaction: "select",
      element: metadata,
    });
    expect(
      parseHtmlCssReviewBridgeMessage(
        {
          type: HTML_CSS_REVIEW_BRIDGE_MESSAGE,
          channelToken: "other-token",
          interaction: "select",
          element: metadata,
        },
        "section-token"
      )
    ).toBeNull();
    expect(
      parseHtmlCssReviewBridgeMessage(
        {
          type: HTML_CSS_REVIEW_BRIDGE_MESSAGE,
          channelToken: "section-token",
          interaction: "select",
          element: { ...metadata, x: Number.NaN },
        },
        "section-token"
      )
    ).toBeNull();
    expect(
      parseHtmlCssReviewBridgeMessage(
        {
          type: HTML_CSS_REVIEW_BRIDGE_MESSAGE,
          channelToken: "section-token",
          interaction: "hover",
          element: null,
        },
        "section-token"
      )
    ).not.toBeNull();
    expect(
      parseHtmlCssReviewBridgeMessage(
        {
          type: HTML_CSS_REVIEW_BRIDGE_MESSAGE,
          channelToken: "section-token",
          interaction: "viewport",
          viewport: {
            scrollX: 0,
            scrollY: 120,
            viewportWidth: 320,
            viewportHeight: 200,
            documentWidth: 320,
            documentHeight: 1000,
          },
        },
        "section-token"
      )
    ).not.toBeNull();
    expect(
      parseHtmlCssReviewBridgeMessage(
        {
          type: HTML_CSS_REVIEW_BRIDGE_MESSAGE,
          channelToken: "section-token",
          interaction: "viewport",
          viewport: {
            scrollX: -1,
            scrollY: 0,
            viewportWidth: 320,
            viewportHeight: 200,
            documentWidth: 320,
            documentHeight: 1000,
          },
        },
        "section-token"
      )
    ).toBeNull();
  });

  it("normalizes excerpts and builds a stable-id-only hover/select runtime", () => {
    expect(normalizeHtmlCssReviewText("  Hello\n   world  ")).toBe(
      "Hello world"
    );
    const runtime = createHtmlCssReviewRuntime("section-token");
    expect(runtime.css).toContain("[data-hh-review-hovered]");
    expect(runtime.script).toContain('closest("[data-hh-id]")');
    expect(runtime.script).toContain("nodeId && nodeId.trim()");
    expect(runtime.script).toContain('send("hover", hovered)');
    expect(runtime.script).toContain('send("select", element)');
    expect(runtime.script).toContain("tag: element.tagName.toLowerCase()");
    expect(runtime.script).toContain("clone.outerHTML");
    expect(runtime.script).toContain('interaction: "snapshot"');
    expect(runtime.script).toContain('interaction: "viewport"');
    expect(runtime.script).toContain('window.addEventListener("scroll"');
    expect(runtime.script).toContain("scheduleViewportAndSnapshot");
    expect(runtime.script).toContain("slice(0, 120)");
  });

  it("coalesces authenticated viewport updates and keeps snapshots target-bounded", () => {
    document.body.innerHTML = '<div data-hh-id="hero">Hero</div>';
    const postMessage = vi.fn();
    const frames: Array<() => void> = [];
    const runtime = createHtmlCssReviewRuntime("section-token", false, [
      "hero",
    ]);
    const runRuntime = new Function(
      "document",
      "parent",
      "Element",
      "requestAnimationFrame",
      runtime.script
    );
    runRuntime(document, { postMessage }, Element, (callback: () => void) => {
      frames.push(callback);
      return frames.length;
    });

    expect(frames).toHaveLength(1);
    frames.shift()?.();
    expect(postMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: HTML_CSS_REVIEW_BRIDGE_MESSAGE,
        channelToken: "section-token",
        interaction: "viewport",
      }),
      "*"
    );
    expect(postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        interaction: "snapshot",
        elements: [expect.objectContaining({ nodeId: "hero" })],
      }),
      "*"
    );

    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    expect(frames).toHaveLength(1);
    frames.shift()?.();
    expect(postMessage).toHaveBeenCalledTimes(4);
    expect(postMessage).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ interaction: "viewport" }),
      "*"
    );
  });

  it("accepts bounded unique snapshots and rejects duplicate identities", () => {
    const snapshot = {
      type: HTML_CSS_REVIEW_BRIDGE_MESSAGE,
      channelToken: "section-token",
      interaction: "snapshot",
      elements: [metadata],
    };
    expect(parseHtmlCssReviewBridgeMessage(snapshot, "section-token")).toEqual(
      snapshot
    );
    expect(
      parseHtmlCssReviewBridgeMessage(
        { ...snapshot, elements: [metadata, metadata] },
        "section-token"
      )
    ).toBeNull();
    expect(
      parseHtmlCssReviewBridgeMessage(
        {
          ...snapshot,
          elements: [{ ...metadata, outerHtmlExcerpt: "x".repeat(4001) }],
        },
        "section-token"
      )
    ).toBeNull();
  });

  it("snapshots only requested stable identities without a document-wide cutoff", () => {
    const targetNodeId = "item-500";
    document.body.innerHTML = Array.from(
      { length: 501 },
      (_, index) => `<div data-hh-id="item-${index}">Item ${index}</div>`
    ).join("");
    const postMessage = vi.fn();
    const runtime = createHtmlCssReviewRuntime("section-token", false, [
      targetNodeId,
    ]);
    const runRuntime = new Function(
      "document",
      "parent",
      "Element",
      "requestAnimationFrame",
      runtime.script
    );
    runRuntime(document, { postMessage }, Element, (callback: () => void) =>
      callback()
    );

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: HTML_CSS_REVIEW_BRIDGE_MESSAGE,
        channelToken: "section-token",
        interaction: "snapshot",
        elements: [expect.objectContaining({ nodeId: targetNodeId })],
      },
      "*"
    );
  });

  it("highlights and reports eligible elements while ignoring ordinary content", () => {
    const runtime = createHtmlCssReviewRuntime("section-token");
    document.body.innerHTML =
      '<button data-hh-id="save"><span> Save now </span></button><p>Ordinary</p>';
    const button = document.querySelector("button");
    const label = document.querySelector("span");
    const ordinary = document.querySelector("p");
    if (!button || !label || !ordinary) throw new Error("Missing test content");
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      x: 50,
      y: 5,
      left: 50,
      top: 5,
      right: 150,
      bottom: 45,
      width: 100,
      height: 40,
      toJSON: () => ({}),
    });
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      value: 100,
    });
    const postMessage = vi.fn();
    const saveMetadata = {
      nodeId: "save",
      tag: "button",
      textExcerpt: "Save now",
      x: 0.5,
      y: 0.25,
      outerHtmlExcerpt:
        '<button data-hh-id="save"><span> Save now </span></button>',
      bounds: { x: 50, y: 5, width: 100, height: 40 },
    };
    const runRuntime = new Function(
      "document",
      "parent",
      "Element",
      runtime.script
    );
    runRuntime(document, { postMessage }, Element);

    label.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));

    expect(button).toHaveAttribute("data-hh-review-hovered", "");
    expect(postMessage).toHaveBeenLastCalledWith(
      {
        type: HTML_CSS_REVIEW_BRIDGE_MESSAGE,
        channelToken: "section-token",
        interaction: "hover",
        element: saveMetadata,
      },
      "*"
    );

    ordinary.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(postMessage).toHaveBeenCalledTimes(1);
    label.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        interaction: "select",
        element: saveMetadata,
      }),
      "*"
    );
  });
});
