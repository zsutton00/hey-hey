import React, { useCallback } from "react";

const MENTION_SELECTOR = "[data-mention-token]";

export interface MentionCopyBoundaryProps {
  children: React.ReactNode;
  component?: "div" | "span";
}

interface MentionClipboardContent {
  html: string;
  text: string;
}

const rangeContainsMention = (range: Range, boundary: HTMLElement): boolean =>
  Array.from(boundary.querySelectorAll<HTMLElement>(MENTION_SELECTOR)).some(
    (mentionElement) => range.intersectsNode(mentionElement)
  );

const createReadableMentionElement = (
  mentionElement: HTMLElement
): HTMLSpanElement | null => {
  const token = mentionElement.dataset.mentionToken;
  const entityType = mentionElement.dataset.entityType;
  const entityId = mentionElement.dataset.entityId;
  const entityName = mentionElement.dataset.entityName;

  if (!token || !entityType || !entityId || !entityName) {
    return null;
  }

  const readableMention = document.createElement("span");
  readableMention.className = "mention-node";
  readableMention.dataset.mentionToken = token;
  readableMention.dataset.entityType = entityType;
  readableMention.dataset.entityId = entityId;
  readableMention.dataset.entityName = entityName;
  readableMention.contentEditable = "false";
  readableMention.textContent = entityName;
  return readableMention;
};

const normalizeMentionMarkup = (fragment: DocumentFragment): HTMLDivElement => {
  const container = document.createElement("div");
  container.append(fragment);

  container
    .querySelectorAll<HTMLElement>(MENTION_SELECTOR)
    .forEach((mentionElement) => {
      const readableMention = createReadableMentionElement(mentionElement);
      if (readableMention) {
        mentionElement.replaceWith(readableMention);
      }
    });

  return container;
};

const createClipboardContent = (range: Range): MentionClipboardContent => {
  const htmlContainer = normalizeMentionMarkup(range.cloneContents());
  const textContainer = htmlContainer.cloneNode(true) as HTMLDivElement;

  textContainer
    .querySelectorAll<HTMLElement>(MENTION_SELECTOR)
    .forEach((mentionElement) => {
      mentionElement.replaceWith(
        document.createTextNode(mentionElement.dataset.mentionToken ?? "")
      );
    });

  return {
    html: htmlContainer.innerHTML,
    text: textContainer.textContent ?? "",
  };
};

export const MentionCopyBoundary: React.FC<MentionCopyBoundaryProps> = ({
  children,
  component: Component = "div",
}) => {
  const handleCopy = useCallback((event: React.ClipboardEvent<HTMLElement>) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!rangeContainsMention(range, event.currentTarget)) {
      return;
    }

    const clipboardContent = createClipboardContent(range);
    event.clipboardData.setData("text/plain", clipboardContent.text);
    event.clipboardData.setData("text/html", clipboardContent.html);
    event.preventDefault();
  }, []);

  return (
    <Component
      data-testid="mention-copy-boundary"
      onCopy={handleCopy}
      style={{ display: "contents" }}
    >
      {children}
    </Component>
  );
};
