export interface KeyringCredentialEntry {
  account: string;
  password: string;
}

export interface KeyringModule {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials?(service: string): Promise<KeyringCredentialEntry[]>;
}

const isKeyringModule = (value: unknown): value is KeyringModule => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<KeyringModule>;
  return (
    typeof candidate.getPassword === 'function' &&
    typeof candidate.setPassword === 'function' &&
    typeof candidate.deletePassword === 'function'
  );
};

export type KeyringModuleLoader = () => Promise<KeyringModule | null>;

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

export const loadKeyringModule: KeyringModuleLoader = async () => {
  try {
    const imported: unknown = await dynamicImport('keytar');

    if (isKeyringModule(imported)) {
      return imported;
    }

    const maybeDefault =
      imported && typeof imported === 'object' && 'default' in imported
        ? (imported.default as unknown)
        : null;

    if (isKeyringModule(maybeDefault)) {
      return maybeDefault;
    }

    return null;
  } catch {
    return null;
  }
};
