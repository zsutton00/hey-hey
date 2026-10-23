import { rm } from "node:fs/promises";
import { resolveCredentialPaths, type CredentialPathOptions } from "./paths";
import type { CredentialManager } from "./CredentialManager";

export interface CredentialLogoutOptions extends CredentialPathOptions {
  manager: CredentialManager;
  clearSessionFiles?: boolean;
}

export const clearCredentialStateOnLogout = async (
  options: CredentialLogoutOptions
): Promise<void> => {
  await options.manager.clearAllCredentials();

  if (options.clearSessionFiles === false) {
    return;
  }

  const paths = resolveCredentialPaths({
    heyHeyHomeDir: options.heyHeyHomeDir,
  });
  await rm(paths.sessionsDir, { recursive: true, force: true });
};
