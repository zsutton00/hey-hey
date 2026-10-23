import type {
  DOMConversionMap,
  DOMExportOutput,
  EditorConfig,
  NodeKey,
} from "lexical";
import { $applyNodeReplacement, DecoratorNode } from "lexical";
import React from "react";
import {
  fileReferenceLabel,
  parseFileReferenceMarkdownParts,
  fileReferenceDestination,
} from "./fileReferenceMarkdown";
import type {
  FileReferenceValueV1,
  SerializedFileReferenceNode,
} from "./types";
import { FileReferenceLink } from "./FileReferenceLink";

const createFileReferenceElement = (
  value: FileReferenceValueV1
): HTMLSpanElement => {
  const span = document.createElement("span");
  span.className = "file-reference-node";
  span.setAttribute("data-service-id", value.serviceId);
  span.setAttribute("data-normalized-path", value.normalizedPath);
  span.setAttribute("data-service-name", value.serviceName);
  span.setAttribute("contenteditable", "false");
  return span;
};

export class FileReferenceNode extends DecoratorNode<React.ReactNode> {
  __fileReference: FileReferenceValueV1;

  constructor(fileReference: FileReferenceValueV1, key?: NodeKey) {
    super(key);
    this.__fileReference = fileReference;
  }

  static getType(): string {
    return "file-reference";
  }

  static clone(node: FileReferenceNode): FileReferenceNode {
    return new FileReferenceNode(node.__fileReference, node.getKey());
  }

  static importDOM(): DOMConversionMap {
    return {
      span: (element) => {
        if (!element.classList.contains("file-reference-node")) return null;

        const serviceId = element.getAttribute("data-service-id");
        const serviceName = element.getAttribute("data-service-name");
        const normalizedPath = element.getAttribute("data-normalized-path");
        if (!serviceId || !serviceName || !normalizedPath) return null;

        return {
          conversion: () => ({
            node: new FileReferenceNode({
              version: 1,
              serviceId,
              serviceName,
              normalizedPath,
            }),
          }),
          priority: 1,
        };
      },
      a: (element) => {
        const value = parseFileReferenceMarkdownParts(
          element.textContent ?? "",
          element.getAttribute("href") ?? ""
        );
        if (!value) return null;
        return {
          conversion: () => ({ node: new FileReferenceNode(value) }),
          priority: 2,
        };
      },
    };
  }

  getFileReference(): FileReferenceValueV1 {
    return this.__fileReference;
  }

  getTextContent(): string {
    return fileReferenceLabel(this.__fileReference);
  }

  isInline(): boolean {
    return true;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    return createFileReferenceElement(this.__fileReference);
  }

  updateDOM(): false {
    return false;
  }

  decorate(): React.ReactNode {
    return <FileReferenceLink value={this.__fileReference} />;
  }

  exportDOM(): DOMExportOutput {
    const anchor = document.createElement("a");
    anchor.href = fileReferenceDestination(this.__fileReference);
    anchor.textContent = fileReferenceLabel(this.__fileReference);
    return { element: anchor };
  }

  static importJSON(
    serializedNode: SerializedFileReferenceNode
  ): FileReferenceNode {
    return new FileReferenceNode(serializedNode.fileReference);
  }

  exportJSON(): SerializedFileReferenceNode {
    return {
      type: "file-reference",
      version: 1,
      fileReference: this.__fileReference,
    };
  }
}

export const $createFileReferenceNode = (
  fileReference: FileReferenceValueV1
): FileReferenceNode =>
  $applyNodeReplacement(new FileReferenceNode(fileReference));

export const $isFileReferenceNode = (
  node: unknown
): node is FileReferenceNode => node instanceof FileReferenceNode;
