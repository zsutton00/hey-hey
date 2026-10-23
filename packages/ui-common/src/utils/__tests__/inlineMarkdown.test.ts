import { type InlineNode, parseInlineMarkdown } from "../inlineMarkdown";

const types = (nodes: InlineNode[]): string[] => nodes.map((n) => n.type);

const text = (node: InlineNode): string => {
  switch (node.type) {
    case "text":
      return node.value;
    case "code":
      return node.value;
    case "mention":
      return node.mention.entityName;
    default:
      return node.children.map(text).join("");
  }
};

describe("parseInlineMarkdown", () => {
  test("plain text is a single text node", () => {
    expect(parseInlineMarkdown("just words")).toEqual([
      { type: "text", value: "just words" },
    ]);
  });

  test("bold via **", () => {
    const nodes = parseInlineMarkdown("a **bold** b");
    expect(types(nodes)).toEqual(["text", "strong", "text"]);
    expect(text(nodes[1])).toBe("bold");
  });

  test("italic via * and _", () => {
    expect(types(parseInlineMarkdown("an *italic* word"))).toEqual([
      "text",
      "emphasis",
      "text",
    ]);
    expect(types(parseInlineMarkdown("an _italic_ word"))).toEqual([
      "text",
      "emphasis",
      "text",
    ]);
  });

  test("strikethrough via ~~", () => {
    const nodes = parseInlineMarkdown("~~gone~~ now");
    expect(types(nodes)).toEqual(["strikethrough", "text"]);
    expect(text(nodes[0])).toBe("gone");
  });

  test("inline code and mentions still work", () => {
    const nodes = parseInlineMarkdown(
      "see `compact_run` and @[task:abc-123|Goal V2: the plan]"
    );
    expect(types(nodes)).toEqual(["text", "code", "text", "mention"]);
    expect(text(nodes[1])).toBe("compact_run");
    expect(text(nodes[3])).toBe("Goal V2: the plan");
  });

  test("nesting: code and mention inside bold", () => {
    const nodes = parseInlineMarkdown(
      "**delivered by @[task:abc-123|The Goal] via `compact_run`**"
    );
    expect(types(nodes)).toEqual(["strong"]);
    const strong = nodes[0];
    if (strong.type !== "strong") throw new Error("expected strong");
    expect(types(strong.children)).toEqual(["text", "mention", "text", "code"]);
  });

  test("nesting: italic inside bold", () => {
    const nodes = parseInlineMarkdown("**bold and _italic_ inside**");
    const strong = nodes[0];
    if (strong.type !== "strong") throw new Error("expected strong");
    expect(types(strong.children)).toContain("emphasis");
  });

  // False-positive guards — these must NOT become emphasis/bold.
  test("snake_case is plain text", () => {
    expect(parseInlineMarkdown("call compact_run_now()")).toEqual([
      { type: "text", value: "call compact_run_now()" },
    ]);
  });

  test("'** **' (spaces only) is not bold", () => {
    expect(types(parseInlineMarkdown("a ** ** b"))).toEqual(["text"]);
  });

  test("'a * b' (spaced asterisk) is not emphasis", () => {
    expect(types(parseInlineMarkdown("compute a * b * c"))).toEqual(["text"]);
  });

  test("round-trips text content for a mixed line", () => {
    const line = "Fix **the `compact_run` adapter** and _retry_ ~~later~~.";
    const rendered = parseInlineMarkdown(line).map(text).join("");
    expect(rendered).toBe("Fix the compact_run adapter and retry later.");
  });
});
