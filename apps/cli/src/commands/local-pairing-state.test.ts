import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  MachineControllerAuthority,
  type MachineDirectoryClient,
} from '../auth/machine-controller-authority';
import { ControllerRegistryStore } from '../credentials';
import { createTestKeyPairStore } from '../credentials/keypair.test-support';
import { ExecutionGrantStore } from '../server/controller-authorization/execution-grant-store';
import { LocalPairingStateReader } from './local-pairing-state';

const REMEMBERED = '00000000-0000-4000-8000-0000000000aa';
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.map((directory) => fs.rm(directory, { recursive: true })));
  directories.length = 0;
});

/** The local backend's machine list is the only fake; keychain and registry are real stores. */
const readState = async (rememberedMachineId: string | null, backendMachineIds: string[]) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-local-pairing-state-'));
  directories.push(directory);
  const keyPairStore = createTestKeyPairStore({ currentMachineId: rememberedMachineId });
  if (rememberedMachineId) {
    await keyPairStore.storePrivateKey(rememberedMachineId, 'private-key');
    await keyPairStore.storeMachineCredential(rememberedMachineId, 'machine-credential');
  }
  const listMachines = vi.fn().mockResolvedValue({
    data: { data: { machines: backendMachineIds.map((machineId) => ({ machineId })) } },
  });
  const authority = new MachineControllerAuthority({
    keyPairStore,
    controllerRegistryStore: new ControllerRegistryStore({
      keyPairStore,
      filePath: path.join(directory, 'controllers.json'),
    }),
    executionGrantStore: new ExecutionGrantStore({
      keyPairStore,
      filePath: path.join(directory, 'grants.json'),
    }),
    machineDirectory: { listMachines } satisfies MachineDirectoryClient,
  });
  const state = await new LocalPairingStateReader(
    keyPairStore,
    'http://localhost:3000/api/v1',
    undefined,
    authority,
  ).read();
  return { state, listMachines, keyPairStore };
};

it('reports a remembered machine that a recreated installation does not know as not recognised', async () => {
  const { state, keyPairStore } = await readState(REMEMBERED, []);

  expect(state).toBe('not-recognised');
  // Reading the state never removes the record; it is replaced only by a successful pairing.
  expect(await keyPairStore.loadCurrentMachineId()).toBe(REMEMBERED);
  expect(await keyPairStore.loadMachineCredential(REMEMBERED)).toBe('machine-credential');
});

it('reports a remembered machine its own installation knows as recognised', async () => {
  const { state } = await readState(REMEMBERED, [REMEMBERED]);

  expect(state).toBe('recognised');
});

it('reports a cleared keychain as none without asking the backend', async () => {
  const { state, listMachines } = await readState(null, [REMEMBERED]);

  expect(state).toBe('none');
  expect(listMachines).not.toHaveBeenCalled();
});
