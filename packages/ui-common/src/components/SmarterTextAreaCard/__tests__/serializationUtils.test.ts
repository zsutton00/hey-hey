import { $getRoot, $isElementNode, createEditor } from "lexical";
import { describe, expect, it } from "vitest";
import { MentionNode } from "../MentionNode";
import {
  loadContentWithMentions,
  serializeEditorState,
} from "../serializationUtils";

describe("editor content serialization", () => {
  it("restores paragraph and manual line breaks as matching Lexical nodes", () => {
    const content =
      "First paragraph\n\nSecond paragraph\nwith a manual line break\n\nThird paragraph";
    const editor = createEditor({
      namespace: "SerializationUtilsTest",
      nodes: [MentionNode],
      onError: (error) => {
        throw error;
      },
    });

    editor.update(
      () => {
        loadContentWithMentions(content);

        const paragraphs = $getRoot().getChildren();
        expect(paragraphs.map((paragraph) => paragraph.getType())).toEqual([
          "paragraph",
          "paragraph",
          "paragraph",
        ]);

        const secondParagraph = paragraphs[1];
        if (!$isElementNode(secondParagraph)) {
          throw new Error("Expected the restored node to be a paragraph");
        }

        expect(
          secondParagraph
            .getChildren()
            .map((child) => child.getType())
        ).toEqual(["text", "linebreak", "text"]);
        expect(serializeEditorState()).toBe(content);
      },
      { discrete: true }
    );
  });
});
