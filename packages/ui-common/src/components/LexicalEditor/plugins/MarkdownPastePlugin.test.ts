import {
  looksLikeMarkdownDocument,
  shouldImportMarkdownDocumentPaste,
} from "./MarkdownPastePlugin";

describe("MarkdownPastePlugin markdown detection", () => {
  it("detects block markdown from a document", () => {
    const markdown = "# Title\n\n- Item 1\n- Item 2";
    expect(looksLikeMarkdownDocument(markdown)).toBe(true);
  });

  it("does not treat plain text as markdown", () => {
    const plainText = "This is a plain paragraph without markdown syntax.";
    expect(looksLikeMarkdownDocument(plainText)).toBe(false);
  });
});

describe("MarkdownPastePlugin full-document import guard", () => {
  it("imports markdown into an empty editor", () => {
    expect(
      shouldImportMarkdownDocumentPaste("# New Doc", {
        editorTextContent: "",
        selectedTextContent: "",
        hasExpandedSelection: false,
      })
    ).toBe(true);
  });

  it("imports markdown when the entire document is selected", () => {
    const existing = "Existing content\nwith two lines";
    expect(
      shouldImportMarkdownDocumentPaste("# Replacement", {
        editorTextContent: existing,
        selectedTextContent: existing,
        hasExpandedSelection: true,
      })
    ).toBe(true);
  });

  it("does not replace document on partial selection", () => {
    expect(
      shouldImportMarkdownDocumentPaste("# Replacement", {
        editorTextContent: "Line one\nLine two",
        selectedTextContent: "Line one",
        hasExpandedSelection: true,
      })
    ).toBe(false);
  });

  it("does not import plain text even when empty", () => {
    expect(
      shouldImportMarkdownDocumentPaste("just plain text", {
        editorTextContent: "",
        selectedTextContent: "",
        hasExpandedSelection: false,
      })
    ).toBe(false);
  });
});
