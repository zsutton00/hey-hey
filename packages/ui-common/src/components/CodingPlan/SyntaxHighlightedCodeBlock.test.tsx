import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SyntaxHighlightedCodeBlock } from "./SyntaxHighlightedCodeBlock";

const YAML_WITH_INDENTATION = [
  "services:",
  "  api:",
  "    image: hey-hey/api",
  "    environment:",
  "      - LOG_LEVEL=debug",
].join("\n");

describe("SyntaxHighlightedCodeBlock", () => {
  it("preserves YAML indentation without wrapping significant whitespace", () => {
    render(
      <SyntaxHighlightedCodeBlock
        code={YAML_WITH_INDENTATION}
        language="yaml"
        testId="yaml-code"
      />
    );

    const codeBlock = screen.getByTestId("yaml-code");
    expect(codeBlock.textContent).toBe(YAML_WITH_INDENTATION);
    expect(codeBlock).toHaveStyle({
      overflow: "auto",
      overflowWrap: "normal",
      whiteSpace: "pre",
      wordBreak: "normal",
    });
  });

  it("preserves whitespace when no syntax grammar matches the language", () => {
    const content = "root\n  child\n\tleaf";
    render(
      <SyntaxHighlightedCodeBlock
        code={content}
        language="custom-language"
        testId="fallback-code"
      />
    );

    const codeBlock = screen.getByTestId("fallback-code");
    expect(codeBlock.textContent).toBe(content);
    expect(codeBlock).toHaveStyle({ whiteSpace: "pre" });
  });
});
