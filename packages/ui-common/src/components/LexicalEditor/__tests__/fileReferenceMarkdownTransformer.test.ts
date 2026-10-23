import { describe, expect, it, vi } from "vitest";

const createFileReferenceNodeMock = vi.fn((fileReference: unknown) => ({
  fileReference,
  getFileReference: () => fileReference,
}));
const isFileReferenceNodeMock = vi.fn(
  (node: unknown): node is { getFileReference: () => unknown } =>
    !!node &&
    typeof (node as { getFileReference?: unknown }).getFileReference ===
      "function"
);

vi.mock("../../SmarterTextAreaCard/fileReferences/FileReferenceNode", () => ({
  $createFileReferenceNode: (fileReference: unknown) =>
    createFileReferenceNodeMock(fileReference),
  $isFileReferenceNode: (node: unknown) => isFileReferenceNodeMock(node),
  FileReferenceNode: class MockFileReferenceNode {},
}));

import type { TextMatchTransformer } from "@lexical/markdown";
import { FILE_REFERENCE_MARKDOWN_TRANSFORMER } from "../fileReferenceMarkdownTransformer";

const transformer =
  FILE_REFERENCE_MARKDOWN_TRANSFORMER as TextMatchTransformer;
const markdown =
  "[$UI Common/src/components/Editor.tsx](heyhey-file:v1:service-1:src%2Fcomponents%2FEditor.tsx)";

describe("FILE_REFERENCE_MARKDOWN_TRANSFORMER", () => {
  it("imports supported app-owned destinations as typed nodes", () => {
    const match = markdown.match(transformer.importRegExp as RegExp);
    expect(match).not.toBeNull();
    if (!match) return;

    const textNode = { replace: vi.fn() };
    transformer.replace?.(
      textNode as unknown as Parameters<
        NonNullable<TextMatchTransformer["replace"]>
      >[0],
      match
    );

    expect(createFileReferenceNodeMock).toHaveBeenCalledWith({
      version: 1,
      serviceId: "service-1",
      serviceName: "UI Common",
      normalizedPath: "src/components/Editor.tsx",
    });
    expect(textNode.replace).toHaveBeenCalledTimes(1);
  });

  it("exports typed nodes to canonical Markdown", () => {
    const value = {
      version: 1 as const,
      serviceId: "service-1",
      serviceName: "UI Common",
      normalizedPath: "src/components/Editor.tsx",
    };
    expect(
      transformer.export?.(
        { getFileReference: () => value } as unknown as Parameters<
          NonNullable<TextMatchTransformer["export"]>
        >[0],
        () => "",
        () => ""
      )
    ).toBe(markdown);
  });

  it("does not claim ordinary links", () => {
    expect(
      "[Documentation](https://example.com)".match(
        transformer.importRegExp as RegExp
      )
    ).toBeNull();
  });
});
