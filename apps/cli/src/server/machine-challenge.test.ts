import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createTestKeyPairStore } from '../credentials/keypair.test-support';
import { MachineChallengeSigner } from './machine-challenge';

describe('MachineChallengeSigner', () => {
  it('signs challenge bytes through the current machine key owner', async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const keyPairStore = createTestKeyPairStore({ currentMachineId: 'machine-1' });
    vi.spyOn(keyPairStore, 'loadPrivateKey').mockResolvedValue(
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    );
    const signer = new MachineChallengeSigner(keyPairStore);
    const challenge = Buffer.from('platform-challenge');

    const signature = await signer.sign(challenge);

    expect(signature).not.toBeNull();
    expect(crypto.verify(null, challenge, publicKey, Buffer.from(signature ?? '', 'base64'))).toBe(
      true,
    );
  });

  it('returns null when no current machine identity is available', async () => {
    const keyPairStore = createTestKeyPairStore();
    const loadPrivateKey = vi.spyOn(keyPairStore, 'loadPrivateKey');
    const signer = new MachineChallengeSigner(keyPairStore);

    await expect(signer.sign(Buffer.from('challenge'))).resolves.toBeNull();
    expect(loadPrivateKey).not.toHaveBeenCalled();
  });
});
