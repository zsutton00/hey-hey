import { describe, expect, it } from "vitest";
import type { ServiceDto } from "../../../api";
import {
  formatServiceNames,
  resolveServiceNames,
} from "../taskServiceAssignments";

const services = [
  { id: "service-api", name: "API" },
  { id: "service-ui", name: "Web App" },
] as ServiceDto[];

describe("task service assignment resolution", () => {
  it("preserves the proposal's service ordering", () => {
    expect(
      resolveServiceNames(["service-ui", "service-api"], services)
    ).toEqual({ state: "resolved", names: ["Web App", "API"] });
  });

  it("does not expose identifiers when a service cannot be resolved", () => {
    expect(resolveServiceNames(["missing-service"], services)).toEqual({
      state: "unavailable",
    });
  });

  it("formats an empty service set explicitly", () => {
    expect(formatServiceNames([])).toBe("(none)");
  });
});
