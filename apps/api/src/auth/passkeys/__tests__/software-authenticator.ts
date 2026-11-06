import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type {
  AccountPasskeyAssertionCredentialDto,
  AccountPasskeyRegistrationCredentialDto,
} from '@hey-hey/contracts/api/models';

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

const b64url = (bytes: Uint8Array | Buffer): string =>
  Buffer.from(bytes).toString('base64url');

/**
 * A minimal ES256 platform authenticator for tests: creates a discoverable
 * credential and signs assertions exactly as a browser would deliver them.
 */
export class SoftwareAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly privateKey: KeyObject;
  private readonly publicJwk: { x: string; y: string };
  private counter = 0;

  constructor(
    private readonly rpId: string,
    private readonly userHandle: string,
  ) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    this.publicJwk = { x: jwk.x!, y: jwk.y! };
  }

  get id(): string {
    return b64url(this.credentialId);
  }

  register(
    challenge: string,
    origin: string,
  ): AccountPasskeyRegistrationCredentialDto {
    const cosePublicKey = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(this.publicJwk.x, 'base64url')],
        [-3, Buffer.from(this.publicJwk.y, 'base64url')],
      ]),
    );
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      this.authDataPrefix(FLAG_UP | FLAG_UV | FLAG_AT),
      Buffer.alloc(16),
      idLength,
      this.credentialId,
      Buffer.from(cosePublicKey),
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]) as never,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: this.clientData('webauthn.create', challenge, origin),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
    };
  }

  assert(
    challenge: string,
    origin: string,
    options: { rpId?: string } = {},
  ): AccountPasskeyAssertionCredentialDto {
    this.counter += 1;
    const authData = this.authDataPrefix(FLAG_UP | FLAG_UV, options.rpId);
    const clientDataJSON = this.clientData('webauthn.get', challenge, origin);
    const signature = sign(
      'sha256',
      Buffer.concat([
        authData,
        createHash('sha256')
          .update(Buffer.from(clientDataJSON, 'base64url'))
          .digest(),
      ]),
      this.privateKey,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON,
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        userHandle: this.userHandle,
      },
    };
  }

  private authDataPrefix(flags: number, rpId = this.rpId): Buffer {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    return Buffer.concat([
      createHash('sha256').update(rpId).digest(),
      Buffer.from([flags]),
      counter,
    ]);
  }

  private clientData(type: string, challenge: string, origin: string): string {
    return b64url(
      Buffer.from(
        JSON.stringify({ type, challenge, origin, crossOrigin: false }),
      ),
    );
  }
}
