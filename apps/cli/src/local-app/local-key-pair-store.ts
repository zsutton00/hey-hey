import { KeyPairStore } from '../credentials/keypair';
import { KeyringPlatformStore, type KeyringEntryFactory } from '../credentials/platforms/keyring';

/** Local application identity never resolves a hosted backend or profile namespace. */
export class LocalKeyPairStore extends KeyPairStore {
  static readonly service = 'heyhey-local-cli';

  constructor(entryFactory?: KeyringEntryFactory) {
    super({
      platformStoreOverride: new KeyringPlatformStore(entryFactory, LocalKeyPairStore.service),
      namespaceOverride: '',
    });
  }
}
