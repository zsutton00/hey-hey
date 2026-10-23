import type { EntityMention } from "../../SmarterTextAreaCard/types";
import { splitContentByMentions } from "../../../utils/mentionFormatting";

const PROJECT_REPORT_MENTION_CLASS = "hh-mention";
const PROJECT_REPORT_MENTION_TYPE_ATTRIBUTE = "data-entity-type";
const PROJECT_REPORT_MENTION_ID_ATTRIBUTE = "data-entity-id";

const ENTITY_TYPE_PATTERN = /^[a-zA-Z0-9_-]+$/;
const ENTITY_ID_PATTERN = /^[a-z0-9_-]+$/;

/** Mention token grammar, re-checked on every message from the frame. */
export const isProjectReportMentionTarget = (
  entityType: unknown,
  entityId: unknown,
): boolean =>
  typeof entityType === "string" &&
  typeof entityId === "string" &&
  ENTITY_TYPE_PATTERN.test(entityType) &&
  ENTITY_ID_PATTERN.test(entityId);

const createMentionLink = (
  document: Document,
  mention: EntityMention,
): HTMLAnchorElement => {
  const link = document.createElement("a");
  link.className = PROJECT_REPORT_MENTION_CLASS;
  link.setAttribute(PROJECT_REPORT_MENTION_TYPE_ATTRIBUTE, mention.entityType);
  link.setAttribute(PROJECT_REPORT_MENTION_ID_ATTRIBUTE, mention.entityId);
  // textContent keeps the title as text; serialization escapes it.
  link.textContent = mention.entityName;
  return link;
};

/**
 * Rewrites `@[type:id|title]` tokens in the authored body's text nodes into
 * host mention links. Attribute values are never rewritten, and authored
 * `data-entity-*` attributes are removed so only host-created links navigate.
 * Links are built from the token alone; nothing is fetched per mention.
 */
export const rewriteProjectReportMentions = (html: string): string => {
  if (typeof DOMParser === "undefined") return html;
  // Nothing to rewrite or strip: keep the authored string byte-for-byte.
  if (
    !html.includes("@[") &&
    !html.includes("@\\[") &&
    !html.includes("data-entity-")
  )
    return html;
  const document = new DOMParser().parseFromString(html, "text/html");
  document
    .querySelectorAll(
      `[${PROJECT_REPORT_MENTION_TYPE_ATTRIBUTE}], [${PROJECT_REPORT_MENTION_ID_ATTRIBUTE}]`,
    )
    .forEach((element) => {
      element.removeAttribute(PROJECT_REPORT_MENTION_TYPE_ATTRIBUTE);
      element.removeAttribute(PROJECT_REPORT_MENTION_ID_ATTRIBUTE);
    });

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    // Raw-text elements are not rendered text; an authored link cannot nest one.
    if (parent?.closest("style, script, textarea, a")) continue;
    textNodes.push(node as Text);
  }

  for (const textNode of textNodes) {
    const segments = splitContentByMentions(textNode.data, {
      allowMentionEscapes: true,
    });
    if (!segments.some((segment) => segment.type === "mention")) continue;
    const fragment = document.createDocumentFragment();
    for (const segment of segments) {
      fragment.append(
        segment.type === "mention"
          ? createMentionLink(document, segment.mention)
          : segment.text,
      );
    }
    textNode.replaceWith(fragment);
  }

  return document.body.innerHTML;
};
