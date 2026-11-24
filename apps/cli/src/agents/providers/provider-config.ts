import { AgentProviderId } from '@hey-hey/contracts/api/models';

export const AGENT_PROVIDERS = Object.values(AgentProviderId);
export type { AgentProviderId };

const PROVIDER_DISPLAY_NAMES: Record<AgentProviderId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  antigravity: 'Antigravity',
};

const MISSING_CREDENTIAL_PATTERN = /No (.+?) credential found for account (.+)$/u;

export class UnknownAgentProviderError extends Error {
  public constructor(provider: unknown) {
    super(
      `Unknown agent provider: ${typeof provider === 'string' ? JSON.stringify(provider) : typeof provider}`,
    );
    this.name = 'UnknownAgentProviderError';
  }
}

export const isAgentProviderId = (provider: unknown): provider is AgentProviderId =>
  AGENT_PROVIDERS.some((id) => id === provider);

export const resolveAgentProviderId = (provider: unknown): AgentProviderId => {
  if (isAgentProviderId(provider)) {
    return provider;
  }

  throw new UnknownAgentProviderError(provider);
};

export const resolveAgentAccountId = (providerId: AgentProviderId): string =>
  process.env[`HEYHEY_${providerId.toUpperCase()}_ACCOUNT_ID`] ??
  process.env['HEYHEY_AGENT_ACCOUNT_ID'] ??
  'default';

export const toProviderDisplayName = (providerId: AgentProviderId): string =>
  PROVIDER_DISPLAY_NAMES[providerId];

export const buildCredentialRefreshCommand = (
  providerId: AgentProviderId,
  accountId: string,
): string => `heyhey credential refresh --provider ${providerId} --account ${accountId}`;

export const extractCredentialLookupFromErrorMessage = (
  message: string,
): { providerId: AgentProviderId; accountId: string } | null => {
  const match = message.match(MISSING_CREDENTIAL_PATTERN);
  if (!match) {
    return null;
  }

  const providerPart = match[1];
  const accountPart = match[2];
  if (!providerPart || !accountPart) {
    return null;
  }

  const providerId =
    AGENT_PROVIDERS.find((id) => PROVIDER_DISPLAY_NAMES[id] === providerPart) ??
    resolveAgentProviderId(providerPart);

  const accountId = accountPart.trim();
  if (accountId.length === 0) {
    return null;
  }

  return {
    providerId,
    accountId,
  };
};

/** A permission mode a provider runs natively, so it decides routine requests itself. */
export type ProviderPermissionMode = 'auto';

/**
 * The native automation mode each provider supports, or null when it has none.
 * Claude Code 2.1.327 lists `auto` among its `--permission-mode` choices
 * (checked with `claude --help`); the classifier still denies what its policy
 * or managed settings deny. Codex 0.170.0 routes approvals to its automatic
 * reviewer with `approvalsReviewer: "auto_review"` on `thread/start` and
 * `thread/resume` (checked in its app-server schema and `--approve-for-me`).
 * OpenCode has no equivalent.
 *
 * `minimumVersion` is the oldest installation whose support was verified; an
 * older or unreadable installation gets no native mode (see
 * native-permission-mode.ts).
 */
export const NATIVE_PERMISSION_MODES: Readonly<
  Record<AgentProviderId, { mode: ProviderPermissionMode; minimumVersion: string } | null>
> = {
  claude: { mode: 'auto', minimumVersion: '2.1.327' },
  codex: { mode: 'auto', minimumVersion: '0.170.0' },
  opencode: null,
  antigravity: null,
};

export const nativePermissionModeFor = (
  providerId: AgentProviderId,
): ProviderPermissionMode | null => NATIVE_PERMISSION_MODES[providerId]?.mode ?? null;
