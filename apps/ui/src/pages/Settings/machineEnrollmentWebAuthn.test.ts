import type { MachineEnrollmentWebAuthnRegistrationOptionsDto } from "@hey-hey/ui-common/api";
import { describe, expect, it, vi } from "vitest";
import {
  createMachineEnrollmentCredential,
  WebAuthnCancelledError,
  WebAuthnUnsupportedError,
} from "./machineEnrollmentWebAuthn";

const registrationOptions: MachineEnrollmentWebAuthnRegistrationOptionsDto = {
  challenge: "Y2hhbGxlbmdl",
  rp: { id: "heyhey.dev", name: "Hey Hey" },
  user: {
    id: "dXNlci1pZA",
    name: "zac@example.com",
    displayName: "Zac",
  },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  authenticatorSelection: {
    userVerification: "required",
    residentKey: "preferred",
  },
  attestation: "none",
};

describe("createMachineEnrollmentCredential", () => {
  it("passes only decoded server options to native WebAuthn and serializes the full response", async () => {
    const create = vi.fn(async (request: CredentialCreationOptions) => {
      expect(request.publicKey?.challenge).toEqual(
        new Uint8Array([99, 104, 97, 108, 108, 101, 110, 103, 101]),
      );
      expect(request.publicKey?.user.id).toEqual(
        new Uint8Array([117, 115, 101, 114, 45, 105, 100]),
      );

      return {
        id: "credential-id",
        type: "public-key",
        rawId: new Uint8Array([1, 2, 3]).buffer,
        response: {
          clientDataJSON: new Uint8Array([4, 5]).buffer,
          attestationObject: new Uint8Array([6, 7]).buffer,
          getTransports: () => ["internal", "hybrid"],
        },
        authenticatorAttachment: "platform",
      };
    });

    const credential = await createMachineEnrollmentCredential(
      registrationOptions,
      { create },
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(credential).toEqual({
      id: "credential-id",
      rawId: "AQID",
      type: "public-key",
      response: {
        clientDataJSON: "BAU",
        attestationObject: "Bgc",
        transports: ["internal", "hybrid"],
      },
      authenticatorAttachment: "platform",
    });
  });

  it("maps native cancellation to an actionable typed error", async () => {
    const create = vi.fn(async () => {
      throw new DOMException("The operation was cancelled", "NotAllowedError");
    });

    await expect(
      createMachineEnrollmentCredential(registrationOptions, { create }),
    ).rejects.toBeInstanceOf(WebAuthnCancelledError);
  });

  it("reports unsupported browsers before attempting native WebAuthn", async () => {
    await expect(
      createMachineEnrollmentCredential(registrationOptions, undefined),
    ).rejects.toBeInstanceOf(WebAuthnUnsupportedError);
  });
});
