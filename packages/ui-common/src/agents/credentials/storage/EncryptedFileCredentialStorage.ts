import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
} from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir, hostname, platform, userInfo } from "node:os";
import { promisify } from "node:util";
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
  ensureRestrictedFile,
  fileExists,
  readJsonFile,
  writeJsonFileAtomic,
} from "./fileUtils";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const RECORD_SALT_BYTES = 16;
const KEY_INFO_SALT_BYTES = 16;

const scryptAsync = promisify(scryptCallback);

interface EncryptedBlob {
  version: 1;
  iv: string;
  salt: string;
  tag: string;
  ciphertext: string;
}

interface EncryptedIndexEntry extends AgentCredentialMetadata {
  fileName: string;
}

interface EncryptedIndexDocument {
  entries: EncryptedIndexEntry[];
}

interface KeyInfoDocument {
  mode: "passphrase" | "machine";
  salt: string;
  createdAt: number;
}

export interface EncryptedFileCredentialStorageOptions
  extends CredentialPathOptions {
  passphrase?: string;
  machineKeyPath?: string;
}

const toBase64 = (value: Uint8Array): string =>
  Buffer.from(value).toString("base64");

const fromBase64 = (value: string): Buffer => Buffer.from(value, "base64");

const encodeAccountId = (accountId: AgentAccountId): string =>
  Buffer.from(accountId, "utf8").toString("base64url");

const createCredentialFileName = (
  agentType: AgentType,
  accountId: AgentAccountId
): string => `${agentType}-${encodeAccountId(accountId)}.credential.json`;

const parseEncryptedIndex = (value: unknown): EncryptedIndexDocument => {
  if (!value || typeof value !== "object") {
    return { entries: [] };
  }

  const document = value as Partial<EncryptedIndexDocument>;
  if (!Array.isArray(document.entries)) {
    return { entries: [] };
  }

  const entries = document.entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as Partial<EncryptedIndexEntry>;
      if (typeof candidate.fileName !== "string") {
        return null;
      }

      try {
        const metadata = parseCredentialMetadata(candidate);
        return {
          ...metadata,
          fileName: candidate.fileName,
        } satisfies EncryptedIndexEntry;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is EncryptedIndexEntry => entry !== null);

  return { entries };
};

const parseKeyInfo = (value: unknown): KeyInfoDocument | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<KeyInfoDocument>;
  if (
    (candidate.mode !== "passphrase" && candidate.mode !== "machine") ||
    typeof candidate.salt !== "string" ||
    typeof candidate.createdAt !== "number"
  ) {
    return null;
  }

  return candidate as KeyInfoDocument;
};

export class EncryptedFileCredentialStorage
  implements CredentialStorageBackend
{
  readonly kind = "encrypted-file" as const;

  private readonly encryptedDir: string;
  private readonly indexPath: string;
  private readonly keyInfoPath: string;
  private readonly machineKeyPath: string;
  private readonly passphrase: string | null;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: EncryptedFileCredentialStorageOptions = {}) {
    const paths = resolveCredentialPaths({
      heyHeyHomeDir: options.heyHeyHomeDir,
    });
    this.encryptedDir = paths.encryptedDir;
    this.indexPath = join(this.encryptedDir, "index.json");
    this.keyInfoPath = join(this.encryptedDir, "key-info.json");
    this.machineKeyPath =
      options.machineKeyPath ?? join(this.encryptedDir, "machine.key");
    this.passphrase = options.passphrase ?? null;
  }

  async getCredential(
    agentType: AgentType,
    accountId: AgentAccountId
  ): Promise<AgentCredentialRecord | null> {
    const index = await this.readIndex();
    const entry = index.entries.find(
      (candidate) =>
        candidate.agentType === agentType && candidate.accountId === accountId
    );

    const fileName =
      entry?.fileName ?? createCredentialFileName(agentType, accountId);
    const credentialPath = join(this.encryptedDir, fileName);

    if (!(await fileExists(credentialPath))) {
      return null;
    }

    const encryptedBlob = await readJsonFile<EncryptedBlob | null>(
      credentialPath,
      null
    );

    if (!encryptedBlob) {
      return null;
    }

    const decrypted = await this.decryptRecord(encryptedBlob);
    return parseCredentialRecord(JSON.parse(decrypted));
  }

  async storeCredential(credential: AgentCredentialRecord): Promise<void> {
    await this.runMutation(async () => {
      await ensureDirectory(this.encryptedDir);
      const fileName = createCredentialFileName(
        credential.agentType,
        credential.accountId
      );
      const credentialPath = join(this.encryptedDir, fileName);

      const encryptedBlob = await this.encryptRecord(
        JSON.stringify(credential)
      );
      await writeJsonFileAtomic(credentialPath, encryptedBlob);

      const index = await this.readIndex();
      const entries = index.entries.filter(
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
        fileName,
      });

      await writeJsonFileAtomic(this.indexPath, { entries });
    });
  }

  async listCredentials(
    agentType?: AgentType
  ): Promise<AgentCredentialMetadata[]> {
    const index = await this.readIndex();
    const entries =
      agentType === undefined
        ? index.entries
        : index.entries.filter((entry) => entry.agentType === agentType);

    return entries.map(({ fileName: _unused, ...metadata }) => metadata);
  }

  async deleteCredential(
    agentType: AgentType,
    accountId: AgentAccountId
  ): Promise<boolean> {
    return this.runMutation(async () => {
      const fileName = createCredentialFileName(agentType, accountId);
      const credentialPath = join(this.encryptedDir, fileName);
      const existed = await fileExists(credentialPath);
      await deleteFileIfPresent(credentialPath);

      const index = await this.readIndex();
      const entries = index.entries.filter(
        (entry) =>
          !(entry.agentType === agentType && entry.accountId === accountId)
      );
      await writeJsonFileAtomic(this.indexPath, { entries });

      return existed;
    });
  }

  async clearAll(): Promise<void> {
    await this.runMutation(async () => {
      await rm(this.encryptedDir, { recursive: true, force: true });
    });
  }

  private async encryptRecord(plaintext: string): Promise<EncryptedBlob> {
    const key = await this.deriveEncryptionKey();
    const iv = randomBytes(IV_LENGTH);
    const recordSalt = randomBytes(RECORD_SALT_BYTES);

    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(recordSalt);

    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(plaintext, "utf8")),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return {
      version: 1,
      iv: toBase64(iv),
      salt: toBase64(recordSalt),
      tag: toBase64(tag),
      ciphertext: toBase64(ciphertext),
    };
  }

  private async decryptRecord(blob: EncryptedBlob): Promise<string> {
    if (blob.version !== 1) {
      throw new Error(
        `Unsupported encrypted credential format: ${blob.version}`
      );
    }

    const key = await this.deriveEncryptionKey();
    const iv = fromBase64(blob.iv);
    const recordSalt = fromBase64(blob.salt);
    const tag = fromBase64(blob.tag);
    const ciphertext = fromBase64(blob.ciphertext);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(recordSalt);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return plaintext.toString("utf8");
  }

  private async deriveEncryptionKey(): Promise<Buffer> {
    const keyInfo = await this.readOrCreateKeyInfo();
    const baseSecret = await this.getBaseSecret(keyInfo.mode);
    const salt = fromBase64(keyInfo.salt);
    const derived = (await scryptAsync(baseSecret, salt, KEY_LENGTH)) as Buffer;
    return Buffer.from(derived);
  }

  private async getBaseSecret(mode: "passphrase" | "machine"): Promise<Buffer> {
    if (mode === "passphrase") {
      if (!this.passphrase) {
        throw new Error("A passphrase is required to decrypt credentials");
      }
      return Buffer.from(this.passphrase, "utf8");
    }

    const machineSecret = await this.readOrCreateMachineSecret();
    const identity = `${platform()}|${hostname()}|${homedir()}|${this.getUserName()}`;
    return Buffer.concat([Buffer.from(identity, "utf8"), machineSecret]);
  }

  private getUserName(): string {
    try {
      return userInfo().username;
    } catch {
      return "unknown-user";
    }
  }

  private async readOrCreateMachineSecret(): Promise<Buffer> {
    await ensureRestrictedFile(this.machineKeyPath);
    const current = await readFile(this.machineKeyPath, "utf8").catch(() => "");
    if (current.trim().length > 0) {
      return fromBase64(current.trim());
    }

    const secret = randomBytes(KEY_LENGTH);
    await writeFile(this.machineKeyPath, toBase64(secret), {
      encoding: "utf8",
      mode: 0o600,
    });

    return secret;
  }

  private async readOrCreateKeyInfo(): Promise<KeyInfoDocument> {
    const existing = parseKeyInfo(
      await readJsonFile<unknown>(this.keyInfoPath, null)
    );
    if (existing) {
      return existing;
    }

    const created: KeyInfoDocument = {
      mode: this.passphrase ? "passphrase" : "machine",
      salt: toBase64(randomBytes(KEY_INFO_SALT_BYTES)),
      createdAt: Date.now(),
    };

    await writeJsonFileAtomic(this.keyInfoPath, created);
    return created;
  }

  private async readIndex(): Promise<EncryptedIndexDocument> {
    const raw = await readJsonFile<unknown>(this.indexPath, { entries: [] });
    return parseEncryptedIndex(raw);
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
