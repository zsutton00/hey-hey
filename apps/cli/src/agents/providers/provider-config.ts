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
