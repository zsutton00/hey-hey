export type AgentProviderId = 'claude' | 'codex' | 'opencode';

const MISSING_CREDENTIAL_PATTERN = /No (Codex|Claude|OpenCode) credential found for account (.+)$/u;

export const resolveAgentProviderId = (provider: string): AgentProviderId => {
  const lower = provider.toLowerCase();
  if (lower.includes('codex')) return 'codex';
  if (lower.includes('opencode')) return 'opencode';
  return 'claude';
};

export const resolveAgentAccountId = (providerId: AgentProviderId): string => {
  if (providerId === 'codex') {
    return (
      process.env['HEYHEY_CODEX_ACCOUNT_ID'] ?? process.env['HEYHEY_AGENT_ACCOUNT_ID'] ?? 'default'
    );
  }

  if (providerId === 'opencode') {
    return (
      process.env['HEYHEY_OPENCODE_ACCOUNT_ID'] ??
      process.env['HEYHEY_AGENT_ACCOUNT_ID'] ??
      'default'
    );
  }

  return (
    process.env['HEYHEY_CLAUDE_ACCOUNT_ID'] ?? process.env['HEYHEY_AGENT_ACCOUNT_ID'] ?? 'default'
  );
};

export const toProviderDisplayName = (providerId: AgentProviderId): string => {
  if (providerId === 'codex') return 'Codex';
  if (providerId === 'opencode') return 'OpenCode';
  return 'Claude';
};

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

  const lower = providerPart.toLowerCase();
  let providerId: AgentProviderId;
  if (lower === 'codex') providerId = 'codex';
  else if (lower === 'opencode') providerId = 'opencode';
  else providerId = 'claude';

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
};

export const nativePermissionModeFor = (
  providerId: AgentProviderId,
): ProviderPermissionMode | null => NATIVE_PERMISSION_MODES[providerId]?.mode ?? null;
