import {
  ControllerAssertionEvidenceKindEnum,
  type CanonicalControllerAuthorizationIntent,
  type ControllerAssertionEvidence,
  type ControllerAuthorizationRequestOptions,
  type ControllerDeviceGrantDescriptor,
} from "../../api";

export const ControllerAuthorizationClientFailureCode = {
  UnsupportedWebAuthn: "UNSUPPORTED_WEBAUTHN",
  UserCancelled: "USER_CANCELLED",
  ConfirmationDeclined: "CONFIRMATION_DECLINED",
  MachineNotReady: "MACHINE_NOT_READY",
  InvalidCredential: "INVALID_CREDENTIAL",
  DialogUnavailable: "DIALOG_UNAVAILABLE",
} as const;

export type ControllerAuthorizationClientFailureCode =
  (typeof ControllerAuthorizationClientFailureCode)[keyof typeof ControllerAuthorizationClientFailureCode];

export class ControllerAuthorizationClientError extends Error {
  constructor(
    readonly code: ControllerAuthorizationClientFailureCode,
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "ControllerAuthorizationClientError";
  }
}

const normalizeBase64Url = (value: string): string => {
  const paddingLength = (4 - (value.length % 4)) % 4;
  return `${value.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat(
    paddingLength
  )}`;
};

export const decodeBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  try {
    if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) {
      throw new Error("Invalid base64url value");
    }
    const decoded = atob(normalizeBase64Url(value));
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch (cause) {
    throw new ControllerAuthorizationClientError(
      ControllerAuthorizationClientFailureCode.InvalidCredential,
      "The platform returned invalid passkey request options.",
      cause
    );
  }
};

export const encodeBase64Url = (value: ArrayBuffer): string => {
  const bytes = new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
};

export const toPublicKeyCredentialRequestOptions = (
  options: ControllerAuthorizationRequestOptions
): PublicKeyCredentialRequestOptions => ({
  challenge: decodeBase64Url(options.challenge),
  rpId: options.rpId,
  timeout: options.timeout,
  userVerification: options.userVerification,
  allowCredentials: options.allowCredentials.map((credential) => ({
    type: credential.type,
    id: decodeBase64Url(credential.id),
    transports: Array.from(credential.transports),
  })),
});

const requireCredentialContainer = (): CredentialsContainer => {
  if (
    typeof navigator === "undefined" ||
    !navigator.credentials ||
    typeof navigator.credentials.get !== "function" ||
    typeof PublicKeyCredential === "undefined" ||
    typeof AuthenticatorAssertionResponse === "undefined"
  ) {
    throw new ControllerAuthorizationClientError(
      ControllerAuthorizationClientFailureCode.UnsupportedWebAuthn,
      "Passkey approval is not supported by this browser."
    );
  }
  return navigator.credentials;
};

const isPublicKeyCredential = (
  credential: Credential
): credential is PublicKeyCredential =>
  typeof PublicKeyCredential !== "undefined" &&
  credential instanceof PublicKeyCredential;

const isAuthenticatorAssertionResponse = (
  response: AuthenticatorResponse
): response is AuthenticatorAssertionResponse =>
  typeof AuthenticatorAssertionResponse !== "undefined" &&
  response instanceof AuthenticatorAssertionResponse;

const invalidCredential = (): ControllerAuthorizationClientError =>
  new ControllerAuthorizationClientError(
    ControllerAuthorizationClientFailureCode.InvalidCredential,
    "The browser did not return a valid passkey assertion."
  );

export const collectControllerAssertion = async ({
  grantDescriptor,
  publicKey,
  intent,
}: {
  grantDescriptor: ControllerDeviceGrantDescriptor;
  publicKey: ControllerAuthorizationRequestOptions;
  intent: CanonicalControllerAuthorizationIntent;
}): Promise<ControllerAssertionEvidence> => {
  let credential: Credential | null;
  try {
    credential = await requireCredentialContainer().get({
      publicKey: toPublicKeyCredentialRequestOptions(publicKey),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "NotAllowedError") {
      throw new ControllerAuthorizationClientError(
        ControllerAuthorizationClientFailureCode.UserCancelled,
        "Passkey approval was cancelled.",
        cause
      );
    }
    throw cause;
  }

  if (!credential || !isPublicKeyCredential(credential)) {
    throw invalidCredential();
  }

  const { response } = credential;
  if (!isAuthenticatorAssertionResponse(response)) {
    throw invalidCredential();
  }

  return {
    kind: ControllerAssertionEvidenceKindEnum.ControllerAssertion,
    intent,
    credentialId: encodeBase64Url(credential.rawId),
    clientDataJSON: encodeBase64Url(response.clientDataJSON),
    authenticatorData: encodeBase64Url(response.authenticatorData),
    signature: encodeBase64Url(response.signature),
    userHandle:
      response.userHandle === null
        ? null
        : encodeBase64Url(response.userHandle),
    grantDescriptor,
  };
};
