import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CredentialPathOptions {
  heyHeyHomeDir?: string | undefined;
}

export interface CredentialPathConfig {
  heyHeyHomeDir: string;
  credentialDir: string;
  keyringDir: string;
  encryptedDir: string;
  sessionsDir: string;
}

export const resolveCredentialPaths = (
  options: CredentialPathOptions = {},
): CredentialPathConfig => {
  const heyHeyHomeDir =
    options.heyHeyHomeDir ?? process.env['HEYHEY_HOME_DIR'] ?? join(homedir(), '.heyhey');

  const credentialDir = join(heyHeyHomeDir, 'credentials');

  return {
    heyHeyHomeDir,
    credentialDir,
    keyringDir: join(credentialDir, 'keyring'),
    encryptedDir: join(credentialDir, 'encrypted'),
    sessionsDir: join(heyHeyHomeDir, 'sessions'),
  };
};
