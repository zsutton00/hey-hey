import { join } from 'node:path';
import { CliState } from '../credentials/cli-state';
import { LocalKeyPairStore } from './local-key-pair-store';

/** The installation owns local CLI state independently of hosted configuration. */
export class LocalCliState extends CliState {
  constructor(
    installationDirectory: string,
    readonly localKeyPairStore = new LocalKeyPairStore(),
  ) {
    super(
      localKeyPairStore,
      join(installationDirectory, 'cli'),
      'heyhey:oauth:local-application',
      'http://localhost:3000',
    );
  }
}
