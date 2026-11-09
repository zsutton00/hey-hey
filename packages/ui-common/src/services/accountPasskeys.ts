import type {
  AccountPasskeyAssertionCredentialDto,
  AccountPasskeyAssertionOptionsDto,
  AccountPasskeyDto,
  AccountPasskeyRegistrationCredentialDto,
  AccountPasskeyRegistrationCredentialDtoResponseTransportsEnum,
  AccountPasskeyRegistrationOptionsDto,
  AccountProofDto,
  BrowserSessionResponseDto,
} from "@hey-hey/contracts/api/models";
import {
  decodeBase64Url,
  encodeBase64Url,
} from "../data/controllerAuthorization/webauthnAssertion";
import type { UnifiedApiClient } from "../clients/serviceClients";
import { getApiClient } from "../clients/runtime";
import { acceptBrowserAuthResponse } from "./authService";

/**
 * Browser side of account-login passkeys. The browser only runs the native
 * WebAuthn ceremony and forwards the result; the API verifies it and decides
 * every session outcome. Account passkeys never carry controller authority.
 */

export class PasskeyCeremonyCancelledError extends Error {
  constructor() {
    super("The passkey request was cancelled.");
    this.name = "PasskeyCeremonyCancelledError";
  }
}

export class PasskeyUnsupportedError extends Error {
  constructor() {
    super("This browser does not support passkeys.");
    this.name = "PasskeyUnsupportedError";
  }
}

export const isPasskeySupported = (): boolean =>
  typeof globalThis.PublicKeyCredential === "function" &&
  typeof globalThis.navigator?.credentials?.get === "function";

const TRANSPORTS: readonly string[] = [
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
];

const isTransport = (
  value: string,
): value is AccountPasskeyRegistrationCredentialDtoResponseTransportsEnum =>
  TRANSPORTS.includes(value);

const attachmentOf = (
  credential: PublicKeyCredential,
): "platform" | "cross-platform" | null =>
  credential.authenticatorAttachment === "platform" ||
  credential.authenticatorAttachment === "cross-platform"
    ? credential.authenticatorAttachment
    : null;

/** Runs a WebAuthn ceremony, turning a user cancellation into a typed error. */
const runCeremony = async (
  ceremony: () => Promise<Credential | null>,
): Promise<PublicKeyCredential> => {
  if (!isPasskeySupported()) {
    throw new PasskeyUnsupportedError();
  }
  let credential: Credential | null;
  try {
    credential = await ceremony();
  } catch (cause) {
    if (
      cause instanceof DOMException &&
      (cause.name === "NotAllowedError" || cause.name === "AbortError")
    ) {
      throw new PasskeyCeremonyCancelledError();
    }
    throw cause;
  }
  if (!(credential instanceof PublicKeyCredential)) {
    throw new PasskeyCeremonyCancelledError();
  }
  return credential;
};

export const createPasskeyCredential = async (
  options: AccountPasskeyRegistrationOptionsDto,
): Promise<AccountPasskeyRegistrationCredentialDto> => {
  const credential = await runCeremony(() =>
    navigator.credentials.create({
      publicKey: {
        challenge: decodeBase64Url(options.challenge),
        rp: { id: options.rpId, name: options.rpName },
        user: {
          id: decodeBase64Url(options.userHandle),
          name: options.userName,
          displayName: options.userDisplayName,
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        excludeCredentials: options.excludeCredentialIds.map((id) => ({
          type: "public-key",
          id: decodeBase64Url(id),
        })),
        authenticatorSelection: {
          residentKey: "required",
          requireResidentKey: true,
          userVerification: "required",
        },
        timeout: options.timeoutMs,
        attestation: "none",
      },
    }),
  );
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: "public-key",
    authenticatorAttachment: attachmentOf(credential),
    response: {
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      attestationObject: encodeBase64Url(response.attestationObject),
      transports: (response.getTransports?.() ?? []).filter(isTransport),
    },
  };
};

export const getPasskeyAssertion = async (
  options: AccountPasskeyAssertionOptionsDto,
): Promise<AccountPasskeyAssertionCredentialDto> => {
  const credential = await runCeremony(() =>
    navigator.credentials.get({
      publicKey: {
        challenge: decodeBase64Url(options.challenge),
        rpId: options.rpId,
        allowCredentials: options.allowCredentialIds.map((id) => ({
          type: "public-key",
          id: decodeBase64Url(id),
        })),
        userVerification: "required",
        timeout: options.timeoutMs,
      },
    }),
  );
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: "public-key",
    authenticatorAttachment: attachmentOf(credential),
    response: {
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      authenticatorData: encodeBase64Url(response.authenticatorData),
      signature: encodeBase64Url(response.signature),
      userHandle: response.userHandle
        ? encodeBase64Url(response.userHandle)
        : null,
    },
  };
};

const resolveClient = (client?: UnifiedApiClient): UnifiedApiClient =>
  client ?? getApiClient();

/** How the person proves they own the account before a passkey change. */
export type AccountProofInput =
  { kind: "password"; currentPassword: string } | { kind: "passkey" };

const accountProof = async (
  client: UnifiedApiClient,
  proof: AccountProofInput,
  operation: "register" | "remove",
  passkeyId?: string,
): Promise<AccountProofDto> => {
  if (proof.kind === "password") {
    return { currentPassword: proof.currentPassword };
  }
  const options = await client.startAccountPasskeyProof({
    accountPasskeyProofOptionsRequestDto: {
      operation,
      ...(passkeyId ? { passkeyId } : {}),
    },
  });
  return {
    passkeyAssertion: await getPasskeyAssertion(options.data.data),
  };
};

/**
 * Fresh account proof authorizing a new account passkey. Used when a pairing
 * claim also enrolls its passkey for sign-in.
 */
export const requestRegistrationProof = (
  proof: AccountProofInput,
  client?: UnifiedApiClient,
): Promise<AccountProofDto> =>
  accountProof(resolveClient(client), proof, "register");

export const listAccountPasskeys = async (
  client?: UnifiedApiClient,
): Promise<AccountPasskeyDto[]> => {
  const response = await resolveClient(client).listAccountPasskeys();
  return response.data.data.passkeys;
};

export const renameAccountPasskey = async (
  passkeyId: string,
  name: string,
  client?: UnifiedApiClient,
): Promise<AccountPasskeyDto> => {
  const response = await resolveClient(client).renameAccountPasskey({
    passkeyId,
    accountPasskeyRenameDto: { name },
  });
  return response.data.data;
};

/**
 * Adds a passkey. On success every earlier browser session ends and this
 * browser continues with the single fresh session the API returned.
 */
export const addAccountPasskey = async (
  name: string,
  proof: AccountProofInput,
  client?: UnifiedApiClient,
): Promise<BrowserSessionResponseDto> => {
  const resolved = resolveClient(client);
  const proofDto = await accountProof(resolved, proof, "register");
  const options = await resolved.startAccountPasskeyRegistration();
  const credential = await createPasskeyCredential(options.data.data);
  const response = await resolved.registerAccountPasskey({
    accountPasskeyRegistrationDto: { name, credential, proof: proofDto },
  });
  return acceptBrowserAuthResponse(response.data.data);
};

/** Removes a passkey, with the same session replacement as adding one. */
export const removeAccountPasskey = async (
  passkeyId: string,
  proof: AccountProofInput,
  client?: UnifiedApiClient,
): Promise<BrowserSessionResponseDto> => {
  const resolved = resolveClient(client);
  const proofDto = await accountProof(resolved, proof, "remove", passkeyId);
  const response = await resolved.removeAccountPasskey({
    passkeyId,
    accountPasskeyRemovalDto: { proof: proofDto },
  });
  return acceptBrowserAuthResponse(response.data.data);
};

/** Signs in with a discoverable passkey through the normal browser session. */
export const signInWithPasskey = async (
  client?: UnifiedApiClient,
): Promise<BrowserSessionResponseDto> => {
  const resolved = resolveClient(client);
  const options = await resolved.startAccountPasskeySignIn();
  const credential = await getPasskeyAssertion(options.data.data);
  const response = await resolved.completeAccountPasskeySignIn({
    accountPasskeySignInDto: { credential },
  });
  return acceptBrowserAuthResponse(response.data.data);
};
