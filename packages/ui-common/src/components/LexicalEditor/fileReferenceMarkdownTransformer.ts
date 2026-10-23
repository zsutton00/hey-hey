import type { TextMatchTransformer, Transformer } from "@lexical/markdown";
import type { ElementNode, LexicalNode, TextNode } from "lexical";
import {
  $createFileReferenceNode,
  $isFileReferenceNode,
  FileReferenceNode,
} from "../SmarterTextAreaCard/fileReferences/FileReferenceNode";
import {
  parseFileReferenceMarkdownParts,
  serializeFileReferenceMarkdown,
} from "../SmarterTextAreaCard/fileReferences/fileReferenceMarkdown";

const FILE_REFERENCE_IMPORT_REGEX =
  /\[((?:\\.|[^\]])+)\]\((heyhey-file:v1:[^()\s]+)\)/;
const FILE_REFERENCE_SHORTCUT_REGEX = new RegExp(
  `${FILE_REFERENCE_IMPORT_REGEX.source}$`
);

export const FILE_REFERENCE_MARKDOWN_TRANSFORMER: TextMatchTransformer = {
  dependencies: [FileReferenceNode],
  type: "text-match",
  trigger: ")",
  importRegExp: FILE_REFERENCE_IMPORT_REGEX,
  regExp: FILE_REFERENCE_SHORTCUT_REGEX,
  export: (
    node: LexicalNode,
    _exportChildren: (node: ElementNode) => string,
    _exportFormat: (node: TextNode, textContent: string) => string
  ): string | null => {
    if (!$isFileReferenceNode(node)) return null;
    return serializeFileReferenceMarkdown(node.getFileReference());
  },
  replace: (textNode, match) => {
    const label = match[1];
    const destination = match[2];
    if (!label || !destination) return;

    const value = parseFileReferenceMarkdownParts(label, destination);
    if (!value) return;
    textNode.replace($createFileReferenceNode(value));
  },
};

export const buildFileReferenceAwareTransformers = (
  baseTransformers: Transformer[]
): Transformer[] => [FILE_REFERENCE_MARKDOWN_TRANSFORMER, ...baseTransformers];
