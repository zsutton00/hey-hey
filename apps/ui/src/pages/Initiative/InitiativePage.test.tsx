import { describe, expect, it } from "vitest";
import { buildInitiativePresentationSnapshot } from "./initiativePagePresentation";

describe("InitiativePage", () => {
  it("builds canonical presentation from the loaded initiative name", () => {
    expect(buildInitiativePresentationSnapshot("Platform launch")).toEqual({
      kind: "initiative",
      label: "Platform launch",
    });
  });
});
