import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import {
  ControllerAssertionEvidence,
  ControllerAuthorizationDenialReason,
} from '../../generated';
import { ControllerAuthorizationWebAuthnConfigService } from './controller-authorization-webauthn-config.service';
import { verifyMachineEnrollmentEs256Signature } from '../machine-pairing/machine-enrollment-webauthn-verifier';

export interface ControllerAssertionCredential {
  credentialId: string;
  credentialPublicKeyX: Uint8Array;
  credentialPublicKeyY: Uint8Array;
  userId: string;
}

export interface VerifiedControllerAssertion {
  signCount: number;
}

export class ControllerAssertionVerificationError extends Error {
  constructor(readonly reason: ControllerAuthorizationDenialReason) {
    super(reason);
  }
}

@Injectable()
export class ControllerAssertionVerifierService {
  constructor(
    private readonly webauthnConfig: ControllerAuthorizationWebAuthnConfigService,
  ) {}

  verify(input: {
    assertion: ControllerAssertionEvidence;
    expectedChallenge: string;
    credential: ControllerAssertionCredential;
  }): VerifiedControllerAssertion {
    const { assertion, credential } = input;
    if (assertion.credentialId !== credential.credentialId) {
      this.deny(ControllerAuthorizationDenialReason.CredentialMismatch);
    }

    const clientDataBytes = this.decode(
      assertion.clientDataJSON,
      ControllerAuthorizationDenialReason.ChallengeMismatch,
    );
    const clientData = this.parseClientData(clientDataBytes);
    if (clientData.type !== 'webauthn.get') {
      this.deny(ControllerAuthorizationDenialReason.ChallengeMismatch);
    }
    if (clientData.challenge !== input.expectedChallenge) {
      this.deny(ControllerAuthorizationDenialReason.ChallengeMismatch);
    }
    if (clientData.origin !== this.webauthnConfig.origin) {
      this.deny(ControllerAuthorizationDenialReason.OriginMismatch);
    }

    const authenticatorData = this.decode(
      assertion.authenticatorData,
      ControllerAuthorizationDenialReason.SignatureInvalid,
    );
    if (authenticatorData.length < 37) {
      this.deny(ControllerAuthorizationDenialReason.SignatureInvalid);
    }
    const expectedRpIdHash = crypto
      .createHash('sha256')
      .update(this.webauthnConfig.rpId)
      .digest();
    if (!this.bytesEqual(authenticatorData.subarray(0, 32), expectedRpIdHash)) {
      this.deny(ControllerAuthorizationDenialReason.RpIdMismatch);
    }

    const flags = authenticatorData[32]!;
    if ((flags & 0x01) === 0) {
      this.deny(ControllerAuthorizationDenialReason.UserPresenceRequired);
    }
    if ((flags & 0x04) === 0) {
      this.deny(ControllerAuthorizationDenialReason.UserVerificationRequired);
    }

    if (
      assertion.userHandle !== null &&
      assertion.userHandle !==
        Buffer.from(credential.userId).toString('base64url')
    ) {
      this.deny(ControllerAuthorizationDenialReason.CredentialMismatch);
    }

    const signature = this.decode(
      assertion.signature,
      ControllerAuthorizationDenialReason.SignatureInvalid,
    );
    const signedBytes = Buffer.concat([
      authenticatorData,
      crypto.createHash('sha256').update(clientDataBytes).digest(),
    ]);
    const verified = verifyMachineEnrollmentEs256Signature({
      publicKeyX: credential.credentialPublicKeyX,
      publicKeyY: credential.credentialPublicKeyY,
      signedBytes,
      signature,
    });
    if (!verified) {
      this.deny(ControllerAuthorizationDenialReason.SignatureInvalid);
    }

    return { signCount: authenticatorData.readUInt32BE(33) };
  }

  private parseClientData(bytes: Buffer): {
    type?: unknown;
    challenge?: unknown;
    origin?: unknown;
    crossOrigin?: unknown;
  } {
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString('utf8'));
    } catch {
      this.deny(ControllerAuthorizationDenialReason.ChallengeMismatch);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      this.deny(ControllerAuthorizationDenialReason.ChallengeMismatch);
    }
    const clientData = value as {
      type?: unknown;
      challenge?: unknown;
      origin?: unknown;
      crossOrigin?: unknown;
    };
    if (
      clientData.crossOrigin !== undefined &&
      clientData.crossOrigin !== false
    ) {
      this.deny(ControllerAuthorizationDenialReason.OriginMismatch);
    }
    return clientData;
  }

  private decode(
    value: string,
    reason: ControllerAuthorizationDenialReason,
  ): Buffer {
    if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
      this.deny(reason);
    }
    return Buffer.from(value, 'base64url');
  }

  private bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
    return (
      left.length === right.length &&
      crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right))
    );
  }

  private deny(reason: ControllerAuthorizationDenialReason): never {
    throw new ControllerAssertionVerificationError(reason);
  }
}
