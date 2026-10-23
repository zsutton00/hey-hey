#!/usr/bin/env node
import 'dotenv/config';
import { installLocalhostResolution } from './network/localhost-resolution';
import { version } from '../package.json';
import type { ServerCommandOptions } from './commands/server';
import { StorageFailureError, validateKey } from './credentials/store';

const HELP_TEXT = `Usage: heyhey [command] [options]

No command: runs the internal agent tool bridge. In an interactive terminal it
opens the menu (machine actions, local sessions, Debug); otherwise it prints
line output.

Commands:
  run-retention Configure automatic cleanup of completed Runs
  machine-history Inspect durable state and transition evidence for a machine instance
  credential    Manage provider credentials
  login         Sign in to Hey Hey (opens a browser by default)
  logout        Sign out and revoke tokens
  pair          Start or resume machine enrollment
  controllers   List, add, or revoke local controllers
  rotate        Rotate this machine's key without re-pairing
  status        Check authentication status
  startup-plan  View a startup plan (pass JSON file path)

login options (non-interactive token sign-in, skips the browser):
  --force                  Discard this profile's OAuth token and sign in again
  --token <jwt>            Sign in with a pre-minted access token instead of the browser flow
  --refresh-token <jwt>    Refresh token to store alongside --token (optional)
  --expires-at <iso8601>   Expiry to store; defaults to the access token's exp claim (optional)

  Alternatively, set HEYHEY_ACCESS_TOKEN (with optional HEYHEY_REFRESH_TOKEN /
  HEYHEY_TOKEN_EXPIRES_AT) and any command seeds the credential on startup if none
  is already stored.

controllers add options:
  --no-start     Exit after controller confirmation instead of starting Hey Hey

  Without a TTY (piped/redirected stdin), controller confirmation still remains
  required but the post-confirmation server start is skipped.

Options:
  -v, --version        Show version number
  --local              Use the local platform API and controller origin
  --staging            Use https://staging.heyhey.dev (bridge port 3849)
  --api-port <number>  Use an explicit localhost platform API port (requires --local;
                       ignored when HEYHEY_API_URL is set)
  --port <number>      Start the internal agent tool bridge on an explicit port
  --profile <name>     Namespace credentials under a profile (also HEYHEY_PROFILE; flag wins)
  --daily-session      Enable Daily Session monitoring for this CLI process
  --skip-permissions   Auto-approve all agent permission requests
  --no-track-tools     Disable recording tool names, inputs, and outputs per run (enabled by default)`;

const hasLocalFlag = process.argv.includes('--local');
const hasStagingFlag = process.argv.includes('--staging');
const hasDailySessionFlag = process.argv.includes('--daily-session');
const hasSkipPermissionsFlag = process.argv.includes('--skip-permissions');
const hasNoTrackToolsFlag = process.argv.includes('--no-track-tools');
const apiPortFlagIndex = process.argv.indexOf('--api-port');
const explicitApiPort = (() => {
  if (apiPortFlagIndex === -1) return undefined;

  const portValue = process.argv[apiPortFlagIndex + 1];
  const parsedPort = portValue !== undefined ? Number(portValue) : Number.NaN;
  if (
    portValue === undefined ||
    portValue.startsWith('--') ||
    !Number.isInteger(parsedPort) ||
    parsedPort < 1 ||
    parsedPort > 65535
  ) {
    console.error('Invalid --api-port: expected an integer from 1 to 65535');
    process.exit(1);
  }
  return parsedPort;
})();
if (hasLocalFlag && hasStagingFlag) {
  console.error('Use only one of --local or --staging');
  process.exit(1);
}
if (explicitApiPort !== undefined && !hasLocalFlag) {
  console.error('--api-port requires --local');
  process.exit(1);
}
if (hasLocalFlag) {
  installLocalhostResolution();
  // An explicit API URL wins so a named migration stack keeps its own hostname;
  // --api-port only builds the localhost default.
  process.env['HEYHEY_API_URL'] ||= `http://localhost:${explicitApiPort ?? 3000}`;
  process.env['HEYHEY_SERVER_PORT'] = '3848';
  // The browser is the WebAuthn origin. It is intentionally different from
  // the local platform API origin, so do not let the infrastructure default this to
  // HEYHEY_API_URL.
  process.env['HEYHEY_CONTROLLER_ORIGIN'] ??= 'http://localhost:5173';
  process.env['HEYHEY_CONTROLLER_RP_ID'] ??= 'localhost';
}
if (hasStagingFlag) {
  process.env['HEYHEY_API_URL'] = 'https://staging.heyhey.dev';
  process.env['HEYHEY_SERVER_PORT'] = '3849';
  process.env['HEYHEY_WEB_ORIGIN'] ??= 'https://staging.heyhey.dev';
  process.env['HEYHEY_CONTROLLER_ORIGIN'] ??= 'https://staging.heyhey.dev';
  process.env['HEYHEY_CONTROLLER_RP_ID'] ??= 'staging.heyhey.dev';
}
if (hasSkipPermissionsFlag) {
  process.env['HEYHEY_SKIP_PERMISSIONS'] = '1';
}
if (hasNoTrackToolsFlag) {
  process.env['HEYHEY_TRACK_TOOLS'] = '0';
}

const portFlagIndex = process.argv.indexOf('--port');
const explicitServerPort = (() => {
  if (portFlagIndex === -1) return undefined;

  const portValue = process.argv[portFlagIndex + 1];
  const parsedPort = portValue !== undefined ? Number(portValue) : Number.NaN;
  if (
    portValue === undefined ||
    portValue.startsWith('--') ||
    !Number.isInteger(parsedPort) ||
    parsedPort < 1 ||
    parsedPort > 65535
  ) {
    console.error('Invalid --port: expected an integer from 1 to 65535');
    process.exit(1);
  }
  return parsedPort;
})();

const profileFlagIndex = process.argv.indexOf('--profile');
if (profileFlagIndex !== -1) {
  const profile = process.argv[profileFlagIndex + 1];
  try {
    if (profile === undefined) {
      throw new StorageFailureError('Missing profile name after --profile');
    }
    validateKey(profile);
    process.env['HEYHEY_PROFILE'] = profile;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid --profile value';
    console.error(`Invalid --profile: ${message}`);
    process.exit(1);
  }
}

const args = process.argv.slice(2).filter((arg, index) => {
  if (
    arg === '--local' ||
    arg === '--staging' ||
    arg === '--daily-session' ||
    arg === '--skip-permissions' ||
    arg === '--no-track-tools'
  ) {
    return false;
  }
  // Drop `--port` and its value (argv index is +2 ahead of the sliced index).
  if (arg === '--port' || index + 2 === portFlagIndex + 1) {
    return false;
  }
  // Drop `--api-port` and its value (argv index is +2 ahead of the sliced index).
  if (arg === '--api-port' || index + 2 === apiPortFlagIndex + 1) {
    return false;
  }
  // Drop `--profile` and its value (argv index is +2 ahead of the sliced index).
  if (arg === '--profile' || index + 2 === profileFlagIndex + 1) {
    return false;
  }
  return true;
});
const command = args[0];

const ANSI_RESET = '\u001B[0m';
const CONSOLE_LEVEL_COLORS = {
  log: '\u001B[36m',
  info: '\u001B[34m',
  warn: '\u001B[33m',
  error: '\u001B[31m',
} as const;

const shouldUseAnsiColors = (): boolean => {
  if (typeof process.env['NO_COLOR'] === 'string') {
    return false;
  }
  if (process.env['FORCE_COLOR'] === '0') {
    return false;
  }
  if (process.env['FORCE_COLOR'] !== undefined) {
    return true;
  }
  return Boolean(process.stdout.isTTY || process.stderr.isTTY) && process.env['TERM'] !== 'dumb';
};

type ConsoleMethodName = keyof typeof CONSOLE_LEVEL_COLORS;

const wrapConsoleMethod = (
  original: (...args: unknown[]) => void,
  method: ConsoleMethodName,
  useColors: boolean,
  suppressFirstArg?: string,
): ((...args: unknown[]) => void) => {
  const color = CONSOLE_LEVEL_COLORS[method];
  return (...args: unknown[]) => {
    if (suppressFirstArg && args[0] === suppressFirstArg) {
      return;
    }
    if (!useColors || args.length === 0 || typeof args[0] !== 'string') {
      original(...args);
      return;
    }
    const [first, ...rest] = args;
    original(`${color}${first}${ANSI_RESET}`, ...rest);
  };
};

const installConsoleLogFilter = (): void => {
  const useColors = shouldUseAnsiColors();
  const originalLog = console.log.bind(console);
  const originalInfo = console.info.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.log = wrapConsoleMethod(
    originalLog,
    'log',
    useColors,
    'Loading serviceClients configuration...',
  );
  console.info = wrapConsoleMethod(
    originalInfo,
    'info',
    useColors,
    'Loading serviceClients configuration...',
  );
  console.warn = wrapConsoleMethod(originalWarn, 'warn', useColors);
  console.error = wrapConsoleMethod(originalError, 'error', useColors);
};

const getServerCommandOptions = (): ServerCommandOptions => ({
  enableDailySession: hasDailySessionFlag,
  ...(explicitServerPort !== undefined ? { preferredPort: explicitServerPort } : {}),
});

const run = async (): Promise<void> => {
  if (command === '--help' || command === '-h') {
    console.log(HELP_TEXT);
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log(version);
    return;
  }

  installConsoleLogFilter();

  if (command === 'machine-history') {
    const { runMachineHistoryCommand } = await import('./commands/machine-history');
    const ok = await runMachineHistoryCommand(args.slice(1));
    if (!ok) process.exitCode = 1;
    return;
  }

  const { seedCredentialFromEnvIfAbsent } = await import('./auth/token-injection');
  await seedCredentialFromEnvIfAbsent();

  if (command === 'pair') {
    const { PairServerCommand } = await import('./commands/pair-server');
    const ok = await new PairServerCommand().run(getServerCommandOptions());
    if (!ok) {
      // PairServerCommand enters the same server lifecycle as the default
      // command after pairing succeeds. A failed server start can leave its
      // eagerly opened, reconnecting platform websocket alive, so this path
      // needs the same hard-exit guarantee as the default server command.
      process.exit(1);
    }
    return;
  }

  if (command === 'controllers') {
    const { runControllersCommand } = await import('./commands/controllers');
    const { PairServerCommand } = await import('./commands/pair-server');
    const pairServerCommand = new PairServerCommand();
    const ok = await runControllersCommand(args.slice(1), {
      isTty: process.stdin.isTTY === true,
      serverOptions: getServerCommandOptions(),
      startServerAfterConfirmation: (options) => pairServerCommand.runServerAfterPairing(options),
    });
    if (!ok) {
      // `controllers add` can enter the same server lifecycle as `pair`.
      // Server startup opens a reconnecting platform websocket before it
      // binds the local port, so a failed start needs a hard exit instead of
      // merely setting exitCode and leaving that socket alive.
      process.exit(1);
    }
    return;
  }

  if (command === 'startup-plan') {
    const fixturePath = args[1] ?? './final-fixture.json';
    const { runStartupPlanCommand } = await import('./commands/startup-plan-command');
    const ok = await runStartupPlanCommand({ filePath: fixturePath });
    if (!ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'credential') {
    const { runCredentialCommand } = await import('./commands/provider-credential-refresh');
    const ok = await runCredentialCommand(args.slice(1));
    if (!ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'run-retention') {
    const { runRunRetentionCommand } = await import('./commands/run-retention');
    const ok = await runRunRetentionCommand(args.slice(1));
    if (!ok) process.exitCode = 1;
    return;
  }

  if (command === 'login') {
    const { runLoginCommand } = await import('./commands/login');
    const ok = await runLoginCommand(args.slice(1));
    if (!ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'logout') {
    const { runLogoutCommand } = await import('./commands/logout');
    const ok = await runLogoutCommand();
    if (!ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'rotate') {
    const { runRotateCommand } = await import('./commands/rotate');
    const ok = await runRotateCommand();
    if (!ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'status') {
    const { runStatusCommand } = await import('./commands/status');
    const ok = await runStatusCommand();
    if (!ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (command) {
    console.error(`Unknown command: ${command}`);
    process.exitCode = 1;
    return;
  }

  // An interactive terminal gets the menu; pipes and redirects keep line output.
  const { runDefaultServer, terminalStreamFlags } = await import('./tui/interactive-terminal');
  const ok = await runDefaultServer(terminalStreamFlags(), getServerCommandOptions());
  if (!ok) {
    // Hard-exit, not just `exitCode`. Server startup opens the platform
    // websocket eagerly (before the HTTP bind), and it auto-reconnects even
    // after teardown — so the event loop never drains on its own and a failed
    // start would otherwise linger as a half-alive zombie holding the socket.
    process.exit(1);
  }
};

void run();
