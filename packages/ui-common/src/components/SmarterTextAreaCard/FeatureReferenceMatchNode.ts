import type {
  DOMConversionMap,
  DOMExportOutput,
  EditorConfig,
  LexicalEditor,
  NodeKey,
  SerializedTextNode,
} from "lexical";
import { $applyNodeReplacement, TextNode } from "lexical";
import type {
  FeatureReferenceMatchKind,
  FeatureReferenceMatchRank,
  PassiveReferenceCandidateKey,
} from "../../data/featureReferenceIndex";

const FEATURE_REFERENCE_MATCH_NODE_TYPE = "feature-reference-match" as const;

export class FeatureReferenceMatchNode extends TextNode {
  __candidateKeys: readonly PassiveReferenceCandidateKey[];
  __matchKind: FeatureReferenceMatchKind;
  __matchRank: FeatureReferenceMatchRank;
  __sourceText: string;
  __sourceStyle: string;

  constructor(
    text: string,
    candidateKeys: readonly PassiveReferenceCandidateKey[],
    matchKind: FeatureReferenceMatchKind,
    matchRank: FeatureReferenceMatchRank,
    sourceStyle = "",
    sourceText = text,
    key?: NodeKey,
  ) {
    super(text, key);
    this.__candidateKeys = candidateKeys.map((candidate) => ({ ...candidate }));
    this.__matchKind = matchKind;
    this.__matchRank = matchRank;
    this.__sourceText = sourceText;
    this.__sourceStyle = sourceStyle;
    this.__style = sourceStyle;
  }

  static getType(): string {
    return FEATURE_REFERENCE_MATCH_NODE_TYPE;
  }

  static clone(node: FeatureReferenceMatchNode): FeatureReferenceMatchNode {
    return new FeatureReferenceMatchNode(
      node.__text,
      node.__candidateKeys,
      node.__matchKind,
      node.__matchRank,
      node.__sourceStyle,
      node.__sourceText,
      node.__key,
    );
  }

  static importJSON(
    serializedNode: SerializedTextNode,
  ): FeatureReferenceMatchNode {
    const node = new FeatureReferenceMatchNode(
      serializedNode.text,
      [],
      "exact",
      0,
      serializedNode.style,
      serializedNode.text,
    ).updateFromJSON(serializedNode);
    return node;
  }

  static importDOM(): DOMConversionMap | null {
    return TextNode.importDOM();
  }

  getCandidateKeys(): readonly PassiveReferenceCandidateKey[] {
    return this.getLatest().__candidateKeys;
  }

  getMatchKind(): FeatureReferenceMatchKind {
    return this.getLatest().__matchKind;
  }

  getMatchRank(): FeatureReferenceMatchRank {
    return this.getLatest().__matchRank;
  }

  getSourceText(): string {
    return this.getLatest().__sourceText;
  }

  getSourceStyle(): string {
    return this.getLatest().__sourceStyle;
  }

  createDOM(config: EditorConfig, editor?: LexicalEditor): HTMLElement {
    const element = super.createDOM(config, editor);
    element.classList.add("feature-reference-match-node");
    element.setAttribute("data-testid", "feature-reference-match");
    element.setAttribute("role", "button");
    element.setAttribute("tabindex", "-1");
    element.setAttribute("aria-haspopup", "listbox");
    element.setAttribute("aria-label", `Choose a reference for ${this.__text}`);
    element.style.textDecorationLine = "underline";
    element.style.textDecorationColor =
      "var(--mui-palette-primary-main, rgb(25, 118, 210))";
    element.style.textDecorationThickness = "1px";
    element.style.textUnderlineOffset = "3px";
    return element;
  }

  updateDOM(
    previousNode: this,
    dom: HTMLElement,
    config: EditorConfig,
  ): boolean {
    return super.updateDOM(previousNode, dom, config);
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.textContent = this.getTextContent();
    return { element };
  }

  exportJSON(): SerializedTextNode {
    return {
      ...super.exportJSON(),
      style: this.getSourceStyle(),
      type: "text",
    };
  }
}

export function $createFeatureReferenceMatchNode(
  text: string,
  candidateKeys: readonly PassiveReferenceCandidateKey[],
  matchKind: FeatureReferenceMatchKind,
  matchRank: FeatureReferenceMatchRank,
  sourceStyle = "",
): FeatureReferenceMatchNode {
  return $applyNodeReplacement(
    new FeatureReferenceMatchNode(
      text,
      candidateKeys,
      matchKind,
      matchRank,
      sourceStyle,
      text,
    ),
  );
}

export function $isFeatureReferenceMatchNode(
  node: unknown,
): node is FeatureReferenceMatchNode {
  return node instanceof FeatureReferenceMatchNode;
}
