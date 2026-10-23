import { describe, expect, it } from "vitest";
import { resolveVerificationRuntimeContext } from "./verificationRuntimeContext";

const source = {
  id: "9d6c4a8e-2f0b-4a53-8d1e-7c3b5a1f2e40",
  machineId: "source-machine",
  serviceIds: ["source-service"],
  launchServiceId: "source-service",
  service: { name: "Source" },
} as Parameters<typeof resolveVerificationRuntimeContext>[1];

describe("verification runtime context", () => {
  it("names the session that raised the concern as the parent session", () => {
    expect(
      resolveVerificationRuntimeContext(null, source)?.parentAgentSessionId,
    ).toBe(source?.id);
  });

  it("prefers the host-provided parent session and runtime over the loaded session", () => {
    expect(
      resolveVerificationRuntimeContext(
        {
          parentAgentSessionId: "host-session",
          machineId: "host-machine",
          serviceIds: ["host-service"],
          launchServiceId: "host-service",
        },
        source,
      ),
    ).toMatchObject({
      parentAgentSessionId: "host-session",
      machineId: "host-machine",
      serviceIds: ["host-service"],
      launchServiceId: "host-service",
    });
  });

  it("has no parent session until one is known", () => {
    expect(
      resolveVerificationRuntimeContext(null, null).parentAgentSessionId,
    ).toBeNull();
  });
});
