import { beforeEach, describe, expect, it } from "vitest";
import { ControllerAuthorizationCadence } from "../../../api";
import {
  readControllerAuthorizationPreference,
  writeControllerAuthorizationCadence,
} from "../controllerAuthorizationPreference";

describe("controllerAuthorizationPreference", () => {
  beforeEach(() => localStorage.clear());

  it("stores only the cadence for each organization", () => {
    writeControllerAuthorizationCadence(
      "org-1",
      ControllerAuthorizationCadence.OneDay
    );

    expect(readControllerAuthorizationPreference("org-1")).toEqual({
      cadence: ControllerAuthorizationCadence.OneDay,
    });
    expect(JSON.stringify(localStorage)).not.toContain("installation");
  });

  it("fails closed to the contract default when persisted cadence is invalid", () => {
    localStorage.setItem(
      "hey-hey:controller-authorization:v2:org-1:cadence",
      "FOREVER"
    );

    expect(readControllerAuthorizationPreference("org-1")).toEqual({
      cadence: ControllerAuthorizationCadence.FiveMinutes,
    });
    expect(localStorage.length).toBe(0);
  });
});
