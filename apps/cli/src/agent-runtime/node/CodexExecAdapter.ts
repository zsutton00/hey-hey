import type { AgentDecoder } from '../core/index';
import type { AgentInitOptions } from '../core/index';
import {
  toAgentAccountId,
  type AgentCredentialRecord,
  type CredentialLifecycleMetadata,
  type GetCredentialOptions,
} from '../credentials/index';
import { CodexDecoder } from './CodexDecoder';
import {
  type AgentCredentialBinding,
  type CredentialRefreshCapableNodeAdapter,
} from './AgentCredentialBinding';
import {
  NodeAgentAdapterBase,
  type BuildSpawnRequestContext,
  type NodeSpawnRequest,
} from './NodeAgentAdapterBase';

export const buildCodexExecArgs = (input: {
  prompt: string;
  resumeSessionId: string | null;
  extraWritableDirs?: readonly string[] | undefined;
}): string[] => {
  const extraWritableDirArgs = (input.extraWritableDirs ?? []).flatMap((dir) => ['--add-dir', dir]);

  if (input.resumeSessionId) {
    return [
      'exec',
      'resume',
      '--full-auto',
      '--json',
      ...extraWritableDirArgs,
      input.resumeSessionId,
      input.prompt,
    ];
  }

  return ['exec', '--full-auto', '--json', ...extraWritableDirArgs, input.prompt];
};

export const buildCodexCredentialEnvironment = (input: {
  credential: AgentCredentialRecord;
  environmentOverrides?: Record<string, string> | undefined;
}): Record<string, string> => {
  const env: Record<string, string> = {
    OPENAI_API_KEY: input.credential.accessToken,
    OPENAI_ACCESS_TOKEN: input.credential.accessToken,
  };

  if (input.credential.tokenType) {
    env['OPENAI_TOKEN_TYPE'] = input.credential.tokenType;
  }

  Object.assign(env, input.environmentOverrides ?? {});
  return env;
};

export interface CodexExecAdapterConfig {
  command?: string | undefined;
  timeoutMs?: number | undefined;
  extraWritableDirs?: readonly string[] | undefined;
  credentialBinding?: AgentCredentialBinding | undefined;
  decoderFactory?: (() => AgentDecoder) | undefined;
}

export class CodexExecAdapter
  extends NodeAgentAdapterBase
  implements CredentialRefreshCapableNodeAdapter
{
  private readonly config: {
    [K in keyof Required<
      Omit<CodexExecAdapterConfig, 'credentialBinding' | 'decoderFactory'>
    >]: Exclude<
      Required<Omit<CodexExecAdapterConfig, 'credentialBinding' | 'decoderFactory'>>[K],
      undefined
    >;
  };
  private readonly credentialBinding: AgentCredentialBinding | null;
  private credentialEventUnsubscribe: (() => void) | null = null;
  private lastCredentialLifecycle: CredentialLifecycleMetadata | null = null;

  constructor(config: CodexExecAdapterConfig = {}) {
    super('codex', config.decoderFactory ?? (() => new CodexDecoder()));
    const extraWritableDirs = (config.extraWritableDirs ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    this.config = {
      command: config.command ?? 'codex',
      timeoutMs: config.timeoutMs ?? 30_000,
      extraWritableDirs: Array.from(new Set(extraWritableDirs)),
    };
    this.credentialBinding = config.credentialBinding ?? null;
  }

  override async init(options: AgentInitOptions): Promise<void> {
    await super.init(options);

    if (!this.credentialBinding || this.credentialEventUnsubscribe) {
      return;
    }

    const boundAccountId = toAgentAccountId(this.credentialBinding.accountId);
    this.credentialEventUnsubscribe = this.credentialBinding.manager.subscribe((event) => {
      if (event.agentType !== 'codex' || event.accountId !== boundAccountId) {
        return;
      }

      this.credentialBinding?.onCredentialEvent?.(event);
    });
  }

  override async close(): Promise<void> {
    this.credentialEventUnsubscribe?.();
    this.credentialEventUnsubscribe = null;
    await super.close();
  }

  protected async buildSpawnRequest(context: BuildSpawnRequestContext): Promise<NodeSpawnRequest> {
    const env = await this.buildCredentialEnvironment();

    return {
      command: this.config.command,
      args: buildCodexExecArgs({
        prompt: context.prompt,
        resumeSessionId: context.resumeSessionId,
        extraWritableDirs: this.config.extraWritableDirs,
      }),
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

    const environmentOverrides = this.credentialBinding.environmentOverrides;
    return buildCodexCredentialEnvironment(
      environmentOverrides ? { credential, environmentOverrides } : { credential },
    );
  }

  private async resolveCredential(
    options: GetCredentialOptions = {},
  ): Promise<AgentCredentialRecord | null> {
    if (!this.credentialBinding) {
      return null;
    }

    const boundAccountId = toAgentAccountId(this.credentialBinding.accountId);
    const refreshIfExpiringWithinMs = this.credentialBinding.refreshIfExpiringWithinMs;
    const credential = await this.credentialBinding.manager.getCredential('codex', boundAccountId, {
      ...(refreshIfExpiringWithinMs !== undefined ? { refreshIfExpiringWithinMs } : {}),
      ...options,
    });

    if (!credential) {
      throw new Error(`No Codex credential found for account ${this.credentialBinding.accountId}`);
    }

    const now = Date.now();
    this.lastCredentialLifecycle = this.credentialBinding.manager.getLifecycleMetadata(
      credential.agentType,
      credential.accountId,
    ) ?? {
      agentType: credential.agentType,
      accountId: credential.accountId,
      scopes: credential.scopes,
      expiresAt: credential.expiresAt,
      lastRetrievedAt: now,
      lastRefreshedAt: credential.updatedAt > credential.createdAt ? credential.updatedAt : null,
    };

    return credential;
  }
}
