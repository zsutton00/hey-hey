import type { HtmlCssHostRuntime } from "../../shared/htmlCssSketchTheme";
import type { EntityMention } from "../../SmarterTextAreaCard/types";
import { isProjectReportMentionTarget } from "./projectReportMentions";

const PROJECT_REPORT_CITATION_MESSAGE = "hey-hey-project-report-citation";
const PROJECT_REPORT_HEIGHT_MESSAGE = "hey-hey-project-report-height";
const PROJECT_REPORT_MENTION_MESSAGE = "hey-hey-project-report-mention";

const serializeScriptData = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

/**
 * Host-owned runtime for the isolated report document. It activates resolved
 * citations and host-rewritten entity mention links, hides a leading authored heading that repeats the host title, and
 * reports the document's full height so the host can size the frame to its
 * content (the frame never scrolls internally).
 */
export const createProjectReportCitationRuntime = (
  nonce: string,
  channelToken: string,
  evidenceKeys: string[],
  hostTitle: string,
): HtmlCssHostRuntime => ({
  nonce,
  css: '[data-evidence-key][role="button"] { cursor: pointer; } html, body { height: auto !important; max-height: none !important; overflow-y: hidden !important; } [data-host-duplicate-title] { display: none !important; } a.hh-mention[data-entity-type][data-entity-id] { cursor: pointer; }',
  script: `(() => {
    const keys = new Set(${serializeScriptData(evidenceKeys)});
    const token = ${serializeScriptData(channelToken)};
    const normalize = value => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const hostTitle = normalize(${serializeScriptData(hostTitle)});
    const heading = document.body && document.body.querySelector('h1, h2');
    if (heading && hostTitle && normalize(heading.textContent) === hostTitle) {
      heading.setAttribute('data-host-duplicate-title', '');
    }
    const selector = '[data-evidence-key]';
    document.querySelectorAll(selector).forEach(element => {
      if (!keys.has(element.getAttribute('data-evidence-key'))) return;
      element.setAttribute('role', 'button');
      element.setAttribute('tabindex', '0');
      element.removeAttribute('disabled');
      element.removeAttribute('aria-disabled');
    });
    const mentionSelector = 'a.hh-mention[data-entity-type][data-entity-id]';
    document.querySelectorAll(mentionSelector).forEach(element => {
      element.setAttribute('role', 'link');
      element.setAttribute('tabindex', '0');
    });
    const activate = event => {
      const target = event.target instanceof Element ? event.target : null;
      const mention = target ? target.closest(mentionSelector) : null;
      if (mention) {
        event.preventDefault();
        parent.postMessage({
          type: '${PROJECT_REPORT_MENTION_MESSAGE}',
          channelToken: token,
          entityType: mention.getAttribute('data-entity-type'),
          entityId: mention.getAttribute('data-entity-id'),
          entityName: mention.textContent || '',
        }, '*');
        return;
      }
      const element = target ? target.closest(selector) : null;
      if (!element) return;
      event.preventDefault();
      const key = element.getAttribute('data-evidence-key');
      if (!keys.has(key)) return;
      parent.postMessage({ type: '${PROJECT_REPORT_CITATION_MESSAGE}', channelToken: token, key }, '*');
    };
    document.addEventListener('click', activate);
    document.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) activate(event);
    });
    let lastHeight = -1;
    const reportHeight = () => {
      const root = document.documentElement;
      // root.scrollHeight is clamped up to the frame's own height, so it would
      // never let the frame shrink; measure the content instead.
      const height = Math.ceil(Math.max(root.getBoundingClientRect().height, document.body ? document.body.scrollHeight : 0));
      if (height === lastHeight) return;
      lastHeight = height;
      parent.postMessage({ type: '${PROJECT_REPORT_HEIGHT_MESSAGE}', channelToken: token, height }, '*');
    };
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(reportHeight);
      observer.observe(document.documentElement);
      if (document.body) observer.observe(document.body);
    }
    if (typeof addEventListener === 'function') {
      addEventListener('load', reportHeight);
      addEventListener('resize', reportHeight);
    }
    reportHeight();
  })();`,
});

const readChannelMessage = (
  value: unknown,
  type: string,
  channelToken: string,
): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) return null;
  const message = value as Record<string, unknown>;
  if (message.type !== type || message.channelToken !== channelToken)
    return null;
  return message;
};

export const readProjectReportCitationKey = (
  value: unknown,
  channelToken: string,
): string | null => {
  const message = readChannelMessage(
    value,
    PROJECT_REPORT_CITATION_MESSAGE,
    channelToken,
  );
  return message && typeof message.key === "string" ? message.key : null;
};

export const readProjectReportMention = (
  value: unknown,
  channelToken: string,
): EntityMention | null => {
  const message = readChannelMessage(
    value,
    PROJECT_REPORT_MENTION_MESSAGE,
    channelToken,
  );
  if (
    !message ||
    !isProjectReportMentionTarget(message.entityType, message.entityId) ||
    typeof message.entityName !== "string"
  )
    return null;
  return {
    entityType: message.entityType as string,
    entityId: message.entityId as string,
    entityName: message.entityName,
  };
};

export const readProjectReportHeight = (
  value: unknown,
  channelToken: string,
): number | null => {
  const message = readChannelMessage(
    value,
    PROJECT_REPORT_HEIGHT_MESSAGE,
    channelToken,
  );
  if (!message || typeof message.height !== "number") return null;
  return Number.isFinite(message.height) && message.height > 0
    ? message.height
    : null;
};
