import { join } from 'node:path';
import { KeyPairStore } from './keypair';
import { ControllerRegistryStore } from './controller-registry';
import { CredentialStore } from './store';
import { EncryptedCredentialFileStore } from './fallback';
import { OAuthClient } from '../auth/oauth-client';
import { ExecutionGrantStore } from '../server/controller-authorization/execution-grant-store';
import { AuthorizationReplayStore } from '../server/controller-authorization/authorization-replay-store';

/** Storage collaborators selected together by the command composition root. */
export class CliState {
  readonly credentials: CredentialStore;
  readonly oauthClient: OAuthClient;
  readonly controllerRegistryStore: ControllerRegistryStore;
  readonly executionGrantStore: ExecutionGrantStore;
  readonly authorizationReplayStore: AuthorizationReplayStore;

  constructor(
    readonly keyPairStore = new KeyPairStore(),
    readonly directory?: string,
    readonly credentialKey?: string,
    apiBaseUrl?: string,
  ) {
    this.credentials = directory
      ? new CredentialStore(new EncryptedCredentialFileStore(join(directory, 'credentials')))
      : new CredentialStore();
    this.oauthClient = new OAuthClient({
      credentialStore: this.credentials,
      ...(apiBaseUrl ? { config: { baseUrl: apiBaseUrl } } : {}),
      ...(credentialKey ? { credentialKey } : {}),
    });
    this.controllerRegistryStore = new ControllerRegistryStore({
      keyPairStore,
      ...(directory ? { directory: join(directory, 'controllers') } : {}),
    });
    this.executionGrantStore = new ExecutionGrantStore({
      keyPairStore,
      ...(directory ? { directory: join(directory, 'authorization') } : {}),
    });
    this.authorizationReplayStore = new AuthorizationReplayStore({
      keyPairStore,
      ...(directory ? { directory: join(directory, 'authorization') } : {}),
    });
  }
}
