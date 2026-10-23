import {
  buildInjectedCredential,
  getActiveCredentialKey,
  OAuthClient,
  validateInjectedToken,
} from '../auth/index';
import { CredentialStore } from '../credentials/store';

export type LoginCommandOptions = {
  credentialStore?: CredentialStore;
  oauthClient?: OAuthClient;
};

const getFlagValue = (argv: string[], flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    return undefined;
  }
  return value;
};

const runTokenLogin = async (
  argv: string[],
  credentialStore: CredentialStore,
): Promise<boolean> => {
  const accessToken = getFlagValue(argv, '--token');
  if (!accessToken) {
    console.error('Login failed: --token requires a JWT value.');
    return false;
  }

  const validation = validateInjectedToken(accessToken);
  if (!validation.valid) {
    console.error(`Login failed: ${validation.error}`);
    return false;
  }

  try {
    const refreshToken = getFlagValue(argv, '--refresh-token');
    const expiresAt = getFlagValue(argv, '--expires-at');
    const credential = buildInjectedCredential({
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    });
    await credentialStore.store(getActiveCredentialKey(), credential);
    console.log('Login successful! Credentials stored.');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown login error';
    console.error(`Login failed: ${message}`);
    return false;
  }
};

export const runLoginCommand = async (
  argv: string[] = [],
  options: LoginCommandOptions = {},
): Promise<boolean> => {
  if (argv.includes('--token')) {
    return runTokenLogin(argv, options.credentialStore ?? new CredentialStore());
  }

  console.log('Preparing login...');
  try {
    if (argv.includes('--force')) {
      const credentialStore = options.credentialStore ?? new CredentialStore();
      await credentialStore.delete(getActiveCredentialKey());
      console.log('Cleared the current profile OAuth credential.');
    }
    const client = options.oauthClient ?? new OAuthClient();
    const alreadyAuthed = await client.isAuthenticated();

    if (alreadyAuthed) {
      console.log('Already authenticated.');
      return true;
    }

    console.log('Opening browser for authentication... Waiting for callback.');
    const loginResult = await client.login();
    if (loginResult.success) {
      console.log('Login successful! Credentials stored.');
      return true;
    }

    console.error(`Login failed: ${loginResult.error}`);
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown login error';
    console.error(`Login failed: ${message}`);
    return false;
  }
};
