import type {
  MachineEnrollmentWebAuthnAttestationResponseDtoTransportsEnum,
  MachineEnrollmentWebAuthnRegistrationCredentialDto,
  MachineEnrollmentWebAuthnRegistrationOptionsDto,
} from "@hey-hey/ui-common/api";
import {
  MachineEnrollmentWebAuthnAttestationResponseDtoTransportsEnum as Transport,
  MachineEnrollmentWebAuthnRegistrationCredentialDtoAuthenticatorAttachmentEnum as Attachment,
  MachineEnrollmentWebAuthnRegistrationCredentialDtoTypeEnum as CredentialType,
} from "@hey-hey/ui-common/api";

export class WebAuthnUnsupportedError extends Error {
  constructor() {
    super("This browser does not support native passkeys.");
    this.name = "WebAuthnUnsupportedError";
  }
}

export class WebAuthnCancelledError extends Error {
  constructor() {
    super("Passkey creation was cancelled.");
    this.name = "WebAuthnCancelledError";
  }
}

export interface WebAuthnCredentialsContainer {
  create(options: CredentialCreationOptions): Promise<Credential | null>;
}

const getBrowserCredentials = (): WebAuthnCredentialsContainer | undefined => {
  if (typeof navigator === "undefined" || !navigator.credentials) {
    return undefined;
  }
  return navigator.credentials;
};

const decodeBase64Url = (value: string): Uint8Array => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const encodeBase64Url = (value: ArrayBuffer): string => {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

interface NativeRegistrationCredential extends Credential {
  rawId: ArrayBuffer;
  response: AuthenticatorAttestationResponse;
  authenticatorAttachment: AuthenticatorAttachment | null;
}

const isNativeRegistrationCredential = (
  credential: Credential | null,
): credential is NativeRegistrationCredential => {
  if (!credential || typeof credential !== "object") {
    return false;
  }

  if (
    credential.type !== CredentialType.PublicKey ||
    !("rawId" in credential) ||
    !(credential.rawId instanceof ArrayBuffer) ||
    !("response" in credential) ||
    !credential.response ||
    typeof credential.response !== "object"
  ) {
    return false;
  }

  return (
    "clientDataJSON" in credential.response &&
    credential.response.clientDataJSON instanceof ArrayBuffer &&
    "attestationObject" in credential.response &&
    credential.response.attestationObject instanceof ArrayBuffer
  );
};

const toAttachment = (
  attachment: AuthenticatorAttachment | null,
): MachineEnrollmentWebAuthnRegistrationCredentialDto["authenticatorAttachment"] => {
  if (attachment === Attachment.Platform) {
    return Attachment.Platform;
  }
  if (attachment === Attachment.CrossPlatform) {
    return Attachment.CrossPlatform;
  }
  return null;
};

const isTransport = (
  value: string,
): value is MachineEnrollmentWebAuthnAttestationResponseDtoTransportsEnum =>
  value === Transport.Usb ||
  value === Transport.Nfc ||
  value === Transport.Ble ||
  value === Transport.Internal ||
  value === Transport.Hybrid;

export const createMachineEnrollmentCredential = async (
  options: MachineEnrollmentWebAuthnRegistrationOptionsDto,
  credentials: WebAuthnCredentialsContainer | undefined = getBrowserCredentials(),
): Promise<MachineEnrollmentWebAuthnRegistrationCredentialDto> => {
  if (!credentials) {
    throw new WebAuthnUnsupportedError();
  }

  let credential: Credential | null;
  try {
    credential = await credentials.create({
      publicKey: {
        challenge: decodeBase64Url(options.challenge),
        rp: options.rp,
        user: {
          ...options.user,
          id: decodeBase64Url(options.user.id),
        },
        pubKeyCredParams: options.pubKeyCredParams,
        authenticatorSelection: options.authenticatorSelection,
        attestation: options.attestation,
      },
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "NotAllowedError" || error.name === "AbortError")
    ) {
      throw new WebAuthnCancelledError();
    }
    throw error;
  }

  if (!isNativeRegistrationCredential(credential)) {
    throw new Error("The browser did not return a valid passkey credential.");
  }

  const reportedTransports: string[] =
    "getTransports" in credential.response &&
    typeof credential.response.getTransports === "function"
      ? credential.response.getTransports()
      : [];

  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: CredentialType.PublicKey,
    response: {
      clientDataJSON: encodeBase64Url(credential.response.clientDataJSON),
      attestationObject: encodeBase64Url(
        credential.response.attestationObject,
      ),
      transports: reportedTransports.filter(isTransport),
    },
    authenticatorAttachment: toAttachment(credential.authenticatorAttachment),
  };
};
