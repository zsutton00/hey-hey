import { describe, expect, it } from "vitest";
import { matchFileReferenceTrigger } from "../fileReferences/fileReferenceTrigger";

describe("matchFileReferenceTrigger", () => {
  it.each([
    ["@", 1, "", 0],
    ["See @src/components", 19, "src/components", 4],
    ["Line one\n@api", 13, "api", 9],
  ])("matches valid caret-boundary input", (text, caret, query, sliceStart) => {
    expect(matchFileReferenceTrigger(text, caret, "node-1")).toEqual({
      query,
      range: { nodeKey: "node-1", sliceStart, cursorOffset: caret },
    });
  });

  it.each(["email@example.com", "text @one two", "text @@two"])(
    "rejects invalid activation in %s",
    (text) => expect(matchFileReferenceTrigger(text, text.length)).toBeNull()
  );
});
