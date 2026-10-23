import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import type { KeyPairStore } from '../credentials/index';
import { createTestKeyPairStore } from '../credentials/keypair.test-support';
import { runRotateCommand, type MachinesRotateClient } from './rotate';

const MACHINE_ID = 'machine-abc';
const CREDENTIAL = 'machine-token-xyz';

/** A real Ed25519 public key (DER/SPKI) so the PEM encoder has valid bytes. */
const realPublicKeyDer = (): Buffer =>
  generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }) as Buffer;

interface RotateHarness {
  keyPairStore: KeyPairStore;
  stage: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
}

const makeKeyPairStore = (
  overrides: {
    machineId?: string | null;
    credential?: string | null;
  } = {},
): RotateHarness => {
  const stage = vi.fn(async () => ({ publicKey: realPublicKeyDer() }));
  const commit = vi.fn(async () => {});
  const abort = vi.fn(async () => {});
  const resume = vi.fn(async () => {});
  const keyPairStore = createTestKeyPairStore();
  vi.spyOn(keyPairStore, 'loadCurrentMachineId').mockImplementation(async () =>
    overrides.machineId === undefined ? MACHINE_ID : overrides.machineId,
  );
  vi.spyOn(keyPairStore, 'loadMachineCredential').mockImplementation(async () =>
    overrides.credential === undefined ? CREDENTIAL : overrides.credential,
  );
  vi.spyOn(keyPairStore, 'stageKeyRotation').mockImplementation(stage);
  vi.spyOn(keyPairStore, 'commitKeyRotation').mockImplementation(commit);
  vi.spyOn(keyPairStore, 'abortKeyRotation').mockImplementation(abort);
  vi.spyOn(keyPairStore, 'resumeKeyRotation').mockImplementation(resume);
  return { keyPairStore, stage, commit, abort, resume };
};

describe('runRotateCommand', () => {
  it('rotates with the machine credential as bearer and commits only on success', async () => {
    const harness = makeKeyPairStore();
    let presentedCredential: string | null = null;
    const rotate = vi.fn<MachinesRotateClient['rotateMachineKey']>(async () => ({
      data: {
        success: true,
        message: 'rotated',
        timestamp: '2026-06-14T00:00:00.000Z',
        statusCode: 200,
        data: { machineId: MACHINE_ID, rotatedAt: '2026-06-14T00:00:00.000Z' },
      },
    }));
    const makeMachinesApi = (credential: string): MachinesRotateClient => {
      presentedCredential = credential;
      return { rotateMachineKey: rotate };
    };

    const ok = await runRotateCommand({
      keyPairStore: harness.keyPairStore,
      makeMachinesApi,
      log: vi.fn(),
      logError: vi.fn(),
    });

    expect(ok).toBe(true);
    // The durable machine credential is the bearer — not the OAuth user JWT.
    expect(presentedCredential).toBe(CREDENTIAL);
    // Resume runs before staging so a prior half-applied swap is settled first.
    expect(harness.resume).toHaveBeenCalledBefore(harness.stage);
    const [machineIdArg, pemArg] = rotate.mock.calls[0]!;
    expect(machineIdArg).toBe(MACHINE_ID);
    expect(pemArg).toContain('BEGIN PUBLIC KEY');
    // Commit only after the server accepted the new key; never aborted.
    expect(harness.commit).toHaveBeenCalledOnce();
    expect(harness.abort).not.toHaveBeenCalled();
  });

  it('aborts the stage and does not commit when the rotate request fails', async () => {
    const harness = makeKeyPairStore();
    const rotate = vi.fn<MachinesRotateClient['rotateMachineKey']>(async () => {
      throw new Error('network down');
    });
    const logError = vi.fn();

    const ok = await runRotateCommand({
      keyPairStore: harness.keyPairStore,
      makeMachinesApi: () => ({ rotateMachineKey: rotate }),
      log: vi.fn(),
      logError,
    });

    expect(ok).toBe(false);
    expect(harness.abort).toHaveBeenCalledOnce();
    expect(harness.commit).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('network down'));
  });

  it('fails fast when the machine is not paired', async () => {
    const harness = makeKeyPairStore({ machineId: null });
    const logError = vi.fn();

    const ok = await runRotateCommand({
      keyPairStore: harness.keyPairStore,
      makeMachinesApi: () => ({ rotateMachineKey: vi.fn() }),
      log: vi.fn(),
      logError,
    });

    expect(ok).toBe(false);
    expect(harness.stage).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('not paired'));
  });

  it('fails fast when no machine credential is stored', async () => {
    const harness = makeKeyPairStore({ credential: null });
    const logError = vi.fn();

    const ok = await runRotateCommand({
      keyPairStore: harness.keyPairStore,
      makeMachinesApi: () => ({ rotateMachineKey: vi.fn() }),
      log: vi.fn(),
      logError,
    });

    expect(ok).toBe(false);
    expect(harness.stage).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('no stored credential'));
  });
});
