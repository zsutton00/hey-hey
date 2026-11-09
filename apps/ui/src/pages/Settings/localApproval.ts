/**
 * First-time `heyhey local` pairing: the CLI opens /local with the pairing code
 * and a one-time approval secret in the URL fragment. The page keeps them only
 * in component state and submits a proof the originating CLI can
 * verify. The API stores the proof opaquely; it grants nothing on its own.
 */

import {
  LocalCodingAgentAvailability,
  type LocalCodingAgentDetectionDto,
} from "@hey-hey/ui-common/api";

const PROOF_LABEL = "heyhey-local-approval-v2";
export const LOCAL_APPROVAL_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface LocalPairingHandoff {
  code: string;
  approvalSecret: string;
  /** Coding agents the CLI found on this computer; display information only. */
  agents: LocalCodingAgentDetectionDto | null;
}

const isAvailability = (
  value: unknown,
): value is LocalCodingAgentAvailability =>
  Object.values<unknown>(LocalCodingAgentAvailability).includes(value);

const isLocalCodingAgentDetection = (
  value: unknown,
): value is LocalCodingAgentDetectionDto =>
  typeof value === "object" &&
  value !== null &&
  "claude" in value &&
  "codex" in value &&
  "opencode" in value &&
  isAvailability(value.claude) &&
  isAvailability(value.codex) &&
  isAvailability(value.opencode);

/** Validates the CLI's agent report once, where it enters the browser. */
export const parseLocalCodingAgents = (
  raw: string | null,
): LocalCodingAgentDetectionDto | null => {
  if (raw === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    return isLocalCodingAgentDetection(parsed)
      ? {
          claude: parsed.claude,
          codex: parsed.codex,
          opencode: parsed.opencode,
        }
      : null;
  } catch {
    return null;
  }
};

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

const toHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

/**
 * Binds the claim to the exact passkey this page created and to the
 * registration challenge, which commits to any first grant. The API relays the
 * proof but cannot compute it, so it cannot substitute the key or the grant.
 */
export const computeLocalApprovalProof = async (
  secret: string,
  binding: {
    enrollmentId: string;
    accountId: string;
    organizationId: string;
    controllerCredentialId: string;
    credentialPublicKeySpki: ArrayBuffer;
    registrationChallenge: string;
  },
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    fromBase64Url(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const publicKeyHash = toHex(
    await crypto.subtle.digest("SHA-256", binding.credentialPublicKeySpki),
  );
  const message = new TextEncoder().encode(
    [
      PROOF_LABEL,
      binding.enrollmentId,
      binding.accountId,
      binding.organizationId,
      binding.controllerCredentialId,
      publicKeyHash,
      binding.registrationChallenge,
    ].join("\n"),
  );
  return toBase64Url(await crypto.subtle.sign("HMAC", key, message));
};
