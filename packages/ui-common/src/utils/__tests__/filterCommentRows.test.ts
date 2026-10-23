import { describe, expect, it } from "vitest";
import { buildFullFileSplit } from "../buildFullFileSplit";
import { filterCommentRows } from "../filterCommentRows";

describe("filterCommentRows", () => {
  describe("single-line comments", () => {
    it("drops insert rows whose added line is a comment", () => {
      const rows = buildFullFileSplit(
        "const a = 1;\n",
        "const a = 1;\n// added comment\nconst b = 2;\n"
      );
      const filtered = filterCommentRows(rows, "src/a.ts");
      expect(filtered.map((r) => r.newLine)).toEqual([
        "const a = 1;",
        "const b = 2;",
      ]);
    });

    it("drops delete rows whose removed line is a comment", () => {
      const rows = buildFullFileSplit(
        "const a = 1;\n// stale comment\nconst b = 2;\n",
        "const a = 1;\nconst b = 2;\n"
      );
      const filtered = filterCommentRows(rows, "src/a.ts");
      expect(filtered.some((r) => r.oldLine === "// stale comment")).toBe(
        false
      );
      expect(filtered).toHaveLength(2);
    });

    it("drops equal rows where both sides are the same comment", () => {
      const rows = buildFullFileSplit(
        "// shared comment\nconst a = 1;\n",
        "// shared comment\nconst a = 2;\n"
      );
      const filtered = filterCommentRows(rows, "src/a.ts");
      expect(filtered.some((r) => r.oldLine === "// shared comment")).toBe(
        false
      );
    });

    it("drops replace rows where both sides are comments", () => {
      const rows = buildFullFileSplit(
        "// old comment\nconst a = 1;\n",
        "// new comment\nconst a = 1;\n"
      );
      const filtered = filterCommentRows(rows, "src/a.ts");
      expect(filtered.some((r) => r.type === "replace")).toBe(false);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].newLine).toBe("const a = 1;");
    });

    it("keeps replace rows where only one side is a comment", () => {
      const rows = buildFullFileSplit(
        "// turned into code\n",
        "const real = 1;\n"
      );
      const filtered = filterCommentRows(rows, "src/a.ts");
      expect(filtered).toHaveLength(1);
      expect(filtered[0].newLine).toBe("const real = 1;");
    });

    it("preserves original line numbers of surviving rows", () => {
      const rows = buildFullFileSplit(
        "const a = 1;\nconst b = 2;\n",
        "const a = 1;\n// inserted\nconst b = 2;\n"
      );
      const filtered = filterCommentRows(rows, "src/a.ts");
      const survivor = filtered.find((r) => r.newLine === "const b = 2;");
      expect(survivor?.newLineNumber).toBe(3);
    });

    it("hides comments in an added file", () => {
      const rows = buildFullFileSplit(
        null,
        "// header\nconst a = 1;\n# not a ts comment\n"
      );
      const filtered = filterCommentRows(rows, "src/a.ts");
      expect(filtered.map((r) => r.newLine)).toEqual([
        "const a = 1;",
        "# not a ts comment",
      ]);
    });

    it("hides comments in a deleted file", () => {
      const rows = buildFullFileSplit("# comment\nx = 1\n", null);
      const filtered = filterCommentRows(rows, "app.py");
      expect(filtered.map((r) => r.oldLine)).toEqual(["x = 1"]);
    });

    it("hides nothing for unknown file types", () => {
      const rows = buildFullFileSplit("a\n", "a\n// b\n");
      const filtered = filterCommentRows(rows, "data.bin");
      expect(filtered).toHaveLength(rows.length);
    });
  });

  describe("block comments", () => {
    it("drops insert rows inside a multi-line block comment", () => {
      const pre = "const a = 1;\n";
      const post = "const a = 1;\n/*\n * a block\n */\nconst b = 2;\n";
      const rows = buildFullFileSplit(pre, post);
      const filtered = filterCommentRows(rows, "src/a.ts", pre, post);
      expect(filtered.map((r) => r.newLine)).toEqual([
        "const a = 1;",
        "const b = 2;",
      ]);
    });

    it("drops delete rows inside a removed block comment", () => {
      const pre = "const a = 1;\n/*\n * stale\n */\nconst b = 2;\n";
      const post = "const a = 1;\nconst b = 2;\n";
      const rows = buildFullFileSplit(pre, post);
      const filtered = filterCommentRows(rows, "src/a.ts", pre, post);
      expect(filtered.some((r) => r.oldLine?.includes("stale"))).toBe(false);
      expect(filtered).toHaveLength(2);
    });

    it("does not hide block comments when content is not supplied", () => {
      const pre = "const a = 1;\n";
      const post = "const a = 1;\n/*\n * a block\n */\nconst b = 2;\n";
      const rows = buildFullFileSplit(pre, post);
      const filtered = filterCommentRows(rows, "src/a.ts");
      expect(filtered.some((r) => r.newLine === " * a block")).toBe(true);
    });
  });
});
