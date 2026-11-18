import { homedir } from 'node:os';
import { join } from 'node:path';
import { LOCAL_DEV_PROJECT, LOCAL_PROJECT } from './compose';
import { LocalKeyPairStore } from './local-key-pair-store';

/**
 * Everything one local Hey Hey's data lives in: its installation folder, its Docker Compose
 * project (and so its containers and volumes), and this computer's pairing in the OS keychain.
 * The installed `heyhey local` and the developer-only `heyhey local dev` each have their own, so
 * dev data and checkout migrations never reach the installed app's data.
 */
export interface LocalWorkspace {
  label: 'installed' | 'dev';
  directory: string;
  project: string;
  credentialService: string;
}

export function installedWorkspace(home = homedir()): LocalWorkspace {
  return {
    label: 'installed',
    directory: join(home, '.heyhey', 'local-application'),
    project: LOCAL_PROJECT,
    credentialService: LocalKeyPairStore.service,
  };
}

export function devWorkspace(home = homedir()): LocalWorkspace {
  return {
    label: 'dev',
    directory: join(home, '.heyhey', 'local-dev'),
    project: LOCAL_DEV_PROJECT,
    credentialService: LocalKeyPairStore.devService,
  };
}
