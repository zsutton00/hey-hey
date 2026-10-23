import { describe, expect, it } from "vitest";
import { parseCodeFenceStart } from "./FencedCodeOnEnterPlugin";

describe("parseCodeFenceStart", () => {
  it("matches bare fenced code block start", () => {
    expect(parseCodeFenceStart("```")).toEqual({ language: null });
  });

  it("matches fenced code block start with language", () => {
    expect(parseCodeFenceStart("```json")).toEqual({ language: "json" });
  });

  it("supports leading and trailing spaces", () => {
    expect(parseCodeFenceStart("  ```typescript  ")).toEqual({
      language: "typescript",
    });
  });

  it("rejects non-fence lines", () => {
    expect(parseCodeFenceStart("`not-a-fence`")).toBeNull();
    expect(parseCodeFenceStart("```json extra")).toBeNull();
  });
});
