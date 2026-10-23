import { CredentialManager, type CredentialManagerOptions } from './CredentialManager';
import {
  createCredentialStorage,
  type CredentialStorageBackend,
  type CredentialStorageFactoryOptions,
} from './storage/index';
import {
  TokenRefreshService,
  createClaudeCredentialRefresher,
  createCodexCredentialRefresher,
  createHeyHeyApiCredentialRefresher,
  type AgentCredentialRefresher,
  type ClaudeRefresherOptions,
  type CodexRefresherOptions,
  type HeyHeyCredentialRefreshApiClient,
} from './refresh/index';
import type { AgentType } from './types';

export interface CredentialManagerFactoryOptions {
  storage?: CredentialStorageBackend | undefined;
  storageOptions?: CredentialStorageFactoryOptions | undefined;
  refreshService?: TokenRefreshService | undefined;
  refreshers?: Partial<Record<AgentType, AgentCredentialRefresher>> | undefined;
  heyHeyRefreshApiClient?: HeyHeyCredentialRefreshApiClient | undefined;
  claudeRefresher?: ClaudeRefresherOptions | undefined;
  codexRefresher?: CodexRefresherOptions | undefined;
  disableDefaultRefreshers?: boolean | undefined;
  manager?: Omit<CredentialManagerOptions, 'storage' | 'refreshService'> | undefined;
}

export interface CredentialManagerResolution {
  manager: CredentialManager;
  usingFallbackStorage: boolean;
}

const buildRefreshers = (
  options: CredentialManagerFactoryOptions,
): Partial<Record<AgentType, AgentCredentialRefresher>> => {
  const refreshers: Partial<Record<AgentType, AgentCredentialRefresher>> = {
    ...(options.refreshers ?? {}),
  };

  if (options.heyHeyRefreshApiClient) {
    refreshers.claude =
      refreshers.claude ??
      createHeyHeyApiCredentialRefresher('claude', options.heyHeyRefreshApiClient);
    refreshers.codex =
      refreshers.codex ??
      createHeyHeyApiCredentialRefresher('codex', options.heyHeyRefreshApiClient);
  }

  if (!options.disableDefaultRefreshers) {
    refreshers.claude =
      refreshers.claude ?? createClaudeCredentialRefresher(options.claudeRefresher);
    refreshers.codex = refreshers.codex ?? createCodexCredentialRefresher(options.codexRefresher);
  }

  return refreshers;
};

const hasRefresher = (refreshers: Partial<Record<AgentType, AgentCredentialRefresher>>): boolean =>
  Boolean(refreshers.claude || refreshers.codex);

export const createCredentialManager = async (
  options: CredentialManagerFactoryOptions = {},
): Promise<CredentialManagerResolution> => {
  const storageResolution = options.storage
    ? { backend: options.storage, usingFallback: false }
    : await createCredentialStorage(options.storageOptions);

  const refreshService =
    options.refreshService ??
    (() => {
      const refreshers = buildRefreshers(options);
      if (!hasRefresher(refreshers)) {
        return undefined;
      }

      return new TokenRefreshService({
        refreshers,
      });
    })();

  return {
    manager: new CredentialManager({
      storage: storageResolution.backend,
      refreshService,
      ...(options.manager ?? {}),
    }),
    usingFallbackStorage: storageResolution.usingFallback,
  };
};
