/**
 * DiffTextNode - Custom Lexical text node for diff highlighting
 * Extends TextNode to support proper styling for system vs user changes
 */

import type { EditorConfig, NodeKey, SerializedTextNode } from "lexical";
import { $applyNodeReplacement, TextNode } from "lexical";

export interface SerializedDiffTextNode extends SerializedTextNode {
  diffType: DiffType;
  source: DiffSource;
}

export type DiffType = "addition" | "deletion" | "replacement" | "equal";
export type DiffSource = "system" | "user";

export class DiffTextNode extends TextNode {
  __diffType: DiffType;
  __source: DiffSource;

  constructor(
    text: string,
    diffType: DiffType = "equal",
    source: DiffSource = "system",
    key?: NodeKey,
  ) {
    super(text, key);
    this.__diffType = diffType;
    this.__source = source;
  }

  static getType(): string {
    return "diff-text";
  }

  static clone(node: DiffTextNode): DiffTextNode {
    return new DiffTextNode(
      node.getTextContent(),
      node.__diffType,
      node.__source,
      node.getKey(),
    );
  }

  getDiffType(): DiffType {
    return this.__diffType;
  }

  getSource(): DiffSource {
    return this.__source;
  }

  setDiffType(diffType: DiffType): void {
    const writable = this.getWritable();
    writable.__diffType = diffType;
  }

  setSource(source: DiffSource): void {
    const writable = this.getWritable();
    writable.__source = source;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);

    // Add diff-specific classes
    element.classList.add("diff-text");
    element.classList.add(`diff-text--${this.__diffType}`);
    element.classList.add(`diff-text--${this.__source}`);

    // Add data attributes for testing and styling
    element.setAttribute("data-diff-type", this.__diffType);
    element.setAttribute("data-diff-source", this.__source);

    return element;
  }

  updateDOM(
    prevNode: DiffTextNode,
    element: HTMLElement,
    config: EditorConfig,
  ): boolean {
    const baseUpdateDOM = TextNode.prototype.updateDOM as (
      this: TextNode,
      prevNode: TextNode,
      element: HTMLElement,
      config: EditorConfig,
    ) => boolean;
    const isUpdated = baseUpdateDOM.call(this, prevNode, element, config);

    // Update diff classes if they changed
    if (
      prevNode.__diffType !== this.__diffType ||
      prevNode.__source !== this.__source
    ) {
      // Remove old classes
      element.classList.remove(`diff-text--${prevNode.__diffType}`);
      element.classList.remove(`diff-text--${prevNode.__source}`);

      // Add new classes
      element.classList.add(`diff-text--${this.__diffType}`);
      element.classList.add(`diff-text--${this.__source}`);

      // Update data attributes
      element.setAttribute("data-diff-type", this.__diffType);
      element.setAttribute("data-diff-source", this.__source);

      return true;
    }

    return isUpdated;
  }

  static importJSON(serializedNode: SerializedDiffTextNode): DiffTextNode {
    const { text, diffType, source } = serializedNode;
    const node = $createDiffTextNode(text, diffType, source);
    node.setFormat(serializedNode.format);
    node.setDetail(serializedNode.detail);
    node.setMode(serializedNode.mode);
    node.setStyle(serializedNode.style);
    return node;
  }

  exportJSON(): SerializedDiffTextNode {
    return {
      ...super.exportJSON(),
      type: "diff-text",
      diffType: this.__diffType,
      source: this.__source,
    };
  }
}

export function $createDiffTextNode(
  text: string,
  diffType: DiffType = "equal",
  source: DiffSource = "system",
): DiffTextNode {
  return $applyNodeReplacement(
    new DiffTextNode(text, diffType, source),
  ) as DiffTextNode;
}
