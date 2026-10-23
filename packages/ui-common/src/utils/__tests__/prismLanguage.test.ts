import Prism from "prismjs";
import { describe, expect, it } from "vitest";
import { resolvePrismLanguage } from "../prismLanguage";

describe("resolvePrismLanguage", () => {
  it("resolves TypeScript and TSX paths to their Prism ids", () => {
    expect(resolvePrismLanguage("src/foo.ts")).toBe("typescript");
    expect(resolvePrismLanguage("src/foo.tsx")).toBe("tsx");
  });

  it("resolves JavaScript and JSX variants to their Prism ids", () => {
    expect(resolvePrismLanguage("src/foo.js")).toBe("javascript");
    expect(resolvePrismLanguage("src/foo.jsx")).toBe("jsx");
    expect(resolvePrismLanguage("src/foo.mjs")).toBe("javascript");
    expect(resolvePrismLanguage("src/foo.cjs")).toBe("javascript");
  });

  it("resolves JSON, YAML, CSS, and Markdown paths", () => {
    expect(resolvePrismLanguage("config/data.json")).toBe("json");
    expect(resolvePrismLanguage("config/app.yaml")).toBe("yaml");
    expect(resolvePrismLanguage("config/app.yml")).toBe("yaml");
    expect(resolvePrismLanguage("styles/main.css")).toBe("css");
    expect(resolvePrismLanguage("docs/README.md")).toBe("markdown");
    expect(resolvePrismLanguage("docs/notes.markdown")).toBe("markdown");
  });

  it("matches extensions case-insensitively", () => {
    expect(resolvePrismLanguage("src/Foo.TS")).toBe("typescript");
    expect(resolvePrismLanguage("docs/README.MD")).toBe("markdown");
  });

  it("returns null for unknown extensions and filenames without a dot", () => {
    expect(resolvePrismLanguage("data/output.bin")).toBeNull();
    expect(resolvePrismLanguage("Makefile")).toBeNull();
    expect(resolvePrismLanguage("src/")).toBeNull();
    expect(resolvePrismLanguage("")).toBeNull();
  });

  it("returns Prism language ids that are actually registered", () => {
    const supportedPaths = [
      "a.ts",
      "a.tsx",
      "a.js",
      "a.jsx",
      "a.json",
      "a.yaml",
      "a.css",
      "a.md",
    ];
    for (const path of supportedPaths) {
      const id = resolvePrismLanguage(path);
      expect(id).not.toBeNull();
      expect(Prism.languages[id as string]).toBeDefined();
    }
  });
});
