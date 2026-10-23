export const HTML_CSS_REVIEW_BRIDGE_MESSAGE =
  "hey-hey:html-css-review-bridge" as const;

export type HtmlCssReviewInteraction = "hover" | "select" | "snapshot";

export interface HtmlCssReviewElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HtmlCssReviewElementMetadata {
  nodeId: string;
  tag: string;
  textExcerpt: string;
  x: number;
  y: number;
  outerHtmlExcerpt: string;
  bounds: HtmlCssReviewElementBounds;
}

export interface HtmlCssReviewViewport {
  scrollX: number;
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  documentWidth: number;
  documentHeight: number;
}

export type HtmlCssReviewBridgeMessage =
  | {
      type: typeof HTML_CSS_REVIEW_BRIDGE_MESSAGE;
      channelToken: string;
      interaction: "hover" | "select";
      element: HtmlCssReviewElementMetadata | null;
    }
  | {
      type: typeof HTML_CSS_REVIEW_BRIDGE_MESSAGE;
      channelToken: string;
      interaction: "snapshot";
      elements: HtmlCssReviewElementMetadata[];
    }
  | {
      type: typeof HTML_CSS_REVIEW_BRIDGE_MESSAGE;
      channelToken: string;
      interaction: "viewport";
      viewport: HtmlCssReviewViewport;
    };

export const HTML_CSS_REVIEW_OUTER_HTML_MAX_LENGTH = 4000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNormalizedCoordinate = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isBounds = (value: unknown): value is HtmlCssReviewElementBounds =>
  isRecord(value) &&
  isFiniteNumber(value.x) &&
  isFiniteNumber(value.y) &&
  isFiniteNumber(value.width) &&
  value.width >= 0 &&
  isFiniteNumber(value.height) &&
  value.height >= 0;

const isViewport = (value: unknown): value is HtmlCssReviewViewport =>
  isRecord(value) &&
  isFiniteNumber(value.scrollX) &&
  value.scrollX >= 0 &&
  isFiniteNumber(value.scrollY) &&
  value.scrollY >= 0 &&
  isFiniteNumber(value.viewportWidth) &&
  value.viewportWidth > 0 &&
  isFiniteNumber(value.viewportHeight) &&
  value.viewportHeight > 0 &&
  isFiniteNumber(value.documentWidth) &&
  value.documentWidth >= value.viewportWidth &&
  isFiniteNumber(value.documentHeight) &&
  value.documentHeight >= value.viewportHeight;

const isElementMetadata = (
  value: unknown
): value is HtmlCssReviewElementMetadata => {
  if (!isRecord(value)) return false;
  return (
    typeof value.nodeId === "string" &&
    value.nodeId.trim().length > 0 &&
    typeof value.tag === "string" &&
    value.tag.length > 0 &&
    typeof value.textExcerpt === "string" &&
    typeof value.outerHtmlExcerpt === "string" &&
    value.outerHtmlExcerpt.length > 0 &&
    value.outerHtmlExcerpt.length <= HTML_CSS_REVIEW_OUTER_HTML_MAX_LENGTH &&
    isBounds(value.bounds) &&
    isNormalizedCoordinate(value.x) &&
    isNormalizedCoordinate(value.y)
  );
};

export const parseHtmlCssReviewBridgeMessage = (
  value: unknown,
  channelToken: string
): HtmlCssReviewBridgeMessage | null => {
  if (!isRecord(value)) return null;
  if (
    value.type !== HTML_CSS_REVIEW_BRIDGE_MESSAGE ||
    value.channelToken !== channelToken ||
    (value.interaction !== "hover" &&
      value.interaction !== "select" &&
      value.interaction !== "snapshot" &&
      value.interaction !== "viewport")
  ) {
    return null;
  }
  if (value.interaction === "viewport") {
    return isViewport(value.viewport)
      ? (value as unknown as HtmlCssReviewBridgeMessage)
      : null;
  }
  if (value.interaction === "snapshot") {
    if (
      !Array.isArray(value.elements) ||
      !value.elements.every(isElementMetadata)
    ) {
      return null;
    }
    if (
      new Set(value.elements.map((element) => element.nodeId)).size !==
      value.elements.length
    ) {
      return null;
    }
    return value as unknown as HtmlCssReviewBridgeMessage;
  }
  if (value.interaction === "select" && !isElementMetadata(value.element)) {
    return null;
  }
  if (value.element !== null && !isElementMetadata(value.element)) return null;
  return value as unknown as HtmlCssReviewBridgeMessage;
};

export const normalizeHtmlCssReviewText = (text: string): string =>
  text.replace(/\s+/g, " ").trim().slice(0, 120);

const REVIEW_STYLE = `
[data-hh-review-hovered] {
  outline: 2px solid #1976d2 !important;
  outline-offset: 2px !important;
  cursor: pointer !important;
}
`;

export interface HtmlCssReviewRuntime {
  css: string;
  script: string;
}

export const createHtmlCssReviewRuntime = (
  channelToken: string,
  selectionEnabled = true,
  snapshotNodeIds: readonly string[] = []
): HtmlCssReviewRuntime => {
  const serializedToken = JSON.stringify(channelToken);
  const serializedType = JSON.stringify(HTML_CSS_REVIEW_BRIDGE_MESSAGE);
  const serializedSelectionEnabled = JSON.stringify(selectionEnabled);
  const serializedSnapshotNodeIds = JSON.stringify(snapshotNodeIds);
  const serializedExcerptLimit = JSON.stringify(
    HTML_CSS_REVIEW_OUTER_HTML_MAX_LENGTH
  );
  return {
    css: REVIEW_STYLE,
    script: `(function () {
  "use strict";
  var channelToken = ${serializedToken};
  var messageType = ${serializedType};
  var selectionEnabled = ${serializedSelectionEnabled};
  var snapshotNodeIds = ${serializedSnapshotNodeIds};
  var excerptLimit = ${serializedExcerptLimit};
  var hovered = null;
  var updateFrame = null;
  var eligible = function (target) {
    if (!(target instanceof Element)) return null;
    var element = target.closest("[data-hh-id]");
    if (!element) return null;
    var nodeId = element.getAttribute("data-hh-id");
    return nodeId && nodeId.trim() ? element : null;
  };
  var metadata = function (element) {
    var rect = element.getBoundingClientRect();
    var width = Math.max(document.documentElement.clientWidth, 1);
    var height = Math.max(document.documentElement.clientHeight, 1);
    var normalize = function (value) { return Math.min(1, Math.max(0, value)); };
    var clone = element.cloneNode(true);
    clone.removeAttribute("data-hh-review-hovered");
    return {
      nodeId: element.getAttribute("data-hh-id"),
      tag: element.tagName.toLowerCase(),
      textExcerpt: (element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120),
      x: normalize((rect.left + rect.width / 2) / width),
      y: normalize((rect.top + rect.height / 2) / height),
      outerHtmlExcerpt: clone.outerHTML.replace(/\\s+/g, " ").trim().slice(0, excerptLimit),
      bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
    };
  };
  var send = function (interaction, element) {
    parent.postMessage({
      type: messageType,
      channelToken: channelToken,
      interaction: interaction,
      element: element ? metadata(element) : null
    }, "*");
  };
  var sendViewport = function () {
    var root = document.documentElement;
    var body = document.body;
    var viewportWidth = Math.max(root.clientWidth, window.innerWidth || 0, 1);
    var viewportHeight = Math.max(root.clientHeight, window.innerHeight || 0, 1);
    var documentWidth = Math.max(
      root.scrollWidth,
      body ? body.scrollWidth : 0,
      viewportWidth
    );
    var documentHeight = Math.max(
      root.scrollHeight,
      body ? body.scrollHeight : 0,
      viewportHeight
    );
    parent.postMessage({
      type: messageType,
      channelToken: channelToken,
      interaction: "viewport",
      viewport: {
        scrollX: Math.max(window.scrollX || window.pageXOffset || 0, 0),
        scrollY: Math.max(window.scrollY || window.pageYOffset || 0, 0),
        viewportWidth: viewportWidth,
        viewportHeight: viewportHeight,
        documentWidth: documentWidth,
        documentHeight: documentHeight
      }
    }, "*");
  };
  var sendSnapshot = function () {
    var requested = Object.create(null);
    snapshotNodeIds.forEach(function (nodeId) { requested[nodeId] = true; });
    var seen = Object.create(null);
    var elements = [];
    Array.prototype.forEach.call(document.querySelectorAll("[data-hh-id]"), function (element) {
      var nodeId = element.getAttribute("data-hh-id");
      if (!nodeId || !nodeId.trim() || !requested[nodeId] || seen[nodeId]) return;
      seen[nodeId] = true;
      elements.push(metadata(element));
    });
    parent.postMessage({
      type: messageType,
      channelToken: channelToken,
      interaction: "snapshot",
      elements: elements
    }, "*");
  };
  var sendViewportAndSnapshot = function () {
    updateFrame = null;
    sendViewport();
    sendSnapshot();
  };
  var scheduleViewportAndSnapshot = function () {
    if (updateFrame !== null) return;
    updateFrame = requestAnimationFrame(sendViewportAndSnapshot);
  };
  window.addEventListener("scroll", scheduleViewportAndSnapshot);
  window.addEventListener("resize", scheduleViewportAndSnapshot);
  requestAnimationFrame(sendViewportAndSnapshot);
  if (!selectionEnabled) return;
  document.addEventListener("pointerover", function (event) {
    var next = eligible(event.target);
    if (next === hovered) return;
    if (hovered) hovered.removeAttribute("data-hh-review-hovered");
    hovered = next;
    if (hovered) hovered.setAttribute("data-hh-review-hovered", "");
    send("hover", hovered);
  });
  document.addEventListener("pointerout", function (event) {
    if (!hovered || hovered.contains(event.relatedTarget)) return;
    hovered.removeAttribute("data-hh-review-hovered");
    hovered = null;
    send("hover", null);
  });
  document.addEventListener("click", function (event) {
    var element = eligible(event.target);
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    send("select", element);
  });
})();`,
  };
};
