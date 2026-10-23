import * as crypto from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { MachineId } from '../../../types';
import { MachineChallengeService } from '../machine-challenge.service';

describe('MachineChallengeService', () => {
  // One real Ed25519 keypair shared across the suite: the public key is the
  // PEM SPKI string the service verifies against (mirroring the CLI's
  // `encodePublicKeyPem`), the private key signs challenges as the CLI does.
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({
    type: 'spki',
    format: 'pem',
  }) as string;

  const signChallenge = (challenge: Buffer): string =>
    crypto.sign(null, challenge, privateKey).toString('base64');

  function makeService(
    machineRow: {
      publicKey: string;
      tokenHash?: string;
      userId: string;
      user?: { isDemoUser: boolean };
      organizationId?: string | null;
      authorizationProtocolVersion?: number;
      authorizationState?:
        | 'LEGACY'
        | 'CONTROLLER_ENROLLMENT_REQUIRED'
        | 'READY';
      revokedAt: Date | null;
    } | null,
  ) {
    const findUnique = jest.fn().mockResolvedValue(machineRow);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      db: { machine: { findUnique, updateMany } },
    } as unknown as PrismaService;
    return {
      service: new MachineChallengeService(prisma),
      findUnique,
      updateMany,
    };
  }

  describe('lookupMachine', () => {
    it('returns null when the machine does not exist', async () => {
      const { service } = makeService(null);
      const result = await service.lookupMachine('missing' as MachineId);
      expect(result).toBeNull();
    });

    it('returns the public key, owner, and revokedAt for a known machine', async () => {
      const revokedAt = new Date('2026-02-02T00:00:00Z');
      const { service } = makeService({
        publicKey: publicKeyPem,
        userId: 'owner-1',
        user: { isDemoUser: true },
        revokedAt,
      });
      const result = await service.lookupMachine('machine-1' as MachineId);
      expect(result).toEqual({
        publicKey: publicKeyPem,
        tokenHash: undefined,
        userId: 'owner-1',
        isDemoUser: true,
        organizationId: undefined,
        authorizationProtocolVersion: 1,
        authorizationState: undefined,
        revokedAt,
      });
    });
  });

  describe('recordLastSeen', () => {
    it('stamps lastSeen for a live (non-revoked) machine', async () => {
      const { service, updateMany } = makeService(null);
      await service.recordLastSeen('machine-1' as MachineId);
      expect(updateMany).toHaveBeenCalledTimes(1);
      const arg = updateMany.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'machine-1', revokedAt: null });
      expect(arg.data.lastSeen).toBeInstanceOf(Date);
    });

    it('is a silent no-op when the machine row is gone (count 0)', async () => {
      const { service, updateMany } = makeService(null);
      updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.recordLastSeen('missing' as MachineId),
      ).resolves.toBeUndefined();
    });

    it('swallows a failed write so the heartbeat/auth path never breaks', async () => {
      const { service, updateMany } = makeService(null);
      updateMany.mockRejectedValue(new Error('db down'));
      await expect(
        service.recordLastSeen('machine-1' as MachineId),
      ).resolves.toBeUndefined();
    });
  });

  describe('verifyChallengeSignature', () => {
    it('accepts a signature produced by the matching private key', () => {
      const { service } = makeService(null);
      const challenge = crypto.randomBytes(32);
      const signature = signChallenge(challenge);
      expect(
        service.verifyChallengeSignature(publicKeyPem, challenge, signature),
      ).toBe(true);
    });

    it('rejects a signature over different bytes', () => {
      const { service } = makeService(null);
      const signature = signChallenge(crypto.randomBytes(32));
      // Verify against a *different* challenge than was signed.
      expect(
        service.verifyChallengeSignature(
          publicKeyPem,
          crypto.randomBytes(32),
          signature,
        ),
      ).toBe(false);
    });

    it('rejects a signature from a different keypair', () => {
      const { service } = makeService(null);
      const other = crypto.generateKeyPairSync('ed25519');
      const challenge = crypto.randomBytes(32);
      const foreignSignature = crypto
        .sign(null, challenge, other.privateKey)
        .toString('base64');
      expect(
        service.verifyChallengeSignature(
          publicKeyPem,
          challenge,
          foreignSignature,
        ),
      ).toBe(false);
    });

    it('returns false (never throws) on a malformed public key', () => {
      const { service } = makeService(null);
      const challenge = crypto.randomBytes(32);
      expect(
        service.verifyChallengeSignature(
          'not-a-pem',
          challenge,
          signChallenge(challenge),
        ),
      ).toBe(false);
    });

    it('returns false (never throws) on a malformed signature', () => {
      const { service } = makeService(null);
      const challenge = crypto.randomBytes(32);
      expect(
        service.verifyChallengeSignature(
          publicKeyPem,
          challenge,
          'not-base64-$$$',
        ),
      ).toBe(false);
    });
  });
});
