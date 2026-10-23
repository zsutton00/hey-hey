import type { AgentDecoder } from "../core";
import type { AgentInitOptions } from "../core";
import {
  toAgentAccountId,
  type CredentialLifecycleMetadata,
  type GetCredentialOptions,
  type AgentCredentialRecord,
} from "../credentials";
import { CodexDecoder } from "./CodexDecoder";
import {
  type AgentCredentialBinding,
  type CredentialRefreshCapableNodeAdapter,
} from "./AgentCredentialBinding";
import {
  NodeAgentAdapterBase,
  type BuildSpawnRequestContext,
  type NodeSpawnRequest,
} from "./NodeAgentAdapterBase";

const DEFAULT_CODEX_BASE_ARGS = ["--json"] as const;

export interface CodexAdapterConfig {
  command?: string;
  baseArgs?: string[];
  promptFlag?: string;
  resumeFlag?: string;
  timeoutMs?: number;
  decoderFactory?: () => AgentDecoder;
  credentialBinding?: AgentCredentialBinding;
}

export class CodexAdapter
  extends NodeAgentAdapterBase
  implements CredentialRefreshCapableNodeAdapter
{
  private readonly config: Required<
    Omit<CodexAdapterConfig, "decoderFactory" | "credentialBinding">
  >;
  private readonly credentialBinding: AgentCredentialBinding | null;
  private credentialEventUnsubscribe: (() => void) | null = null;
  private lastCredentialLifecycle: CredentialLifecycleMetadata | null = null;

  constructor(config: CodexAdapterConfig = {}) {
    super("codex", config.decoderFactory ?? (() => new CodexDecoder()));
    this.config = {
      command: config.command ?? "codex",
      baseArgs: config.baseArgs ?? [...DEFAULT_CODEX_BASE_ARGS],
      promptFlag: config.promptFlag ?? "--prompt",
      resumeFlag: config.resumeFlag ?? "--resume",
      timeoutMs: config.timeoutMs ?? 30_000,
    };
    this.credentialBinding = config.credentialBinding ?? null;
  }

  override async init(options: AgentInitOptions): Promise<void> {
    await super.init(options);

    if (!this.credentialBinding || this.credentialEventUnsubscribe) {
      return;
    }

    const boundAccountId = toAgentAccountId(this.credentialBinding.accountId);
    this.credentialEventUnsubscribe = this.credentialBinding.manager.subscribe(
      (event) => {
        if (event.agentType !== "codex" || event.accountId !== boundAccountId) {
          return;
        }

        this.credentialBinding?.onCredentialEvent?.(event);
      }
    );
  }

  override async close(): Promise<void> {
    this.credentialEventUnsubscribe?.();
    this.credentialEventUnsubscribe = null;
    await super.close();
  }

  protected async buildSpawnRequest(
    context: BuildSpawnRequestContext
  ): Promise<NodeSpawnRequest> {
    const args = [...this.config.baseArgs];
    const env: Record<string, string> = {};

    if (context.resumeSessionId) {
      args.push(this.config.resumeFlag, context.resumeSessionId);
    }

    args.push(this.config.promptFlag, context.prompt);

    Object.assign(env, await this.buildCredentialEnvironment());

    return {
      command: this.config.command,
      args,
      timeoutMs: this.config.timeoutMs,
      env,
    };
  }

  getCredentialLifecycleMetadata(): CredentialLifecycleMetadata | null {
    return this.lastCredentialLifecycle;
  }

  async refreshCredential(): Promise<void> {
    await this.resolveCredential({ forceRefresh: true });
  }

  private async buildCredentialEnvironment(): Promise<Record<string, string>> {
    const credential = await this.resolveCredential();
    if (!credential || !this.credentialBinding) {
      return {};
    }

    const env: Record<string, string> = {
      OPENAI_API_KEY: credential.accessToken,
      OPENAI_ACCESS_TOKEN: credential.accessToken,
    };

    if (credential.tokenType) {
      env.OPENAI_TOKEN_TYPE = credential.tokenType;
    }

    Object.assign(env, this.credentialBinding.environmentOverrides ?? {});
    return env;
  }

  private async resolveCredential(
    options: GetCredentialOptions = {}
  ): Promise<AgentCredentialRecord | null> {
    if (!this.credentialBinding) {
      return null;
    }

    const boundAccountId = toAgentAccountId(this.credentialBinding.accountId);
    const credential = await this.credentialBinding.manager.getCredential(
      "codex",
      boundAccountId,
      {
        refreshIfExpiringWithinMs:
          this.credentialBinding.refreshIfExpiringWithinMs,
        ...options,
      }
    );

    if (!credential) {
      throw new Error(
        `No Codex credential found for account ${this.credentialBinding.accountId}`
      );
    }

    const now = Date.now();
    this.lastCredentialLifecycle =
      this.credentialBinding.manager.getLifecycleMetadata(
        credential.agentType,
        credential.accountId
      ) ?? {
        agentType: credential.agentType,
        accountId: credential.accountId,
        scopes: credential.scopes,
        expiresAt: credential.expiresAt,
        lastRetrievedAt: now,
        lastRefreshedAt:
          credential.updatedAt > credential.createdAt
            ? credential.updatedAt
            : null,
      };

    return credential;
  }
}
