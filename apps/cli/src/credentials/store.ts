import { StorageFailureError } from './errors';
import { EncryptedCredentialFileStore } from './fallback';
import type { OAuthCredential, StoredAccessCredential, StoredRefreshCredential } from './types';

export const validateKey = (key: string): void => {
  if (!key || key.length === 0) {
    throw new StorageFailureError('Key cannot be empty');
  }
  if (key.length > 255) {
    throw new StorageFailureError('Key cannot exceed 255 characters');
  }
  if (/[\0/\\]/.test(key)) {
    throw new StorageFailureError(
      'Key contains invalid characters (null byte, slash, or backslash)',
    );
  }
  if (/[`$;|&<>()]/.test(key)) {
    throw new StorageFailureError('Key contains invalid characters (shell metacharacters)');
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const parseStoredAccessCredential = (value: unknown): StoredAccessCredential => {
  if (!isRecord(value)) {
    throw new Error('Stored access credential must be an object.');
  }

  const accessToken = value['accessToken'];
  const expiresAt = value['expiresAt'];
  if (typeof accessToken !== 'string' || typeof expiresAt !== 'string') {
    throw new Error('Stored access credential is missing required fields.');
  }

  const scope = value['scope'];
  const tokenType = value['tokenType'];
  const issuedAt = value['issuedAt'];

  return {
    accessToken,
    expiresAt,
    ...(isStringArray(scope) ? { scope } : {}),
    ...(typeof tokenType === 'string' ? { tokenType } : {}),
    ...(typeof issuedAt === 'string' ? { issuedAt } : {}),
  };
};

const parseStoredRefreshCredential = (value: unknown): StoredRefreshCredential => {
  if (!isRecord(value)) {
    throw new Error('Stored refresh credential must be an object.');
  }

  const refreshToken = value['refreshToken'];
  if (typeof refreshToken !== 'string') {
    throw new Error('Stored refresh credential is missing refreshToken.');
  }

  const issuedAt = value['issuedAt'];
  return {
    refreshToken,
    ...(typeof issuedAt === 'string' ? { issuedAt } : {}),
  };
};

const serializeAccess = (credential: OAuthCredential): StoredAccessCredential => ({
  accessToken: credential.accessToken,
  expiresAt: credential.expiresAt,
  ...(credential.scope ? { scope: credential.scope } : {}),
  ...(credential.tokenType ? { tokenType: credential.tokenType } : {}),
  ...(credential.issuedAt ? { issuedAt: credential.issuedAt } : {}),
});

const serializeRefresh = (credential: OAuthCredential): StoredRefreshCredential | null => {
  if (!credential.refreshToken) return null;
  return {
    refreshToken: credential.refreshToken,
    ...(credential.issuedAt ? { issuedAt: credential.issuedAt } : {}),
  };
};

const fromStored = (
  access: StoredAccessCredential,
  refresh?: StoredRefreshCredential | null,
): OAuthCredential => ({
  accessToken: access.accessToken,
  expiresAt: access.expiresAt,
  ...(refresh?.refreshToken ? { refreshToken: refresh.refreshToken } : {}),
  ...(access.scope ? { scope: access.scope } : {}),
  ...(access.tokenType ? { tokenType: access.tokenType } : {}),
  ...(access.issuedAt ? { issuedAt: access.issuedAt } : {}),
});

export class CredentialStore {
  constructor(private readonly encryptedFileStore = new EncryptedCredentialFileStore()) {}

  private async storePair(key: string, credential: OAuthCredential): Promise<void> {
    validateKey(key);
    const accessPayload = await this.encryptedFileStore.serialize(serializeAccess(credential));
    const refreshValue = serializeRefresh(credential);
    const refreshPayload = refreshValue
      ? await this.encryptedFileStore.serialize(refreshValue)
      : null;

    await this.encryptedFileStore.store(key, 'access', accessPayload);
    if (refreshPayload) {
      await this.encryptedFileStore.store(key, 'refresh', refreshPayload);
    } else {
      await this.encryptedFileStore.deleteKind(key, 'refresh');
    }
  }

  async store(key: string, credential: OAuthCredential): Promise<void> {
    await this.storePair(key, credential);
  }

  async retrieve(key: string): Promise<OAuthCredential | null> {
    validateKey(key);
    const accessRaw = await this.encryptedFileStore.retrieve(key, 'access');
    if (!accessRaw) return null;
    const refreshRaw = await this.encryptedFileStore.retrieve(key, 'refresh');
    const access = await this.encryptedFileStore.parse(accessRaw, parseStoredAccessCredential);
    const refresh = refreshRaw
      ? await this.encryptedFileStore.parse(refreshRaw, parseStoredRefreshCredential)
      : null;
    return fromStored(access, refresh);
  }

  async update(key: string, credential: OAuthCredential): Promise<void> {
    await this.storePair(key, credential);
  }

  async delete(key: string): Promise<void> {
    validateKey(key);
    await this.encryptedFileStore.delete(key);
  }
}

export type { OAuthCredential } from './types';
export { StorageFailureError } from './errors';
