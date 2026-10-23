import { join } from "node:path";
import { dirname } from "node:path";
import type {
  AgentAccountId,
  AgentCredentialMetadata,
  AgentCredentialRecord,
  AgentType,
} from "../types";
import { resolveCredentialPaths, type CredentialPathOptions } from "../paths";
import type { CredentialStorageBackend } from "./CredentialStorageBackend";
import { parseCredentialMetadata, parseCredentialRecord } from "./schema";
import {
  deleteFileIfPresent,
  ensureDirectory,
  readJsonFile,
  writeJsonFileAtomic,
} from "./fileUtils";
import {
  loadKeyringModule,
  type KeyringModule,
  type KeyringModuleLoader,
} from "./keyringLoader";

interface KeyringIndexEntry extends AgentCredentialMetadata {
  keyringAccount: string;
}

interface KeyringIndexDocument {
  entries: KeyringIndexEntry[];
}

const DEFAULT_KEYRING_SERVICE = "heyhey-cli-agent-credentials";

const createKeyringAccountKey = (
  agentType: AgentType,
  accountId: AgentAccountId
): string => `${agentType}:${accountId}`;

const parseIndexDocument = (value: unknown): KeyringIndexDocument => {
  if (!value || typeof value !== "object") {
    return { entries: [] };
  }

  const document = value as Partial<KeyringIndexDocument>;
  if (!Array.isArray(document.entries)) {
    return { entries: [] };
  }

  const entries = document.entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as Partial<KeyringIndexEntry>;
      if (typeof candidate.keyringAccount !== "string") {
        return null;
      }

      try {
        const parsedMetadata = parseCredentialMetadata(candidate);
        return {
          ...parsedMetadata,
          keyringAccount: candidate.keyringAccount,
        } satisfies KeyringIndexEntry;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is KeyringIndexEntry => entry !== null);

  return { entries };
};

export interface KeyringCredentialStorageOptions extends CredentialPathOptions {
  serviceName?: string;
  keyringLoader?: KeyringModuleLoader;
}

export class KeyringCredentialStorage implements CredentialStorageBackend {
  readonly kind = "keyring" as const;

  private readonly indexFilePath: string;
  private readonly serviceName: string;
  private readonly keyringLoader: KeyringModuleLoader;
  private keyringModule: KeyringModule | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: KeyringCredentialStorageOptions = {}) {
    const paths = resolveCredentialPaths({
      heyHeyHomeDir: options.heyHeyHomeDir,
    });
    this.indexFilePath = join(paths.keyringDir, "index.json");
    this.serviceName = options.serviceName ?? DEFAULT_KEYRING_SERVICE;
    this.keyringLoader = options.keyringLoader ?? loadKeyringModule;
  }

  async isAvailable(): Promise<boolean> {
    const keyring = await this.getKeyring();
    return keyring !== null;
  }

  async getCredential(
    agentType: AgentType,
    accountId: AgentAccountId
  ): Promise<AgentCredentialRecord | null> {
    const keyring = await this.requireKeyring();
    const keyringAccount = createKeyringAccountKey(agentType, accountId);
    const serialized = await keyring.getPassword(
      this.serviceName,
      keyringAccount
    );
    if (!serialized) {
      return null;
    }

    return parseCredentialRecord(JSON.parse(serialized));
  }

  async storeCredential(credential: AgentCredentialRecord): Promise<void> {
    await this.runMutation(async () => {
      const keyring = await this.requireKeyring();
      const keyringAccount = createKeyringAccountKey(
        credential.agentType,
        credential.accountId
      );

      await keyring.setPassword(
        this.serviceName,
        keyringAccount,
        JSON.stringify(credential)
      );

      const document = await this.readIndex();
      const entries = document.entries.filter(
        (entry) =>
          !(
            entry.agentType === credential.agentType &&
            entry.accountId === credential.accountId
          )
      );

      entries.push({
        agentType: credential.agentType,
        accountId: credential.accountId,
        scopes: credential.scopes,
        expiresAt: credential.expiresAt,
        createdAt: credential.createdAt,
        updatedAt: credential.updatedAt,
        keyringAccount,
      });

      await this.writeIndex({ entries });
    });
  }

  async listCredentials(
    agentType?: AgentType
  ): Promise<AgentCredentialMetadata[]> {
    const document = await this.readIndex();
    const filteredEntries =
      agentType === undefined
        ? document.entries
        : document.entries.filter((entry) => entry.agentType === agentType);

    return filteredEntries.map(
      ({ keyringAccount: _unused, ...metadata }) => metadata
    );
  }

  async deleteCredential(
    agentType: AgentType,
    accountId: AgentAccountId
  ): Promise<boolean> {
    return this.runMutation(async () => {
      const keyring = await this.requireKeyring();
      const keyringAccount = createKeyringAccountKey(agentType, accountId);
      const deleted = await keyring.deletePassword(
        this.serviceName,
        keyringAccount
      );

      const document = await this.readIndex();
      const entries = document.entries.filter(
        (entry) =>
          !(entry.agentType === agentType && entry.accountId === accountId)
      );

      await this.writeIndex({ entries });
      return deleted;
    });
  }

  async clearAll(): Promise<void> {
    await this.runMutation(async () => {
      const keyring = await this.requireKeyring();
      const document = await this.readIndex();

      await Promise.all(
        document.entries.map((entry) =>
          keyring.deletePassword(this.serviceName, entry.keyringAccount)
        )
      );

      await deleteFileIfPresent(this.indexFilePath);
    });
  }

  private async getKeyring(): Promise<KeyringModule | null> {
    if (this.keyringModule) {
      return this.keyringModule;
    }

    this.keyringModule = await this.keyringLoader();
    return this.keyringModule;
  }

  private async requireKeyring(): Promise<KeyringModule> {
    const keyring = await this.getKeyring();
    if (!keyring) {
      throw new Error("OS keyring is unavailable");
    }

    return keyring;
  }

  private async readIndex(): Promise<KeyringIndexDocument> {
    const value = await readJsonFile<unknown>(this.indexFilePath, {
      entries: [],
    });
    return parseIndexDocument(value);
  }

  private async writeIndex(document: KeyringIndexDocument): Promise<void> {
    await ensureDirectory(dirname(this.indexFilePath));
    await writeJsonFileAtomic(this.indexFilePath, document);
  }

  private async runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let releaseNext!: () => void;
    this.mutationQueue = new Promise<void>((resolve) => {
      releaseNext = () => resolve();
    });

    await previous;
    try {
      return await operation();
    } finally {
      releaseNext();
    }
  }
}
