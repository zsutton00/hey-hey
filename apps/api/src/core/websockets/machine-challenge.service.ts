import * as crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MachineId, UserId } from '../../types';
import { AuthorizationProtocolVersion } from '../../generated';

/**
 * The stored-machine fields the gateway needs to run a challenge-response:
 * the PEM SPKI public key the CLI's private key must sign against, the owner
 * the verified connection authenticates as, and the revocation timestamp that
 * disqualifies the credential.
 */
export interface MachineLookup {
  publicKey: string;
  tokenHash: string;
  userId: UserId;
  isDemoUser: boolean;
  organizationId: string | null;
  authorizationProtocolVersion: AuthorizationProtocolVersion;
  authorizationState: 'LEGACY' | 'CONTROLLER_ENROLLMENT_REQUIRED' | 'READY';
  revokedAt: Date | null;
}

/**
 * Server side of the machine-credential challenge-response. Looks up the
 * paired machine for a presented machineId and verifies an Ed25519 signature
 * over the connection challenge against the machine's stored public key.
 *
 * The stored `machine.publicKey` is a PEM SPKI string (the CLI's
 * `encodePublicKeyPem`); the CLI signs the raw challenge bytes with the
 * matching private key (`crypto.sign(null, challenge, privateKey)`), so the
 * gateway verifies with the null-algorithm Ed25519 path against the same
 * bytes.
 */
@Injectable()
export class MachineChallengeService {
  private readonly logger = new Logger(MachineChallengeService.name);
  private readonly controllerProofChallenges = new Map<
    string,
    { machineId: MachineId; expiresAt: number }
  >();

  private static readonly CONTROLLER_PROOF_CHALLENGE_TTL_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Make the gateway-issued challenge available to the paired machine's HTTP
   * controller-management calls. The challenge is deliberately kept in
   * memory, just like the socket handshake state: it is single-use, short
   * lived, and never persisted as authority or identity.
   */
  registerControllerProofChallenge(
    machineId: MachineId,
    challenge: Buffer,
  ): void {
    this.pruneControllerProofChallenges();
    this.controllerProofChallenges.set(challenge.toString('base64'), {
      machineId,
      expiresAt:
        Date.now() + MachineChallengeService.CONTROLLER_PROOF_CHALLENGE_TTL_MS,
    });
  }

  consumeControllerProofChallenge(
    machineId: MachineId,
    challenge: Buffer,
  ): boolean {
    this.pruneControllerProofChallenges();
    const key = challenge.toString('base64');
    const pending = this.controllerProofChallenges.get(key);
    if (!pending || pending.machineId !== machineId) return false;
    this.controllerProofChallenges.delete(key);
    return pending.expiresAt > Date.now();
  }

  /**
   * Load the paired machine identified by `machineId`. Returns null when no
   * such machine exists — the caller must reject the connection rather than
   * fall through to an unauthenticated state.
   */
  async lookupMachine(machineId: MachineId): Promise<MachineLookup | null> {
    const machine = await this.prisma.db.machine.findUnique({
      where: { id: machineId },
      select: {
        publicKey: true,
        tokenHash: true,
        userId: true,
        user: { select: { isDemoUser: true } },
        organizationId: true,
        authorizationProtocolVersion: true,
        authorizationState: true,
        revokedAt: true,
      },
    });

    if (!machine) {
      this.logger.warn('[machine-challenge] lookup miss', { machineId });
      return null;
    }

    if (machine.revokedAt) {
      this.logger.warn('[machine-challenge] lookup hit revoked machine', {
        machineId,
        userId: machine.userId,
        revokedAt: machine.revokedAt,
      });
    }

    return {
      publicKey: machine.publicKey,
      tokenHash: machine.tokenHash,
      userId: machine.userId as UserId,
      isDemoUser: machine.user.isDemoUser,
      organizationId: machine.organizationId,
      authorizationProtocolVersion:
        machine.authorizationProtocolVersion === 2 ? 2 : 1,
      authorizationState: machine.authorizationState,
      revokedAt: machine.revokedAt,
    };
  }

  /** Return the one-way digest used by Machine.tokenHash. */
  hashMachineCredential(credential: string): string {
    return crypto.createHash('sha256').update(credential).digest('hex');
  }

  /** Compare a presented credential digest without leaking length/content. */
  verifyMachineCredentialHash(
    storedHash: string,
    presentedCredential: string,
  ): boolean {
    return this.verifyCredentialDigest(
      storedHash,
      this.hashMachineCredential(presentedCredential),
    );
  }

  /** Revalidate the same credential digest after the challenge round-trip. */
  verifyCredentialDigest(storedHash: string, presentedDigest: string): boolean {
    const stored = Buffer.from(storedHash, 'utf8');
    const presented = Buffer.from(presentedDigest, 'utf8');
    return (
      stored.length === presented.length &&
      crypto.timingSafeEqual(stored, presented)
    );
  }

  /**
   * Stamp a machine's durable `lastSeen` with the current time.
   *
   * This is the persisted half of CLI presence: the in-memory connection map
   * tracks whether a socket is live right now, but `lastSeen` is the
   * cross-instance, pollable record the Settings → Machines list reads. It was
   * previously written nowhere, so it sat permanently null; the gateway now
   * calls this on machine authentication and on every heartbeat so presence
   * reflects a maintained signal rather than a one-time auth snapshot.
   *
   * Best-effort by contract: a failed stamp must never break the heartbeat or
   * auth path, so callers invoke it fire-and-forget and we swallow errors after
   * logging. `updateMany` (not `update`) keeps it a silent no-op when the
   * machine row is gone — e.g. unpaired mid-session — rather than throwing.
   */
  async recordLastSeen(machineId: MachineId): Promise<void> {
    try {
      const result = await this.prisma.db.machine.updateMany({
        where: { id: machineId, revokedAt: null },
        data: { lastSeen: new Date() },
      });
      this.logger.verbose('[machine-challenge] recorded lastSeen', {
        machineId,
        updated: result.count,
      });
    } catch (error) {
      this.logger.warn('[machine-challenge] failed to record lastSeen', {
        machineId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Verify a base64 Ed25519 signature over the raw challenge bytes against a
   * PEM SPKI public key. Returns false (never throws) on a malformed key,
   * malformed signature, or signature mismatch — every failure mode collapses
   * to "this connection did not prove the machine credential".
   */
  verifyChallengeSignature(
    publicKeyPem: string,
    challenge: Buffer,
    signatureB64: string,
  ): boolean {
    try {
      const publicKey = crypto.createPublicKey(publicKeyPem);
      // Ed25519 takes a null algorithm — the curve fixes the hash. Mirrors
      // the CLI's `crypto.sign(null, challenge, privateKey)` signing side.
      const verified = crypto.verify(
        null,
        challenge,
        publicKey,
        Buffer.from(signatureB64, 'base64'),
      );
      if (!verified) {
        this.logger.warn('[machine-challenge] signature verify failed');
      } else {
        this.logger.verbose('[machine-challenge] signature verify passed');
      }
      return verified;
    } catch (error) {
      this.logger.warn('[machine-challenge] signature verify errored', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private pruneControllerProofChallenges(): void {
    const now = Date.now();
    for (const [challenge, pending] of this.controllerProofChallenges) {
      if (pending.expiresAt <= now) {
        this.controllerProofChallenges.delete(challenge);
      }
    }
  }
}
