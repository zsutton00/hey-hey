import { KeyPairStore } from './keypair';
import type { PlatformStore } from './platforms/types';

export class MemoryPlatformStore implements PlatformStore {
  public readonly name = 'test-memory';
  public readonly values: Map<string, string>;

  public constructor(initialValues: ReadonlyMap<string, string> = new Map()) {
    this.values = new Map(initialValues);
  }

  public async store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  public async retrieve(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  public async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  public async isAvailable(): Promise<boolean> {
    return true;
  }
}

export const createTestKeyPairStore = (
  options: { currentMachineId?: string | null } = {},
): KeyPairStore =>
  new KeyPairStore({
    platformStoreOverride: new MemoryPlatformStore(
      options.currentMachineId
        ? new Map([['test/current/machine_id', options.currentMachineId]])
        : undefined,
    ),
    namespaceOverride: 'test/',
  });
