import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const ED25519_SPKI_PREFIX_LENGTH = 12;
const ED25519_RAW_KEY_LENGTH = 32;

/**
 * Owns the server's Ed25519 signing keypair: a single keypair that is global
 * to the server (not per-machine) and used to sign every trigger envelope.
 *
 * The private half is loaded from `TRIGGER_SIGNING_PRIVATE_KEY` (raw PEM or
 * base64-wrapped PEM); when unset we fall back to an ephemeral keypair so
 * local development still boots, but a paired CLI cannot verify those
 * signatures — the warning is logged loudly.
 *
 * The public half is exposed in two shapes: a `crypto.KeyObject` for in-process
 * verification (tests, future server-side checks) and a base64-encoded raw
 * 32-byte key for delivery to the CLI at pairing.
 */
@Injectable()
export class ServerSigningKeyService {
  private readonly logger = new Logger(ServerSigningKeyService.name);

  private readonly privateKey: crypto.KeyObject;
  private readonly publicKey: crypto.KeyObject;
  private readonly publicKeyBase64: string;

  constructor(private readonly configService: ConfigService) {
    const keys = this.loadSigningKey();
    this.privateKey = keys.privateKey;
    this.publicKey = keys.publicKey;
    this.publicKeyBase64 = this.encodeRawPublicKeyBase64(keys.publicKey);
  }

  getPrivateKey(): crypto.KeyObject {
    return this.privateKey;
  }

  getPublicKey(): crypto.KeyObject {
    return this.publicKey;
  }

  /**
   * Base64-encoded raw 32-byte Ed25519 public key. Standard base64 (not
   * base64url) — this is the wire format the CLI reconstructs into a raw
   * Ed25519 verifier.
   */
  getPublicKeyBase64(): string {
    return this.publicKeyBase64;
  }

  private loadSigningKey(): {
    privateKey: crypto.KeyObject;
    publicKey: crypto.KeyObject;
  } {
    const configured = this.configService.get<string>(
      'TRIGGER_SIGNING_PRIVATE_KEY',
    );

    if (configured && configured.trim().length > 0) {
      const pem = this.decodePem(configured);
      const privateKey = crypto.createPrivateKey(pem);
      if (privateKey.asymmetricKeyType !== 'ed25519') {
        throw new Error(
          'TRIGGER_SIGNING_PRIVATE_KEY must be an Ed25519 private key',
        );
      }
      const publicKey = crypto.createPublicKey(privateKey);
      this.logger.log('Loaded Ed25519 server signing key from configuration');
      return { privateKey, publicKey };
    }

    const generated = crypto.generateKeyPairSync('ed25519');
    this.logger.warn(
      'TRIGGER_SIGNING_PRIVATE_KEY not configured — generated an ephemeral ' +
        'Ed25519 keypair. Signed trigger frames will NOT verify on a paired ' +
        'CLI. Configure the server signing key before relying on triggers.',
    );
    return { privateKey: generated.privateKey, publicKey: generated.publicKey };
  }

  private decodePem(value: string): string {
    const trimmed = value.trim();
    if (trimmed.includes('-----BEGIN')) {
      return trimmed;
    }
    return Buffer.from(trimmed, 'base64').toString('utf8');
  }

  private encodeRawPublicKeyBase64(publicKey: crypto.KeyObject): string {
    const spkiDer = publicKey.export({ format: 'der', type: 'spki' });
    if (!Buffer.isBuffer(spkiDer)) {
      throw new Error('Expected SPKI DER export to return a Buffer');
    }
    const rawKey = spkiDer.subarray(ED25519_SPKI_PREFIX_LENGTH);
    if (rawKey.length !== ED25519_RAW_KEY_LENGTH) {
      throw new Error(
        `Expected ${ED25519_RAW_KEY_LENGTH}-byte raw Ed25519 public key, got ${rawKey.length}`,
      );
    }
    return rawKey.toString('base64');
  }
}
