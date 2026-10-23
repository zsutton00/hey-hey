import { describe, expect, it } from "vitest";
import { resolveDiffDefaultViewMode } from "../proposalRenderOverrides";

describe("resolveDiffDefaultViewMode", () => {
  it("opens Agent Mode updates inline", () => {
    expect(resolveDiffDefaultViewMode("MODE")).toBe("inline");
  });

  it("keeps the Agent Mode default inline even when the caller asks for split", () => {
    expect(resolveDiffDefaultViewMode("MODE", "split")).toBe("inline");
  });

  it("defaults other types to split", () => {
    expect(resolveDiffDefaultViewMode("FEATURE")).toBe("split");
    expect(resolveDiffDefaultViewMode(undefined)).toBe("split");
  });

  it("applies the caller-level default to other types", () => {
    expect(resolveDiffDefaultViewMode("FEATURE", "inline")).toBe("inline");
  });
});
