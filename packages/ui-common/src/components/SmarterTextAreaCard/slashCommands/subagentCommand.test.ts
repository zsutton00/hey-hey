import { describe, expect, it } from "vitest";
import { parseSubagentCommandPrefix } from "./subagentCommand";

describe("parseSubagentCommandPrefix", () => {
  it("resolves both delivery modes from the first non-whitespace token", () => {
    expect(
      parseSubagentCommandPrefix(
        " \n/subagent foreground research Investigate the failure"
      )
    ).toEqual({
      mode: "foreground",
      capability: "research",
      length: " \n/subagent foreground research ".length,
    });
    expect(
      parseSubagentCommandPrefix("/subagent background research Check the API")
    ).toEqual({
      mode: "background",
      capability: "research",
      length: "/subagent background research ".length,
    });
  });

  it("keeps later and lookalike command text literal", () => {
    for (const message of [
      "Please run /subagent background research something",
      "note\n/subagent foreground research something",
      "/subagentic foreground research something",
    ]) {
      expect(parseSubagentCommandPrefix(message)).toBeNull();
    }
  });

  it("defaults a bare trigger and leaves ordinary objective words intact", () => {
    expect(parseSubagentCommandPrefix("/subagent ")).toEqual({
      mode: "foreground",
      capability: "research",
      length: 10,
    });
    expect(parseSubagentCommandPrefix("/subagent")).toBeNull();
    const text = "/subagent investigate background research";
    const prefix = parseSubagentCommandPrefix(text)!;
    expect(text.slice(prefix.length)).toBe("investigate background research");
  });
});
