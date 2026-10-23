import {
  createCredentialManager,
  createInteractivePrompter,
  type CredentialManager,
  type CredentialPrompter,
} from '../agent-runtime/index';
import {
  buildCredentialRefreshCommand,
  resolveAgentAccountId,
  toProviderDisplayName,
  type AgentProviderId,
} from '../agents/providers/provider-config';

type RefreshPrompter = Pick<CredentialPrompter, 'promptSecret'>;

interface CredentialRefreshDependencies {
  resolveCredentialManager: () => Promise<{
    manager: Pick<CredentialManager, 'storeCredential'>;
  }>;
  prompter: RefreshPrompter;
  log: (message: string) => void;
  logError: (message: string) => void;
}

interface RefreshIntent {
  providerId: AgentProviderId;
  accountId?: string;
}

type ParseResult =
  | { kind: 'help' }
  | { kind: 'intent'; intent: RefreshIntent }
  | { kind: 'error'; message: string };

const CREDENTIAL_COMMAND_USAGE = `Usage: heyhey credential <command> [options]

Commands:
  refresh      Store or replace a provider credential

refresh options:
  --provider, -p  Provider id: claude | codex (required)
  --account,  -a  Account id override (optional)
  --help,     -h  Show help`;

const parseProviderId = (value: string): AgentProviderId | null => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'claude' || normalized === 'codex' || normalized === 'opencode') {
    return normalized;
  }
  return null;
};

const parseRefreshArgs = (args: readonly string[]): ParseResult => {
  let providerRaw: string | null = null;
  let accountId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      return { kind: 'help' };
    }

    if (arg === '--provider' || arg === '-p') {
      const next = args[index + 1];
      if (!next) {
        return { kind: 'error', message: 'Missing value for "--provider".' };
      }
      providerRaw = next;
      index += 1;
      continue;
    }

    if (arg === '--account' || arg === '-a') {
      const next = args[index + 1];
      if (!next) {
        return { kind: 'error', message: 'Missing value for "--account".' };
      }
      const trimmedAccountId = next.trim();
      if (!trimmedAccountId) {
        return { kind: 'error', message: '"--account" must be a non-empty string.' };
      }
      accountId = trimmedAccountId;
      index += 1;
      continue;
    }

    return { kind: 'error', message: `Unknown option "${arg}" for credential refresh.` };
  }

  if (!providerRaw) {
    return { kind: 'error', message: 'Missing required option "--provider".' };
  }

  const providerId = parseProviderId(providerRaw);
  if (!providerId) {
    return {
      kind: 'error',
      message: `Unsupported provider "${providerRaw}". Expected "claude", "codex", or "opencode".`,
    };
  }

  return {
    kind: 'intent',
    intent: {
      providerId,
      ...(accountId ? { accountId } : {}),
    },
  };
};

const parseCredentialCommand = (args: readonly string[]): ParseResult => {
  const [subcommand, ...rest] = args;

  if (!subcommand) {
    return { kind: 'error', message: 'Missing credential command.' };
  }

  if (subcommand === '--help' || subcommand === '-h') {
    return { kind: 'help' };
  }

  if (subcommand !== 'refresh') {
    return { kind: 'error', message: `Unknown credential command "${subcommand}".` };
  }

  return parseRefreshArgs(rest);
};

const runRefreshIntent = async (
  intent: RefreshIntent,
  deps: CredentialRefreshDependencies,
): Promise<boolean> => {
  const accountId = intent.accountId ?? resolveAgentAccountId(intent.providerId);
  const providerName = toProviderDisplayName(intent.providerId);

  deps.log(`Refreshing ${providerName} credential for account ${accountId}...`);
  deps.log(
    `[agent auth] To refresh later, run: ${buildCredentialRefreshCommand(intent.providerId, accountId)}`,
  );

  try {
    const accessToken = (await deps.prompter.promptSecret(`${providerName} API key: `)).trim();
    if (!accessToken) {
      deps.logError('Credential refresh failed: API key cannot be empty.');
      return false;
    }

    const { manager } = await deps.resolveCredentialManager();
    await manager.storeCredential(intent.providerId, {
      accountId,
      accessToken,
      refreshToken: null,
      idToken: null,
      tokenType: 'Bearer',
      scopes: [],
      expiresAt: null,
    });

    deps.log(`Stored ${providerName} credential for account ${accountId}.`);
    return true;
  } catch (error) {
    if (error instanceof Error) {
      const lowered = error.message.toLowerCase();
      if (
        lowered.includes('interrupted') ||
        lowered.includes('cancelled') ||
        lowered.includes('canceled') ||
        lowered.includes('aborted')
      ) {
        deps.logError('Credential refresh cancelled.');
        return false;
      }
      deps.logError(`Credential refresh failed: ${error.message}`);
      return false;
    }

    deps.logError(`Credential refresh failed: ${String(error)}`);
    return false;
  }
};

export const runCredentialCommand = async (
  args: readonly string[],
  dependencies: Partial<CredentialRefreshDependencies> = {},
): Promise<boolean> => {
  const deps: CredentialRefreshDependencies = {
    resolveCredentialManager: dependencies.resolveCredentialManager ?? createCredentialManager,
    prompter: dependencies.prompter ?? createInteractivePrompter(),
    log: dependencies.log ?? console.log,
    logError: dependencies.logError ?? console.error,
  };

  const parsed = parseCredentialCommand(args);
  if (parsed.kind === 'help') {
    deps.log(CREDENTIAL_COMMAND_USAGE);
    return true;
  }

  if (parsed.kind === 'error') {
    deps.logError(parsed.message);
    deps.logError(CREDENTIAL_COMMAND_USAGE);
    return false;
  }

  return runRefreshIntent(parsed.intent, deps);
};
