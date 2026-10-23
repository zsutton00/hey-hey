import { Injectable } from '@nestjs/common';
import {
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import {
  decodeAttestationObject,
  decodeCredentialPublicKey,
  parseAuthenticatorData,
  cose,
} from '@simplewebauthn/server/helpers';
import * as crypto from 'node:crypto';
import { MachineEnrollmentWebAuthnRegistrationCredentialDto } from '../../generated';

export interface VerifiedMachineEnrollmentCredential {
  credentialId: string;
  credentialPublicKeyX: Buffer;
  credentialPublicKeyY: Buffer;
  credentialAaguid: Buffer;
  credentialSignCount: number;
  credentialBackupEligible: boolean;
  credentialBackupState: boolean;
  credentialTransports: string[];
  credentialFingerprint: string;
}

export interface MachineEnrollmentWebAuthnVerifier {
  verifyRegistration(input: {
    credential: MachineEnrollmentWebAuthnRegistrationCredentialDto;
    expectedChallenge: string;
    expectedOrigin: string;
    expectedRpId: string;
  }): Promise<VerifiedMachineEnrollmentCredential>;
}

export function verifyMachineEnrollmentEs256Signature(input: {
  publicKeyX: Uint8Array;
  publicKeyY: Uint8Array;
  signedBytes: Uint8Array;
  signature: Uint8Array;
}): boolean {
  const x = Buffer.from(input.publicKeyX);
  const y = Buffer.from(input.publicKeyY);
  if (x.length !== 32 || y.length !== 32) {
    return false;
  }
  try {
    const publicKey = crypto.createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: x.toString('base64url'),
        y: y.toString('base64url'),
      },
      format: 'jwk',
    });
    return crypto.verify(
      'sha256',
      Buffer.from(input.signedBytes),
      publicKey,
      Buffer.from(input.signature),
    );
  } catch {
    return false;
  }
}

@Injectable()
export class SimpleWebAuthnRegistrationVerifier
  implements MachineEnrollmentWebAuthnVerifier
{
  async verifyRegistration(input: {
    credential: MachineEnrollmentWebAuthnRegistrationCredentialDto;
    expectedChallenge: string;
    expectedOrigin: string;
    expectedRpId: string;
  }): Promise<VerifiedMachineEnrollmentCredential> {
    const { credential } = input;
    const rawId = this.decodeBase64Url(credential.rawId);
    const id = this.decodeBase64Url(credential.id);

    if (!this.bytesEqual(rawId, id) || credential.type !== 'public-key') {
      throw new Error('invalid-registration-credential');
    }

    const response: RegistrationResponseJSON = {
      id: credential.id,
      rawId: credential.rawId,
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
      clientExtensionResults: {},
      response: {
        clientDataJSON: credential.response.clientDataJSON,
        attestationObject: credential.response.attestationObject,
        transports: Array.from(
          credential.response.transports,
        ) as AuthenticatorTransportFuture[],
      },
    };

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.expectedOrigin,
      expectedRPID: input.expectedRpId,
      expectedType: 'webauthn.create',
      requireUserPresence: true,
      requireUserVerification: true,
      supportedAlgorithmIDs: [cose.COSEALG.ES256],
    });

    if (!verification.verified) {
      throw new Error('registration-verification-failed');
    }

    const attestationObject = decodeAttestationObject(
      Uint8Array.from(
        this.decodeBase64Url(credential.response.attestationObject),
      ),
    );
    const authData = attestationObject.get('authData');
    const parsed = parseAuthenticatorData(authData);
    const expectedRpIdHash = crypto
      .createHash('sha256')
      .update(input.expectedRpId)
      .digest();

    if (
      !this.bytesEqual(parsed.rpIdHash, expectedRpIdHash) ||
      !parsed.flags.up ||
      !parsed.flags.uv ||
      !parsed.flags.at ||
      !parsed.credentialID ||
      !parsed.credentialPublicKey ||
      !parsed.aaguid ||
      !this.bytesEqual(rawId, parsed.credentialID)
    ) {
      throw new Error('registration-authenticator-data-failed');
    }

    const verifiedCredential = verification.registrationInfo.credential;
    const verifiedCredentialId = this.decodeBase64Url(verifiedCredential.id);
    if (!this.bytesEqual(rawId, verifiedCredentialId)) {
      throw new Error('registration-credential-id-mismatch');
    }

    const coseKey = decodeCredentialPublicKey(verifiedCredential.publicKey);
    if (
      !cose.isCOSEPublicKeyEC2(coseKey) ||
      coseKey.get(cose.COSEKEYS.alg) !== cose.COSEALG.ES256 ||
      coseKey.get(cose.COSEKEYS.crv) !== cose.COSECRV.P256
    ) {
      throw new Error('registration-algorithm-failed');
    }

    const x = coseKey.get(cose.COSEKEYS.x);
    const y = coseKey.get(cose.COSEKEYS.y);
    if (!x || !y || x.length !== 32 || y.length !== 32) {
      throw new Error('registration-public-key-failed');
    }

    const credentialId = Buffer.from(rawId).toString('base64url');
    const credentialPublicKey = Buffer.from(verifiedCredential.publicKey);
    return {
      credentialId,
      credentialPublicKeyX: Buffer.from(x),
      credentialPublicKeyY: Buffer.from(y),
      credentialAaguid: Buffer.from(parsed.aaguid),
      credentialSignCount: parsed.counter,
      credentialBackupEligible: parsed.flags.be,
      credentialBackupState: parsed.flags.bs,
      credentialTransports: Array.from(credential.response.transports),
      credentialFingerprint: crypto
        .createHash('sha256')
        .update(credentialPublicKey)
        .digest('hex'),
    };
  }

  private decodeBase64Url(value: string): Buffer {
    if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error('invalid-base64url');
    }
    return Buffer.from(value, 'base64url');
  }

  private bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
    return (
      left.length === right.length &&
      crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right))
    );
  }
}
