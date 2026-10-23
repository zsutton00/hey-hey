import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXTERNAL_EDITOR_PREFERENCE_STORAGE_KEY,
  buildExternalEditorUrl,
  parseSourceReference,
  readExternalEditorPreference,
  resetExternalEditorPreference,
  validateExternalEditorUrlTemplate,
  writeExternalEditorPreference,
} from "../editorPreference";

describe("editorPreference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("parseSourceReference", () => {
    it.each([
      [
        "/Users/zac/project/file.ts:42",
        { path: "/Users/zac/project/file.ts", line: 42, column: 1 },
      ],
      [
        "/Users/zac/project/file.ts:42:7",
        { path: "/Users/zac/project/file.ts", line: 42, column: 7 },
      ],
      [
        "C:\\project\\file.ts:9:3",
        { path: "C:\\project\\file.ts", line: 9, column: 3 },
      ],
      [
        "/Users/zac/project/file.ts",
        { path: "/Users/zac/project/file.ts", line: 1, column: 1 },
      ],
      [
        "C:\\project\\file.ts",
        { path: "C:\\project\\file.ts", line: 1, column: 1 },
      ],
    ])("parses %s", (destination, expected) => {
      expect(parseSourceReference(destination)).toEqual(expected);
    });

    it.each([
      "https://localhost:5173/file.ts:42",
      "http://example.com:8080",
      "relative/file.ts:42",
      "/Users/zac/project/file.ts:0",
      "/Users/zac/project/file.ts:4:0",
    ])("does not parse non-source destination %s", (destination) => {
      expect(parseSourceReference(destination)).toBeNull();
    });
  });

  it("builds a line-aware VS Code URL and preserves path separators", () => {
    expect(
      buildExternalEditorUrl(
        { kind: "preset", editor: "vscode" },
        { path: "/Users/zac/My Project/file #1.ts", line: 12, column: 1 }
      )
    ).toBe("vscode://file/Users/zac/My%20Project/file%20%231.ts:12:1");
  });

  it("expands all custom template placeholders", () => {
    expect(
      buildExternalEditorUrl(
        {
          kind: "custom",
          urlTemplate: "cursor://file/{path}?line={line}&column={column}",
        },
        { path: "/tmp/example file.ts", line: 8, column: 2 }
      )
    ).toBe("cursor://file//tmp/example%20file.ts?line=8&column=2");
  });

  it.each([
    ["cursor://file/{line}", "Custom templates must include {path}."],
    [
      "javascript:{path}",
      "Use a registered editor URI scheme, such as cursor: or idea:.",
    ],
    [
      "data:text/plain,{path}",
      "Use a registered editor URI scheme, such as cursor: or idea:.",
    ],
    [
      "https://editor.example/{path}",
      "Use a registered editor URI scheme, such as cursor: or idea:.",
    ],
    [
      "not-a-uri/{path}",
      "Use a registered editor URI scheme, such as cursor: or idea:.",
    ],
    ["idea://open?file={path}&line={line}", null],
  ])("validates custom template %s", (template, expected) => {
    expect(validateExternalEditorUrlTemplate(template)).toBe(expected);
  });

  it("round-trips and resets a valid preference", () => {
    const preference = { kind: "preset", editor: "vscode" } as const;
    expect(writeExternalEditorPreference(preference)).toBe(true);
    expect(readExternalEditorPreference()).toEqual(preference);
    expect(resetExternalEditorPreference()).toBe(true);
    expect(readExternalEditorPreference()).toBeNull();
  });

  it("does not persist an unsafe custom preference", () => {
    expect(
      writeExternalEditorPreference({
        kind: "custom",
        urlTemplate: "javascript:{path}",
      })
    ).toBe(false);
    expect(
      localStorage.getItem(EXTERNAL_EDITOR_PREFERENCE_STORAGE_KEY)
    ).toBeNull();
  });

  it.each([
    "{malformed",
    JSON.stringify({ kind: "preset", editor: "unknown" }),
    JSON.stringify({ kind: "custom", urlTemplate: "javascript:{path}" }),
    JSON.stringify({ kind: "custom" }),
  ])("treats invalid stored data as unconfigured", (storedValue) => {
    localStorage.setItem(EXTERNAL_EDITOR_PREFERENCE_STORAGE_KEY, storedValue);
    expect(readExternalEditorPreference()).toBeNull();
  });

  it("fails safely when storage access throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => {
      throw new Error("storage unavailable");
    });
    expect(readExternalEditorPreference()).toBeNull();

    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new Error("storage unavailable");
    });
    expect(
      writeExternalEditorPreference({ kind: "preset", editor: "vscode" })
    ).toBe(false);
  });
});
