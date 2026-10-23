import { describe, expect, it } from "vitest";
import { isStandaloneLanding } from "./entryRoute";

describe("landing entry selection", () => {
  it("keeps ordinary landing visits out of the application", () => {
    expect(isStandaloneLanding({ pathname: "/", search: "" })).toBe(true);
    expect(isStandaloneLanding({ pathname: "/", search: "?utm_source=launch" })).toBe(true);
    expect(isStandaloneLanding({ pathname: "/", search: "?welcome=" })).toBe(true);
  });

  it("preserves invitations and app deep links", () => {
    expect(isStandaloneLanding({ pathname: "/", search: "?welcome=invitation" })).toBe(false);
    for (const pathname of ["/login", "/request-access", "/home", "/projects/123", "/terms", "/missing"]) {
      expect(isStandaloneLanding({ pathname, search: "" })).toBe(false);
    }
  });
});
