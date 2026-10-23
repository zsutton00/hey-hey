import { HTML_CSS_REPORT_THEME } from "./htmlCssReportTheme";

const SKETCH_FONT =
  "data:font/woff2;base64,d09GMgABAAAAAApQAAoAAAAAE3gAAAn2AAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export const HTML_CSS_PRESENTATION_STYLES = ["modern", "sketch"] as const;
export type HtmlCssPresentationStyle =
  (typeof HTML_CSS_PRESENTATION_STYLES)[number];

export const HTML_CSS_PRESENTATION_STYLE_LABELS: Record<
  HtmlCssPresentationStyle,
  string
> = {
  modern: "Modern",
  sketch: "Sketch",
};

/**
 * Every host theme the isolated document can apply before authored CSS. Only
 * the presentation styles are user-selectable for work items; `report` is the
 * host theme for project report documents.
 */
export type HtmlCssHostTheme = HtmlCssPresentationStyle | "report";

export const DEFAULT_HTML_CSS_PRESENTATION_STYLE: HtmlCssPresentationStyle =
  "modern";

export const HTML_CSS_MODERN_THEME = `
:root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; background: #f4f6fb; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; line-height: 1.5; }
button, input, textarea, select { font: inherit; color: inherit; }
`;

export const HTML_CSS_SKETCH_THEME = `
@font-face { font-family: "Hey Hey Sketch"; src: url("${SKETCH_FONT}") format("woff2"); font-display: swap; }
:root { color-scheme: light; font-family: "Hey Hey Sketch", "Comic Sans MS", cursive !important; color: #302e2a; background: #f3efe4; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; line-height: 1.5; letter-spacing: .015em; background-color: #f3efe4 !important; background-image: none !important; }
h1, h2, h3, h4, h5, h6 { width: fit-content; margin-block: .8em .45em; color: #302e2a !important; font-family: inherit !important; line-height: 1.15; letter-spacing: .025em; text-decoration-line: underline !important; text-decoration-style: wavy !important; text-decoration-color: #8c8272 !important; text-decoration-thickness: 2px !important; text-underline-offset: 6px !important; }
a { color: #625b50; text-decoration-line: underline; text-decoration-style: wavy; text-decoration-thickness: 1.5px; text-underline-offset: 3px; }
.button, button, input, textarea, select { font-family: inherit !important; color: #302e2a !important; border: 1.5px solid #46423a !important; border-radius: 130px 13px 116px 12px / 12px 116px 13px 130px !important; background-color: #fbf8ef !important; background-image: none !important; padding: 8px 12px; outline: none; }
input, textarea, select { box-shadow: inset 1px 1px 0 #d7d0c1 !important; }
.button, button { cursor: default; background-color: #e7e0d2 !important; box-shadow: 1px 2px 0 #777064 !important; }
button:active { box-shadow: 1px 1px 0 #777064; transform: translate(1px, 2px); }
.card, .panel, .drop-zone, [data-sketch-card] { background-color: #fbf8ef !important; background-image: none !important; border: 1.5px solid #46423a !important; border-radius: 65px 13px 58px 14px / 12px 57px 15px 61px !important; box-shadow: 2px 2px 0 #c9c1b2 !important; }
.workspace { background-color: #eee9dd !important; background-image: none !important; border: 1.5px solid #59544b !important; border-radius: 20px 9px 17px 10px / 9px 18px 11px 17px !important; box-shadow: 2px 3px 0 #bdb5a6 !important; }
.tabs, [data-sketch-tabs] { display: flex; align-items: flex-end; gap: 5px; border-bottom: 2px solid #59544b; }
.tab, [data-sketch-tab] { margin-bottom: -2px; padding: 7px 12px; background: #ddd6c8; border: 2px solid #59544b; border-bottom-color: #59544b; border-radius: 46px 12px 0 0 / 11px 41px 0 0; }
.tab[aria-selected="true"], [data-sketch-tab][aria-selected="true"] { background: #fbf8ef; border-bottom-color: #fbf8ef; }
hr, .separator, [data-sketch-separator] { height: 3px; margin-block: 20px; border: 0; background: linear-gradient(175deg, transparent 0 18%, #8c8272 20% 48%, transparent 50% 58%, #8c8272 60% 76%, transparent 78%); }
`;

const escapeStyleEnd = (css: string): string =>
  css.replace(/<\/style/gi, "<\\/style");

const escapeHtml = (html: string): string =>
  html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const BLOCKED_ELEMENTS =
  "base,embed,frame,frameset,iframe,link,meta,noscript,object,portal,script,template";
const URL_ATTRIBUTES = new Set([
  "action",
  "background",
  "cite",
  "data",
  "formaction",
  "href",
  "manifest",
  "ping",
  "poster",
  "src",
  "srcdoc",
  "srcset",
  "xlink:href",
]);

export const sanitizeHtmlCssSectionHtml = (html: string): string => {
  if (typeof DOMParser === "undefined") {
    return escapeHtml(html);
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll(BLOCKED_ELEMENTS).forEach((element) => {
    element.remove();
  });
  document.querySelectorAll("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        URL_ATTRIBUTES.has(name) ||
        name === "target" ||
        name.startsWith("on")
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  });

  return document.body.innerHTML;
};

const HTML_CSS_HOST_THEMES: Record<HtmlCssHostTheme, string> = {
  modern: HTML_CSS_MODERN_THEME,
  sketch: HTML_CSS_SKETCH_THEME,
  report: HTML_CSS_REPORT_THEME,
};

const buildContentSecurityPolicy = (scriptNonce?: string): string =>
  `default-src 'none'; script-src ${
    scriptNonce ? `'nonce-${scriptNonce}'` : "'none'"
  }; style-src 'unsafe-inline'; font-src data:; img-src data:; media-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; navigate-to 'none'`;

export interface HtmlCssHostRuntime {
  nonce: string;
  css: string;
  script: string;
}

const buildHtmlCssDocumentContent = (
  html: string,
  css: string,
  presentationStyle: HtmlCssHostTheme,
  runtime?: HtmlCssHostRuntime
): string =>
  `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${buildContentSecurityPolicy(
    runtime?.nonce
  )}"><style data-host-theme="${presentationStyle}">${
    HTML_CSS_HOST_THEMES[presentationStyle]
  }</style><style data-authored-css>${escapeStyleEnd(css)}</style>${
    runtime ? `<style data-host-review>${runtime.css}</style>` : ""
  }</head><body>${sanitizeHtmlCssSectionHtml(html)}${
    runtime
      ? `<script nonce="${runtime.nonce}" data-host-review>${runtime.script}</script>`
      : ""
  }</body></html>`;

export const buildHtmlCssDocument = (
  html: string,
  css: string,
  presentationStyle: HtmlCssHostTheme
): string => buildHtmlCssDocumentContent(html, css, presentationStyle);

export const buildHtmlCssReviewDocument = (
  html: string,
  css: string,
  presentationStyle: HtmlCssHostTheme,
  runtime: HtmlCssHostRuntime
): string => buildHtmlCssDocumentContent(html, css, presentationStyle, runtime);
