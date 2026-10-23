import { describe, expect, it } from "vitest";
import { helpKeys } from "../help";
describe("help keys", () => {
  it("separates id-or-slug paths under one reconnect root", () => {
    expect(helpKeys.detail("guides/start")).toEqual(["help", "guides/start"]);
    expect(helpKeys.detail("guides/start")).not.toEqual(
      helpKeys.detail("guides/other")
    );
  });
});
