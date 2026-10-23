import { describe, expect, it } from "vitest";
import {
  computeBlockCommentLines,
  isSingleLineCommentLine,
  resolveCommentSyntax,
} from "../commentSyntax";

describe("resolveCommentSyntax", () => {
  it("resolves slash syntax for TypeScript and JavaScript files", () => {
    for (const path of ["src/a.ts", "src/b.tsx", "src/c.js", "src/d.jsx"]) {
      expect(resolveCommentSyntax(path)).toEqual({
        lineMarkers: ["//"],
        blockMarkers: [{ open: "/*", close: "*/" }],
      });
    }
  });

  it("resolves hash syntax for Python, shell and YAML files", () => {
    for (const path of ["app.py", "deploy.sh", "config.yaml", "config.yml"]) {
      const syntax = resolveCommentSyntax(path);
      expect(syntax?.lineMarkers).toEqual(["#"]);
      expect(syntax?.blockMarkers).toEqual([]);
    }
  });

  it("resolves double-dash line syntax for SQL files", () => {
    const syntax = resolveCommentSyntax("schema/migration.sql");
    expect(syntax?.lineMarkers).toEqual(["--"]);
    expect(syntax?.blockMarkers).toEqual([{ open: "/*", close: "*/" }]);
  });

  it("resolves block-only syntax for CSS files", () => {
    const syntax = resolveCommentSyntax("styles/main.css");
    expect(syntax?.lineMarkers).toEqual([]);
    expect(syntax?.blockMarkers).toEqual([{ open: "/*", close: "*/" }]);
  });

  it("returns null for unknown or extension-less paths", () => {
    expect(resolveCommentSyntax("data/output.bin")).toBeNull();
    expect(resolveCommentSyntax("Makefile")).toBeNull();
    expect(resolveCommentSyntax(".gitignore")).toBeNull();
  });
});

describe("isSingleLineCommentLine", () => {
  it("matches a wholly-comment line in a TypeScript file", () => {
    expect(isSingleLineCommentLine("// a comment", "src/a.ts")).toBe(true);
    expect(isSingleLineCommentLine("   //indented", "src/a.ts")).toBe(true);
  });

  it("does not match a line with code before the marker", () => {
    expect(
      isSingleLineCommentLine("const x = 1; // trailing", "src/a.ts")
    ).toBe(false);
  });

  it("matches hash comments only for hash-syntax files", () => {
    expect(isSingleLineCommentLine("# python comment", "app.py")).toBe(true);
    expect(isSingleLineCommentLine("# not a ts comment", "src/a.ts")).toBe(
      false
    );
  });

  it("matches SQL double-dash comments", () => {
    expect(isSingleLineCommentLine("-- a sql comment", "schema.sql")).toBe(
      true
    );
  });

  it("never matches blank lines or code", () => {
    expect(isSingleLineCommentLine("", "src/a.ts")).toBe(false);
    expect(isSingleLineCommentLine("   ", "src/a.ts")).toBe(false);
    expect(isSingleLineCommentLine("const x = 1;", "src/a.ts")).toBe(false);
  });

  it("hides nothing for unknown file types", () => {
    expect(isSingleLineCommentLine("// looks like a comment", "a.bin")).toBe(
      false
    );
  });
});

describe("computeBlockCommentLines", () => {
  it("marks every line of a multi-line block comment", () => {
    const content = [
      "const x = 1;",
      "/*",
      " * doc",
      " */",
      "const y = 2;",
    ].join("\n");
    expect(computeBlockCommentLines(content, "src/a.ts")).toEqual(
      new Set([2, 3, 4])
    );
  });

  it("does not mark a line that mixes code and a block comment", () => {
    const content = [
      "const x = 1; /* note",
      " still inside */ const y = 2;",
    ].join("\n");
    // Line 1 has leading code, line 2 has trailing code — neither is wholly a comment.
    expect(computeBlockCommentLines(content, "src/a.ts")).toEqual(new Set());
  });

  it("marks a single-line block comment", () => {
    const content = ["before", "/* one liner */", "after"].join("\n");
    expect(computeBlockCommentLines(content, "src/a.ts")).toEqual(new Set([2]));
  });

  it("returns an empty set for hash-syntax files with no block markers", () => {
    const content = ["# a", "# b"].join("\n");
    expect(computeBlockCommentLines(content, "app.py")).toEqual(new Set());
  });

  it("returns an empty set for unknown file types", () => {
    expect(computeBlockCommentLines("/* x */", "a.bin")).toEqual(new Set());
  });
});
