import {
  $applyNodeReplacement,
  TextNode,
  type EditorConfig,
  type NodeKey,
  type SerializedTextNode,
} from "lexical";

/** The text is the original source spelling, including delimiter whitespace. */
export class TemplateSubstitutionNode extends TextNode {
  static getType(): string {
    return "template-substitution";
  }
  static clone(node: TemplateSubstitutionNode): TemplateSubstitutionNode {
    return new TemplateSubstitutionNode(node.__text, node.__key);
  }
  constructor(text: string, key?: NodeKey) {
    super(text, key);
  }
  static importJSON(serialized: SerializedTextNode): TemplateSubstitutionNode {
    return $createTemplateSubstitutionNode(serialized.text).updateFromJSON(
      serialized
    );
  }
  exportJSON(): SerializedTextNode {
    return { ...super.exportJSON(), type: "template-substitution", version: 1 };
  }
  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    element.setAttribute("data-testid", "template-substitution");
    element.setAttribute("data-source", this.getTextContent());
    return element;
  }
  isTextEntity(): true {
    return true;
  }
  canInsertTextBefore(): false {
    return false;
  }
  canInsertTextAfter(): false {
    return false;
  }
}
export function $createTemplateSubstitutionNode(
  source: string
): TemplateSubstitutionNode {
  return $applyNodeReplacement(new TemplateSubstitutionNode(source)).setMode(
    "token"
  );
}
