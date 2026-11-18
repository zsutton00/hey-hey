import { KeyPairStore } from '../credentials/keypair';
import { KeyringPlatformStore, type KeyringEntryFactory } from '../credentials/platforms/keyring';

/** Local application identity never resolves a hosted backend or profile namespace. */
export class LocalKeyPairStore extends KeyPairStore {
  static readonly service = 'heyhey-local-cli';
  /** `heyhey local dev` pairs this computer separately, so dev and installed pairing never mix. */
  static readonly devService = 'heyhey-local-dev-cli';

  constructor(
    entryFactory?: KeyringEntryFactory,
    readonly service = LocalKeyPairStore.service,
  ) {
    super({
      platformStoreOverride: new KeyringPlatformStore(entryFactory, service),
      namespaceOverride: '',
    });
  }
}
