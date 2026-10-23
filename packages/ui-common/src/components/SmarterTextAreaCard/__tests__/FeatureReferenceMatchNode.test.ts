import {
  $createParagraphNode,
  $getRoot,
  createEditor,
  type SerializedTextNode,
} from "lexical";
import {
  $createFeatureReferenceMatchNode,
  $isFeatureReferenceMatchNode,
  FeatureReferenceMatchNode,
} from "../FeatureReferenceMatchNode";

describe("FeatureReferenceMatchNode", () => {
  const createTestEditor = () =>
    createEditor({
      namespace: "FeatureReferenceMatchNodeTest",
      nodes: [FeatureReferenceMatchNode],
      onError: (error) => {
        throw error;
      },
    });

  it("retains all current duplicate candidate identities in memory", () => {
    const editor = createTestEditor();
    let node: FeatureReferenceMatchNode | null = null;
    let candidateKeys: readonly {
      entityType: "feature" | "service";
      entityId: string;
    }[] = [];

    editor.update(
      () => {
        node = $createFeatureReferenceMatchNode(
          "Roadmap",
          [
            { entityType: "feature", entityId: "feature-a" },
            { entityType: "service", entityId: "service-a" },
          ],
          "exact",
          0
        );
        candidateKeys = node.getCandidateKeys();
      },
      { discrete: true }
    );

    expect($isFeatureReferenceMatchNode(node)).toBe(true);
    expect(candidateKeys).toEqual([
      { entityType: "feature", entityId: "feature-a" },
      { entityType: "service", entityId: "service-a" },
    ]);
  });

  it("retains match kind and rank through cloning", () => {
    const editor = createTestEditor();
    let node: FeatureReferenceMatchNode | null = null;
    let clone: FeatureReferenceMatchNode | null = null;
    let cloneMatchKind = "";
    let cloneMatchRank = -1;
    let cloneSourceStyle = "";

    editor.update(
      () => {
        node = $createFeatureReferenceMatchNode(
          "Search Ag",
          [{ entityType: "feature", entityId: "feature-search-agent" }],
          "prefix",
          1,
          "color: red"
        );
        clone = FeatureReferenceMatchNode.clone(node);
        cloneMatchKind = clone.getMatchKind();
        cloneMatchRank = clone.getMatchRank();
        cloneSourceStyle = clone.getSourceStyle();
      },
      { discrete: true }
    );

    expect(cloneMatchKind).toBe("prefix");
    expect(cloneMatchRank).toBe(1);
    expect(cloneSourceStyle).toBe("color: red");
  });

  it("exports JSON and clipboard DOM as ordinary source text", () => {
    const editor = createTestEditor();

    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const node = $createFeatureReferenceMatchNode(
          "Feature Search",
          [{ entityType: "feature", entityId: "feature-search" }],
          "exact",
          0
        );
        paragraph.append(node);
        $getRoot().append(paragraph);

        expect(node.exportJSON()).toMatchObject({
          type: "text",
          text: "Feature Search",
          version: 1,
        });
        const exportedElement = node.exportDOM().element;
        expect(exportedElement).toBeInstanceOf(HTMLSpanElement);
        expect(exportedElement).toHaveTextContent("Feature Search");
        expect(exportedElement).not.toHaveClass("feature-reference-match-node");
        expect(exportedElement).not.toHaveStyle({
          textDecorationLine: "underline",
        });
      },
      { discrete: true }
    );
  });

  it("imports persisted ordinary text without restoring candidate identity", () => {
    const serialized: SerializedTextNode = {
      type: "text",
      version: 1,
      detail: 0,
      format: 0,
      mode: "normal",
      style: "",
      text: "Feature Search",
    };
    const editor = createTestEditor();
    let node: FeatureReferenceMatchNode | null = null;
    let importedText = "";
    let candidateKeys: readonly {
      entityType: "feature" | "service";
      entityId: string;
    }[] = [{ entityType: "feature", entityId: "unexpected" }];

    editor.update(
      () => {
        node = FeatureReferenceMatchNode.importJSON(serialized);
        importedText = node.getTextContent();
        candidateKeys = node.getCandidateKeys();
      },
      { discrete: true }
    );

    expect(node).not.toBeNull();
    expect(importedText).toBe("Feature Search");
    expect(candidateKeys).toEqual([]);
  });
});
