import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ControllerAuthorizationCadence,
  ControllerDeviceGrantScope,
  CurrentAgentOperation,
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
  type CanonicalControllerAuthorizationIntent,
  type ControllerAuthorizationRequestOptions,
  type ControllerDeviceGrantDescriptor,
} from "../../../api";
import {
  collectControllerAssertion,
  ControllerAuthorizationClientError,
  ControllerAuthorizationClientFailureCode,
  decodeBase64Url,
  encodeBase64Url,
  toPublicKeyCredentialRequestOptions,
} from "../webauthnAssertion";

const bytes = (...values: number[]): ArrayBuffer =>
  Uint8Array.from(values).buffer;

const intent: CanonicalControllerAuthorizationIntent = {
  version: 2,
  authorizationId: "authorization-1",
  controllerCredentialId: "controller-1",
  controllerInstallationId: "10000000-0000-4000-8000-000000000001",
  machineId: "machine-1",
  userId: "user-1",
  organizationId: "organization-1",
  projectId: "project-1",
  cadence: ControllerAuthorizationCadence.OneDay,
  policyRevision: 1,
  effectiveGrantExpiresAtMs: 86_400_001,
  grantDescriptorHash: "a".repeat(64),
  actionCategory: HostActionCategory.Conversation,
  actionType: HostAffectingActionType.ConversationTrigger,
  actionPayloadHash: "payload-hash",
  allowedActionTypes: new Set(Object.values(CurrentAgentOperation)),
  allowedActionCategories: new Set([HostActionCategory.Conversation]),
  target: {
    kind: HostActionTargetKind.AgentSession,
    id: "agent-session-1",
    revision: null,
  },
  agentSessionId: "agent-session-1",
  taskMonitorId: null,
  nonce: "nonce",
  issuedAtMs: 1,
  expiresAtMs: 120_001,
};

const grantDescriptor: ControllerDeviceGrantDescriptor = {
  scope: ControllerDeviceGrantScope.ControllerDeviceWindow,
  controllerCredentialId: intent.controllerCredentialId,
  controllerInstallationId: intent.controllerInstallationId,
  machineId: intent.machineId,
  userId: intent.userId,
  organizationId: intent.organizationId,
  cadence: intent.cadence,
  policyRevision: intent.policyRevision,
  allowedActionTypes: intent.allowedActionTypes,
  allowedActionCategories: intent.allowedActionCategories,
  issuedAtMs: intent.issuedAtMs,
  effectiveExpiresAtMs: intent.effectiveGrantExpiresAtMs,
};

const requestOptions: ControllerAuthorizationRequestOptions = {
  challenge: encodeBase64Url(bytes(1, 2, 3)),
  rpId: "heyhey.dev",
  timeout: 120_000,
  userVerification: "required",
  allowCredentials: [
    {
      type: "public-key",
      id: encodeBase64Url(bytes(4, 5, 6)),
      transports: new Set(["internal", "hybrid"]),
    },
  ],
};

class TestAuthenticatorAssertionResponse {
  readonly clientDataJSON = bytes(7, 8);
  readonly authenticatorData = bytes(9, 10);
  readonly signature = bytes(11, 12);
  readonly userHandle = bytes(13, 14);
}

class TestPublicKeyCredential {
  readonly id = "ignored-browser-string";
  readonly rawId = bytes(15, 16);
  readonly type = "public-key";
  readonly authenticatorAttachment = "platform";
  readonly response = new TestAuthenticatorAssertionResponse();
}

describe("WebAuthn controller assertion adapter", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      value: TestPublicKeyCredential,
    });
    Object.defineProperty(globalThis, "AuthenticatorAssertionResponse", {
      configurable: true,
      value: TestAuthenticatorAssertionResponse,
    });
  });

  it("maps generated base64url request options to native WebAuthn options", () => {
    const native = toPublicKeyCredentialRequestOptions(requestOptions);

    expect(Array.from(new Uint8Array(native.challenge))).toEqual([1, 2, 3]);
    expect(native.rpId).toBe("heyhey.dev");
    expect(native.userVerification).toBe("required");
    expect(native.allowCredentials?.[0]?.transports).toEqual([
      "internal",
      "hybrid",
    ]);
    expect(
      Array.from(new Uint8Array(native.allowCredentials?.[0]?.id ?? bytes()))
    ).toEqual([4, 5, 6]);
  });

  it("collects only assertion evidence and preserves the exact prepared intent", async () => {
    const get = vi.fn().mockResolvedValue(new TestPublicKeyCredential());
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: { get },
    });

    const assertion = await collectControllerAssertion({
      grantDescriptor,
      publicKey: requestOptions,
      intent,
    });

    expect(get).toHaveBeenCalledWith({
      publicKey: expect.objectContaining({ userVerification: "required" }),
    });
    expect(assertion.intent).toBe(intent);
    expect(assertion.grantDescriptor).toBe(grantDescriptor);
    expect(decodeBase64Url(assertion.credentialId)).toEqual(
      new Uint8Array([15, 16])
    );
    expect(decodeBase64Url(assertion.clientDataJSON)).toEqual(
      new Uint8Array([7, 8])
    );
    expect(decodeBase64Url(assertion.authenticatorData)).toEqual(
      new Uint8Array([9, 10])
    );
    expect(decodeBase64Url(assertion.signature)).toEqual(
      new Uint8Array([11, 12])
    );
    expect(assertion.userHandle).not.toBeNull();
    expect(Object.keys(assertion)).not.toContain("authenticatorAttachment");
  });

  it("maps browser cancellation to a typed failure", async () => {
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: {
        get: vi
          .fn()
          .mockRejectedValue(
            new DOMException("The operation was cancelled", "NotAllowedError")
          ),
      },
    });

    await expect(
      collectControllerAssertion({
        grantDescriptor,
        publicKey: requestOptions,
        intent,
      })
    ).rejects.toMatchObject<Partial<ControllerAuthorizationClientError>>({
      code: ControllerAuthorizationClientFailureCode.UserCancelled,
    });
  });
});
