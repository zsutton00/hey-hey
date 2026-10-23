import crypto from 'node:crypto';
import type { MachineEffectHttpMethod, MachineEffectProofDto } from '../shared/api';
import type { KeyPairStore } from '../credentials';
import { canonicalizeJson, canonicalizeJsonObject } from '../shared/canonical-json';

export interface MachineEffectProofInput {
  operationId: string;
  method: MachineEffectHttpMethod;
  path: string;
  payload: object;
  organizationId: string;
  effectId: string;
}

export interface SignedMachineEffectRequest {
  machineCredential: string;
  proof: MachineEffectProofDto;
}

/** Builds fresh exact-request proof without exposing machine identity on the wire. */
export class MachineEffectProofSigner {
  public constructor(private readonly keyPairStore: KeyPairStore) {}

  public async sign(input: MachineEffectProofInput): Promise<SignedMachineEffectRequest> {
    const machineId = await this.keyPairStore.loadCurrentMachineId();
    if (!machineId) {
      throw new Error('Machine-effect proof requires a paired machine.');
    }
    const [machineCredential, privateKeyPem] = await Promise.all([
      this.keyPairStore.loadMachineCredential(machineId),
      this.keyPairStore.loadPrivateKey(machineId),
    ]);
    if (!machineCredential || !privateKeyPem) {
      throw new Error('Machine-effect proof requires complete local machine credentials.');
    }

    const unsignedProof = {
      version: 1,
      operationId: input.operationId,
      method: input.method,
      path: input.path,
      bodySha256: crypto
        .createHash('sha256')
        .update(canonicalizeJsonObject(input.payload), 'utf8')
        .digest('hex'),
      organizationId: input.organizationId,
      effectId: input.effectId,
      nonce: crypto.randomUUID(),
      timestampMs: Date.now(),
    } satisfies Omit<MachineEffectProofDto, 'signature'>;
    const signature = crypto
      .sign(
        null,
        Buffer.from(canonicalizeJson(unsignedProof), 'utf8'),
        crypto.createPrivateKey(privateKeyPem),
      )
      .toString('base64');

    return {
      machineCredential,
      proof: { ...unsignedProof, signature } satisfies MachineEffectProofDto,
    };
  }
}
