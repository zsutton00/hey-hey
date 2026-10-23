import type { LexicalNode } from "lexical";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  type ElementNode,
} from "lexical";
import type { EntityMention } from "./types";
import { $createMentionNode, $isMentionNode } from "./MentionNode";
import {
  extractMentions,
  formatMention,
  MENTION_TOKEN_REGEX,
} from "../../utils/mentionFormatting";

export { formatMention } from "../../utils/mentionFormatting";

export function loadContentWithMentions(content: string): void {
  const root = $getRoot();
  root.clear();

  if (!content) {
    root.append($createParagraphNode());
    return;
  }

  const normalizedContent = content.replace(/\r\n?/g, "\n");
  const mentions = extractMentions(normalizedContent);

  for (const paragraphContent of normalizedContent.split("\n\n")) {
    const paragraph = $createParagraphNode();
    appendContentWithMentions(paragraph, paragraphContent, mentions);
    root.append(paragraph);
  }
}

function appendContentWithMentions(
  paragraph: ElementNode,
  content: string,
  mentions: EntityMention[]
): void {
  let lastIndex = 0;
  const tokenRegex = new RegExp(MENTION_TOKEN_REGEX.source, "g");
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      appendTextWithLineBreaks(
        paragraph,
        content.substring(lastIndex, match.index)
      );
    }

    const matchedEntityId = match[2];
    const parsedMention = mentions.find(
      (mention) => mention.entityId === matchedEntityId
    );
    if (parsedMention) {
      paragraph.append($createMentionNode(parsedMention));
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < content.length) {
    appendTextWithLineBreaks(paragraph, content.substring(lastIndex));
  }
}

function appendTextWithLineBreaks(
  paragraph: ElementNode,
  content: string
): void {
  const lines = content.split("\n");

  lines.forEach((line, index) => {
    if (line) {
      paragraph.append($createTextNode(line));
    }

    if (index < lines.length - 1) {
      paragraph.append($createLineBreakNode());
    }
  });
}

export function serializeEditorState(excludedNodeKey?: string): string {
  const root = $getRoot();
  const paragraphs: string[] = [];

  root.getChildren().forEach((child: LexicalNode) => {
    if ($isElementNode(child) && child.getType() === "paragraph") {
      const parts: string[] = [];
      child.getChildren().forEach((node: LexicalNode) => {
        if (node.getKey() === excludedNodeKey) return;
        parts.push(serializeNode(node));
      });
      paragraphs.push(parts.join(""));
    }
  });

  return serializeParagraphs(paragraphs);
}

interface CodeFence {
  marker: "`" | "~";
  length: number;
}

function serializeParagraphs(paragraphs: string[]): string {
  let content = "";
  let codeFence: CodeFence | null = null;

  paragraphs.forEach((paragraph, index) => {
    if (index > 0) {
      content += codeFence ? "\n" : "\n\n";
    }

    content += paragraph;
    codeFence = updateCodeFence(codeFence, paragraph);
  });

  return content;
}

function updateCodeFence(
  initialFence: CodeFence | null,
  content: string
): CodeFence | null {
  let codeFence = initialFence;

  for (const line of content.split("\n")) {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!delimiter) continue;

    const marker = delimiter[1][0] as CodeFence["marker"];
    const length = delimiter[1].length;

    if (codeFence) {
      if (
        marker === codeFence.marker &&
        length >= codeFence.length &&
        /^[ \t]*$/.test(delimiter[2])
      ) {
        codeFence = null;
      }
    } else {
      codeFence = { marker, length };
    }
  }

  return codeFence;
}

function serializeNode(node: LexicalNode): string {
  if ($isMentionNode(node)) {
    return formatMention(node.getMention());
  }

  const text = node.getTextContent();
  return text;
}
