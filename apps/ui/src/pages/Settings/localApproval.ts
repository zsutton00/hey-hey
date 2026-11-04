/**
 * First-time `heyhey local` pairing: the CLI opens /local with the pairing code
 * and a one-time approval secret in the URL fragment. The page keeps them only
 * in component state and submits a proof the originating CLI can
 * verify. The API stores the proof opaquely; it grants nothing on its own.
 */

const PROOF_LABEL = "heyhey-local-approval-v1";
export const LOCAL_APPROVAL_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface LocalPairingHandoff {
  code: string;
  approvalSecret: string;
}

/**
 * The fragment is cleared from the address bar as soon as it is read, but the
 * app tree remounts while the session refreshes after the name is saved. The
 * handoff is kept in memory only, so that remount does not lose it. A reload
 * does, and the person reruns heyhey local.
 */
let heldPairing: LocalPairingHandoff | null = null;

export const holdLocalPairing = (pairing: LocalPairingHandoff): void => {
  heldPairing = pairing;
};

export const heldLocalPairing = (): LocalPairingHandoff | null => heldPairing;

export const forgetLocalPairing = (): void => {
  heldPairing = null;
};

const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const toBase64Url = (bytes: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export const computeLocalApprovalProof = async (
  secret: string,
  binding: {
    enrollmentId: string;
    accountId: string;
    organizationId: string;
    controllerCredentialId: string;
  },
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    fromBase64Url(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const message = new TextEncoder().encode(
    PROOF_LABEL +
      binding.enrollmentId +
      binding.accountId +
      binding.organizationId +
      binding.controllerCredentialId,
  );
  return toBase64Url(await crypto.subtle.sign("HMAC", key, message));
};
