import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';
import { ServerSigningKeyService } from '../server-signing-key.service';

function generatePkcs8Pem(): {
  pem: string;
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
} {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  return { pem, privateKey, publicKey };
}

function rawEd25519FromKeyObject(key: crypto.KeyObject): Buffer {
  const spkiDer = key.export({ format: 'der', type: 'spki' }) as Buffer;
  return spkiDer.subarray(12);
}

function makeConfigService(value: string | undefined): {
  get: jest.Mock;
} {
  return { get: jest.fn().mockReturnValue(value) };
}

describe('ServerSigningKeyService', () => {
  describe('with TRIGGER_SIGNING_PRIVATE_KEY configured', () => {
    it('returns a base64 public key whose 32 raw bytes match the configured private key', () => {
      const { pem, publicKey } = generatePkcs8Pem();
      const service = new ServerSigningKeyService(
        makeConfigService(pem) as never,
      );

      const base64 = service.getPublicKeyBase64();
      const decoded = Buffer.from(base64, 'base64');

      expect(decoded.length).toBe(32);
      expect(decoded.equals(rawEd25519FromKeyObject(publicKey))).toBe(true);
    });

    it('reconstructs the same Ed25519 public key the underlying KeyObject exposes', () => {
      const { pem } = generatePkcs8Pem();
      const service = new ServerSigningKeyService(
        makeConfigService(pem) as never,
      );

      const base64 = service.getPublicKeyBase64();
      const reconstructed = crypto.createPublicKey({
        key: Buffer.concat([
          Buffer.from('302a300506032b6570032100', 'hex'),
          Buffer.from(base64, 'base64'),
        ]),
        format: 'der',
        type: 'spki',
      });

      expect(reconstructed.asymmetricKeyType).toBe('ed25519');
      // The reconstructed SPKI should byte-equal the service's public-key SPKI,
      // i.e. the wire-shape round-trips losslessly.
      const reconstructedSpki = reconstructed.export({
        format: 'der',
        type: 'spki',
      }) as Buffer;
      const liveSpki = service.getPublicKey().export({
        format: 'der',
        type: 'spki',
      }) as Buffer;
      expect(reconstructedSpki.equals(liveSpki)).toBe(true);
    });

    it('returns a stable public key across repeated calls on the same instance', () => {
      const { pem } = generatePkcs8Pem();
      const service = new ServerSigningKeyService(
        makeConfigService(pem) as never,
      );

      const first = service.getPublicKeyBase64();
      const second = service.getPublicKeyBase64();
      const third = service.getPublicKeyBase64();

      expect(first).toBe(second);
      expect(second).toBe(third);
    });

    it('accepts a base64-wrapped PEM (env vars often strip newlines)', () => {
      const { pem, publicKey } = generatePkcs8Pem();
      const wrapped = Buffer.from(pem, 'utf8').toString('base64');
      const service = new ServerSigningKeyService(
        makeConfigService(wrapped) as never,
      );

      const decoded = Buffer.from(service.getPublicKeyBase64(), 'base64');
      expect(decoded.equals(rawEd25519FromKeyObject(publicKey))).toBe(true);
    });

    it('rejects a non-Ed25519 private key with a descriptive error', () => {
      const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

      expect(
        () => new ServerSigningKeyService(makeConfigService(pem) as never),
      ).toThrow(/Ed25519/);
    });
  });

  describe('when TRIGGER_SIGNING_PRIVATE_KEY is unset', () => {
    it('logs a warning and falls back to an ephemeral Ed25519 keypair (dev only)', () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      const service = new ServerSigningKeyService(
        makeConfigService(undefined) as never,
      );

      const decoded = Buffer.from(service.getPublicKeyBase64(), 'base64');
      expect(decoded.length).toBe(32);
      expect(service.getPublicKey().asymmetricKeyType).toBe('ed25519');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]![0]).toMatch(
        /TRIGGER_SIGNING_PRIVATE_KEY not configured/,
      );

      warnSpy.mockRestore();
    });
  });
});
