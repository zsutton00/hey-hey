import type {
  DOMConversionMap,
  DOMExportOutput,
  EditorConfig,
  NodeKey,
} from "lexical";
import { $applyNodeReplacement, DecoratorNode } from "lexical";
import React from "react";
import { formatMention } from "../../utils/mentionFormatting";
import type { EntityMention, SerializedMentionNode } from "./types";
import { MentionBadgeInner } from "./MentionBadge";

function createMentionElement(mention: EntityMention): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "mention-node";
  span.setAttribute("data-entity-type", mention.entityType);
  span.setAttribute("data-entity-id", mention.entityId);
  span.setAttribute("contenteditable", "false");
  return span;
}

export class MentionNode extends DecoratorNode<React.ReactNode> {
  __mention: EntityMention;

  constructor(mention: EntityMention, key?: NodeKey) {
    super(key);
    this.__mention = mention;
  }

  static getType(): string {
    return "mention";
  }

  static clone(node: MentionNode): MentionNode {
    return new MentionNode(node.__mention, node.getKey());
  }

  static importDOM(): DOMConversionMap {
    return {
      span: (element) => {
        const entityType = element.getAttribute("data-entity-type");
        const entityId = element.getAttribute("data-entity-id");
        const entityName = element.textContent;

        if (
          !element.classList.contains("mention-node") ||
          !entityType ||
          !entityId ||
          !entityName
        ) {
          return null;
        }

        return {
          conversion: () => ({
            node: new MentionNode({ entityType, entityId, entityName }),
          }),
          priority: 1,
        };
      },
    };
  }

  getMention(): EntityMention {
    return this.__mention;
  }

  getTextContent(): string {
    return formatMention(this.__mention);
  }

  createDOM(_config: EditorConfig): HTMLElement {
    return createMentionElement(this.__mention);
  }

  updateDOM(): false {
    return false;
  }

  decorate(): React.ReactNode {
    return <MentionBadgeInner mention={this.__mention} />;
  }

  exportDOM(): DOMExportOutput {
    const element = createMentionElement(this.__mention);
    element.textContent = this.__mention.entityName;
    return { element };
  }

  static importJSON(serializedNode: SerializedMentionNode): MentionNode {
    return new MentionNode(serializedNode.mention);
  }

  exportJSON(): SerializedMentionNode {
    return {
      type: "mention",
      version: 1,
      mention: this.__mention,
    };
  }
}

export function $createMentionNode(mention: EntityMention): MentionNode {
  return $applyNodeReplacement(new MentionNode(mention));
}

export function $isMentionNode(node: unknown): node is MentionNode {
  return node instanceof MentionNode;
}
