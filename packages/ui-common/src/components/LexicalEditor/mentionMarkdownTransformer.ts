import type { TextMatchTransformer, Transformer } from "@lexical/markdown";
import type { ElementNode, LexicalNode, TextNode } from "lexical";
import {
  $createMentionNode,
  $isMentionNode,
  MentionNode,
} from "../SmarterTextAreaCard/MentionNode";
import {
  formatMention,
  MENTION_TOKEN_SINGLE_REGEX,
} from "../../utils/mentionFormatting";

const MENTION_IMPORT_REGEX = MENTION_TOKEN_SINGLE_REGEX;
const MENTION_SHORTCUT_REGEX = new RegExp(
  MENTION_TOKEN_SINGLE_REGEX.source + "$"
);

export const MENTION_MARKDOWN_TRANSFORMER: TextMatchTransformer = {
  dependencies: [MentionNode],
  type: "text-match",
  trigger: "]",
  importRegExp: MENTION_IMPORT_REGEX,
  regExp: MENTION_SHORTCUT_REGEX,
  export: (
    node: LexicalNode,
    _exportChildren: (node: ElementNode) => string,
    _exportFormat: (node: TextNode, textContent: string) => string
  ): string | null => {
    if (!$isMentionNode(node)) {
      return null;
    }

    return formatMention(node.getMention());
  },
  replace: (textNode, match) => {
    const entityType = match[1];
    const entityId = match[2];
    const entityName = match[3];
    if (!entityType || !entityId || !entityName) {
      return;
    }

    textNode.replace(
      $createMentionNode({
        entityType,
        entityId,
        entityName,
      })
    );
  },
};

export const buildMentionAwareTransformers = (
  baseTransformers: Transformer[]
): Transformer[] => [MENTION_MARKDOWN_TRANSFORMER, ...baseTransformers];
