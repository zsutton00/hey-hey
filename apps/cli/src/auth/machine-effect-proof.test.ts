import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestKeyPairStore } from '../credentials/keypair.test-support';
import { MachineEffectHttpMethod } from '../shared/api/generated/api';
import { canonicalizeJson } from '../shared/canonical-json';
import { MachineEffectProofSigner } from './machine-effect-proof';

const MACHINE_ID = '00000000-0000-4000-8000-000000000001';
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000002';
const EFFECT_ID = '00000000-0000-4000-8000-000000000003';
const PATH = `/organizations/${ORGANIZATION_ID}/machine-effects`;
const PAYLOAD = { sequence: 7, decision: 'continue' };

describe(MachineEffectProofSigner.name, () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-08-29T12:00:00.000Z')));
  afterEach(() => vi.useRealTimers());

  it('signs the generated exact-request envelope with the paired machine key', async () => {
    const keyPairStore = createTestKeyPairStore({ currentMachineId: MACHINE_ID });
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    await keyPairStore.storePrivateKey(
      MACHINE_ID,
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    );
    await keyPairStore.storeMachineCredential(MACHINE_ID, 'machine-credential');

    const signed = await new MachineEffectProofSigner(keyPairStore).sign({
      operationId: 'submitMachineEffect',
      method: MachineEffectHttpMethod.Post,
      path: PATH,
      payload: PAYLOAD,
      organizationId: ORGANIZATION_ID,
      effectId: EFFECT_ID,
    });

    const { signature, ...unsigned } = signed.proof;
    expect(signed.machineCredential).toBe('machine-credential');
    expect(unsigned).toMatchObject({
      version: 1,
      operationId: 'submitMachineEffect',
      method: 'POST',
      path: PATH,
      organizationId: ORGANIZATION_ID,
      effectId: EFFECT_ID,
      timestampMs: Date.now(),
      bodySha256: crypto.createHash('sha256').update(canonicalizeJson(PAYLOAD)).digest('hex'),
    });
    expect(unsigned).not.toHaveProperty('machineId');
    expect(
      crypto.verify(
        null,
        Buffer.from(canonicalizeJson(unsigned)),
        publicKey,
        Buffer.from(signature, 'base64'),
      ),
    ).toBe(true);
  });

  it('fails before signing when paired machine credentials are incomplete', async () => {
    const keyPairStore = createTestKeyPairStore({ currentMachineId: MACHINE_ID });
    await expect(
      new MachineEffectProofSigner(keyPairStore).sign({
        operationId: 'submitMachineEffect',
        method: MachineEffectHttpMethod.Post,
        path: PATH,
        payload: PAYLOAD,
        organizationId: ORGANIZATION_ID,
        effectId: EFFECT_ID,
      }),
    ).rejects.toThrow('complete local machine credentials');
  });
});
