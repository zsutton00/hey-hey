import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  createEditor,
} from "lexical";
import {
  $createMentionNode,
  $isMentionNode,
  MentionNode,
} from "../SmarterTextAreaCard/MentionNode";
import type {
  EntityMention,
  SerializedMentionNode,
} from "../SmarterTextAreaCard/types";

describe("MentionNode", () => {
  const mention: EntityMention = {
    entityType: "task",
    entityId: "123",
    entityName: "Build login",
  };

  const createTestEditor = () =>
    createEditor({
      namespace: "MentionNodeTest",
      nodes: [MentionNode],
      onError: (error) => {
        throw error;
      },
    });

  describe("$createMentionNode", () => {
    it("should create a mention node", () => {
      const editor = createTestEditor();
      let node: MentionNode | null = null;

      editor.update(() => {
        node = $createMentionNode(mention);
      });

      expect(node).not.toBeNull();
      expect($isMentionNode(node)).toBe(true);
    });

    it("should store mention data correctly", () => {
      const editor = createTestEditor();
      let node: MentionNode | null = null;

      editor.update(() => {
        node = $createMentionNode(mention);
      });

      expect(node?.getMention()).toEqual(mention);
    });
  });

  describe("clipboard serialization", () => {
    it("serializes a selected mention to its canonical plain-text token", () => {
      const editor = createTestEditor();

      editor.update(() => {
        const paragraph = $createParagraphNode();
        paragraph.append($createMentionNode(mention));
        $getRoot().append(paragraph);
        paragraph.select(0, 1);

        expect($getSelection()?.getTextContent()).toBe(
          "@[task:123|Build login]"
        );
      });
    });

    it("serializes surrounding text and mentions from a mixed paragraph", () => {
      const editor = createTestEditor();

      editor.update(() => {
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createTextNode("Ship "),
          $createMentionNode(mention),
          $createTextNode(" with "),
          $createMentionNode({
            entityType: "feature",
            entityId: "456",
            entityName: "Authentication",
          }),
          $createTextNode(".")
        );
        $getRoot().append(paragraph);
        paragraph.select(0, paragraph.getChildrenSize());

        expect($getSelection()?.getTextContent()).toBe(
          "Ship @[task:123|Build login] with @[feature:456|Authentication]."
        );
      });
    });

    it("exports readable HTML while retaining mention identity metadata", () => {
      const editor = createTestEditor();

      editor.update(() => {
        const node = $createMentionNode(mention);
        const element = node.exportDOM().element;

        expect(element).toBeInstanceOf(HTMLSpanElement);
        expect(element?.textContent).toBe("Build login");
        expect(element).toHaveAttribute("data-entity-type", "task");
        expect(element).toHaveAttribute("data-entity-id", "123");
      });
    });

    it("imports exported HTML back into a rich mention node", () => {
      const editor = createTestEditor();

      editor.update(() => {
        const exportedElement = $createMentionNode(mention).exportDOM().element;

        expect(exportedElement).toBeInstanceOf(HTMLSpanElement);
        if (!(exportedElement instanceof HTMLSpanElement)) {
          return;
        }

        const conversion = MentionNode.importDOM().span?.(exportedElement);
        const importedNode = conversion?.conversion(exportedElement).node;

        expect($isMentionNode(importedNode)).toBe(true);
        if ($isMentionNode(importedNode)) {
          expect(importedNode.getMention()).toEqual(mention);
        }
      });
    });
  });

  describe("MentionNode.exportJSON", () => {
    it("should export mention data", () => {
      const editor = createTestEditor();
      let json: ReturnType<MentionNode["exportJSON"]> | null = null;

      editor.update(() => {
        const node = $createMentionNode(mention);
        json = node.exportJSON();
      });

      expect(json?.type).toBe("mention");
      expect(json?.version).toBe(1);
      expect(json?.mention).toEqual(mention);
    });
  });

  describe("MentionNode.importJSON", () => {
    it("should import mention data", () => {
      const serialized: SerializedMentionNode = {
        type: "mention",
        version: 1,
        mention: {
          entityType: "task",
          entityId: "123",
          entityName: "Build login",
        },
      };
      const editor = createTestEditor();
      let node: MentionNode | null = null;

      editor.update(() => {
        node = MentionNode.importJSON(serialized);
      });

      expect($isMentionNode(node)).toBe(true);
      expect(node?.getMention()).toEqual(serialized.mention);
    });
  });
});
