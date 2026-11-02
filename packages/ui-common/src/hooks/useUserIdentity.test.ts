import { describe, expect, it } from "vitest";
import { isLocalAccountEmail } from "../utils/userIdentity";
import { formatUserIdentity } from "./useUserIdentity";

describe("formatUserIdentity", () => {
  it("does not expose the internal email for a local account", () => {
    expect(
      formatUserIdentity({
        name: "Ada Lovelace",
        email: "local-installation@local.invalid",
        isLocalAccount: true,
      }),
    ).toBe("Ada Lovelace");
  });

  it("continues to show email for hosted accounts", () => {
    expect(
      formatUserIdentity({
        name: "Ada Lovelace",
        email: "ada@example.com",
        isLocalAccount: false,
      }),
    ).toBe("Ada Lovelace (ada@example.com)");
  });

  it("recognizes only the generated local account email shape", () => {
    expect(isLocalAccountEmail(`local-${"a".repeat(64)}@local.invalid`)).toBe(
      true,
    );
    expect(isLocalAccountEmail("ada@local.invalid")).toBe(false);
  });
});
