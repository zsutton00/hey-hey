import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  createEditor,
} from "lexical";
import {
  $createFileReferenceNode,
  $isFileReferenceNode,
  FileReferenceNode,
} from "../fileReferences/FileReferenceNode";
import { $replaceRangeWithFileReference } from "../fileReferences/fileReferenceInsertion";
import type { FileReferenceValueV1 } from "../fileReferences/types";
import { FileReferenceLink } from "../fileReferences/FileReferenceLink";
import { isValidElement, type ReactNode } from "react";

const value: FileReferenceValueV1 = {
  version: 1,
  serviceId: "service-1",
  serviceName: "UI Common",
  normalizedPath: "src/components/Editor.tsx",
};

const createTestEditor = () =>
  createEditor({
    namespace: "FileReferenceNodeTest",
    nodes: [FileReferenceNode],
    onError: (error) => {
      throw error;
    },
  });

describe("FileReferenceNode", () => {
  it("preserves the complete typed value in Lexical JSON", () => {
    const editor = createTestEditor();
    let serialized: ReturnType<FileReferenceNode["exportJSON"]> | null = null;

    editor.update(() => {
      serialized = $createFileReferenceNode(value).exportJSON();
    });

    expect(serialized).toEqual({
      type: "file-reference",
      version: 1,
      fileReference: value,
    });
  });

  it("decorates with the reusable mapped file-reference renderer", () => {
    const editor = createTestEditor();
    let decoration: ReactNode = null;

    editor.update(() => {
      decoration = $createFileReferenceNode(value).decorate();
    });

    expect(isValidElement<{ value: FileReferenceValueV1 }>(decoration)).toBe(
      true
    );
    if (!isValidElement<{ value: FileReferenceValueV1 }>(decoration)) return;

    expect(decoration.type).toBe(FileReferenceLink);
    expect(decoration.props).toEqual({ value });
  });

  it("replaces the retained @query, preserves suffix text, and selects after one space", () => {
    const editor = createTestEditor();
    let inserted = false;

    editor.update(() => {
      const text = $createTextNode("Before @src after");
      $getRoot().append($createParagraphNode().append(text));
      inserted = $replaceRangeWithFileReference(
        {
          nodeKey: text.getKey(),
          sliceStart: 7,
          cursorOffset: 11,
        },
        "src",
        value
      );

      expect($getRoot().getTextContent()).toBe(
        "Before $UI Common/src/components/Editor.tsx after"
      );
      expect($getSelection()?.getTextContent()).toBe("");
      expect($getSelection()?.anchor.offset).toBe(1);
    });

    expect(inserted).toBe(true);
  });

  it("refuses a stale range whose query no longer matches", () => {
    const editor = createTestEditor();
    let inserted = true;

    editor.update(() => {
      const text = $createTextNode("@different");
      $getRoot().append($createParagraphNode().append(text));
      inserted = $replaceRangeWithFileReference(
        {
          nodeKey: text.getKey(),
          sliceStart: 0,
          cursorOffset: 4,
        },
        "src",
        value
      );
      expect($isFileReferenceNode($getRoot().getFirstDescendant())).toBe(false);
    });

    expect(inserted).toBe(false);
  });
});
