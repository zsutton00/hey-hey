import {
  toAgentAccountId,
  type AgentAccountId,
  type AgentCredentialInput,
  type AgentCredentialMetadata,
  type AgentCredentialRecord,
  type AgentType,
  type CredentialLifecycleMetadata,
  type CredentialManagerEvent,
} from "./types";
import type { CredentialStorageBackend } from "./storage";
import { CredentialError } from "./errors";
import type { TokenRefreshService } from "./refresh";

export interface GetCredentialOptions {
  forceRefresh?: boolean;
  refreshIfExpiringWithinMs?: number;
}

export interface CredentialManagerOptions {
  storage: CredentialStorageBackend;
  refreshService?: TokenRefreshService;
  refreshIfExpiringWithinMs?: number;
  now?: () => number;
}

const createCredentialKey = (
  agentType: AgentType,
  accountId: AgentAccountId
): string => `${agentType}:${accountId}`;

const normalizeScopes = (scopes: readonly string[]): string[] => {
  const uniqueScopes = new Set<string>();
  for (const scope of scopes) {
    const trimmed = scope.trim();
    if (trimmed.length > 0) {
      uniqueScopes.add(trimmed);
    }
  }
  return Array.from(uniqueScopes.values());
};

const normalizeCredentialRecord = (
  agentType: AgentType,
  input: AgentCredentialInput,
  now: number
): AgentCredentialRecord => {
  if (input.accessToken.trim().length === 0) {
    throw new Error("Credential access token cannot be empty");
  }

  const createdAt = input.createdAt ?? now;
  const updatedAt = input.updatedAt ?? now;

  return {
    agentType,
    accountId:
      typeof input.accountId === "string"
        ? toAgentAccountId(input.accountId)
        : input.accountId,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken ?? null,
    idToken: input.idToken ?? null,
    tokenType: input.tokenType ?? null,
    scopes: normalizeScopes(input.scopes),
    expiresAt: input.expiresAt,
    createdAt,
    updatedAt,
  };
};

const shouldRefreshCredential = (
  credential: AgentCredentialRecord,
  now: number,
  options: GetCredentialOptions,
  refreshIfExpiringWithinMs: number
): boolean => {
  if (options.forceRefresh) {
    return true;
  }

  if (credential.expiresAt === null) {
    return false;
  }

  const threshold =
    options.refreshIfExpiringWithinMs ?? refreshIfExpiringWithinMs;
  return credential.expiresAt <= now + threshold;
};

export type CredentialEventListener = (event: CredentialManagerEvent) => void;

export class CredentialManager {
  private readonly storage: CredentialStorageBackend;
  private readonly refreshService: TokenRefreshService | null;
  private readonly refreshIfExpiringWithinMs: number;
  private readonly now: () => number;
  private readonly listeners = new Set<CredentialEventListener>();
  private readonly lifecycleByCredential = new Map<
    string,
    CredentialLifecycleMetadata
  >();

  constructor(options: CredentialManagerOptions) {
    this.storage = options.storage;
    this.refreshService = options.refreshService ?? null;
    this.refreshIfExpiringWithinMs =
      options.refreshIfExpiringWithinMs ?? 60_000;
    this.now = options.now ?? (() => Date.now());
  }

  subscribe(listener: CredentialEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async getCredential(
    agentType: AgentType,
    accountId: AgentAccountId,
    options: GetCredentialOptions = {}
  ): Promise<AgentCredentialRecord | null> {
    const credential = await this.storage.getCredential(agentType, accountId);
    if (!credential) {
      return null;
    }

    const now = this.now();
    let current = credential;
    let refreshedAt: number | null = null;

    if (
      shouldRefreshCredential(
        credential,
        now,
        options,
        this.refreshIfExpiringWithinMs
      )
    ) {
      if (!this.refreshService) {
        throw new CredentialError(
          "REFRESH_FAILED",
          "Credential requires refresh but no refresh service is configured"
        );
      }

      const refreshed = await this.refreshService.refreshCredential(credential);
      current = {
        ...credential,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        idToken: refreshed.idToken,
        tokenType: refreshed.tokenType,
        scopes: refreshed.scopes,
        expiresAt: refreshed.expiresAt,
        updatedAt: now,
      };

      await this.storage.storeCredential(current);

      this.emitEvent({
        type: "refreshed",
        agentType,
        accountId,
        refreshedAt: now,
        expiresAt: current.expiresAt,
        scopes: current.scopes,
      });
      refreshedAt = now;
    }

    this.setLifecycle(current, now, refreshedAt);
    return current;
  }

  async storeCredential(
    agentType: AgentType,
    credential: AgentCredentialInput
  ): Promise<AgentCredentialRecord> {
    const now = this.now();
    const normalized = normalizeCredentialRecord(agentType, credential, now);

    await this.storage.storeCredential(normalized);
    this.setLifecycle(normalized, now);

    this.emitEvent({
      type: "stored",
      agentType: normalized.agentType,
      accountId: normalized.accountId,
      updatedAt: normalized.updatedAt,
    });

    return normalized;
  }

  async listCredentials(
    agentType?: AgentType
  ): Promise<AgentCredentialMetadata[]> {
    return this.storage.listCredentials(agentType);
  }

  async deleteCredential(
    agentType: AgentType,
    accountId: AgentAccountId
  ): Promise<boolean> {
    const deleted = await this.storage.deleteCredential(agentType, accountId);
    if (deleted) {
      this.lifecycleByCredential.delete(
        createCredentialKey(agentType, accountId)
      );
      this.emitEvent({
        type: "deleted",
        agentType,
        accountId,
        deletedAt: this.now(),
      });
    }

    return deleted;
  }

  async clearAllCredentials(): Promise<void> {
    await this.storage.clearAll();
    this.lifecycleByCredential.clear();
  }

  getLifecycleMetadata(
    agentType: AgentType,
    accountId: AgentAccountId
  ): CredentialLifecycleMetadata | null {
    return (
      this.lifecycleByCredential.get(
        createCredentialKey(agentType, accountId)
      ) ?? null
    );
  }

  private setLifecycle(
    credential: AgentCredentialRecord,
    retrievedAt: number,
    refreshedAt: number | null = null
  ): void {
    const key = createCredentialKey(credential.agentType, credential.accountId);
    const existing = this.lifecycleByCredential.get(key);
    const inferredRefreshAt =
      refreshedAt ??
      (credential.updatedAt > credential.createdAt
        ? credential.updatedAt
        : null);
    const lastRefreshedAt =
      inferredRefreshAt === null
        ? existing?.lastRefreshedAt ?? null
        : Math.max(existing?.lastRefreshedAt ?? 0, inferredRefreshAt);

    this.lifecycleByCredential.set(key, {
      agentType: credential.agentType,
      accountId: credential.accountId,
      scopes: credential.scopes,
      expiresAt: credential.expiresAt,
      lastRetrievedAt: retrievedAt,
      lastRefreshedAt,
    });
  }

  private emitEvent(event: CredentialManagerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore subscriber failures to keep credential operations deterministic.
      }
    }
  }
}
