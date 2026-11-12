import { spawn } from 'node:child_process';
import { toolExecutionHookSettings } from '../tool-execution-hooks';

type TomlValue =
  | string
  | number
  | boolean
  | readonly TomlValue[]
  | { readonly [key: string]: TomlValue };

const toToml = (value: TomlValue): string => {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(toToml).join(',')}]`;
  }
  const entries = Object.entries(value as { readonly [key: string]: TomlValue });
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}=${toToml(entry)}`).join(',')}}`;
};

/** The Pre/PostToolUse hook entries as `-c` overrides; Codex reads them from its session flags and writes no file. */
export const codexHookOverrides = (command: string): string[] =>
  Object.entries(toolExecutionHookSettings('codex', command)).map(
    ([event, groups]) => `hooks.${event}=${toToml(groups as unknown as TomlValue)}`,
  );

interface ListedHook {
  key: string;
  command?: string;
  source: string;
  currentHash: string;
  trustStatus: string;
}

/** The hook command is stable for the process, so one successful probe covers every later launch. */
const confirmedLaunches = new Map<string, string[]>();

const PROBE_TIMEOUT_MS = 15_000;

/**
 * Asks a throwaway `codex app-server` started with the hook overrides which hooks it
 * registered and what it would need to trust them. Observed behaviour, not a version check.
 */
const listSessionFlagHooks = (overrides: readonly string[], cwd: string): Promise<ListedHook[]> =>
  new Promise((resolve, reject) => {
    const child = spawn('codex', ['app-server', ...overrides.flatMap((o) => ['-c', o])], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
    });
    let output = '';
    let settled = false;
    const finish = (settle: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      settle();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error('Codex did not answer the hook probe in time'))),
      PROBE_TIMEOUT_MS,
    );
    const send = (message: object): void => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    child.on('error', (error) => finish(() => reject(error)));
    child.on('exit', (code) =>
      finish(() => reject(new Error(`Codex exited during the hook probe (code=${String(code)})`))),
    );
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const lines = output.split('\n');
      output = lines.pop() ?? '';
      for (const line of lines) {
        let message: {
          id?: number;
          result?: { data?: { hooks?: ListedHook[] }[] };
          error?: { message?: string };
        };
        try {
          message = JSON.parse(line) as typeof message;
        } catch {
          continue;
        }
        if (message.id === 1) {
          send({ method: 'initialized' });
          send({ id: 2, method: 'hooks/list', params: { cwds: [cwd] } });
        }
        if (message.id === 2) {
          const hooks = message.result?.data?.flatMap((entry) => entry.hooks ?? []);
          finish(() =>
            hooks
              ? resolve(hooks)
              : reject(new Error(message.error?.message ?? 'Codex has no hooks/list method')),
          );
        }
      }
    });
    send({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'hey-hey-probe', version: '0' } },
    });
  });

/**
 * The full launch overrides for the hook command: the hook entries plus the trust record
 * Codex asks for. Throws a specific cause when Codex does not register the hooks as trusted.
 */
export const confirmCodexHookLaunch = async (command: string, cwd: string): Promise<string[]> => {
  const known = confirmedLaunches.get(command);
  if (known) {
    return known;
  }
  const overrides = codexHookOverrides(command);
  const listed = (await listSessionFlagHooks(overrides, cwd)).filter(
    (hook) => hook.source === 'sessionFlags' && hook.command === command,
  );
  const expected = overrides.length;
  if (listed.length !== expected) {
    throw new Error(
      `Codex registered ${listed.length} of ${expected} launch hooks; it does not accept hook configuration at launch`,
    );
  }
  const state = Object.fromEntries(
    listed.map((hook) => [hook.key, { trusted_hash: hook.currentHash }]),
  );
  const trusted = [...overrides, `hooks.state=${toToml(state)}`];
  const confirmed = (await listSessionFlagHooks(trusted, cwd)).filter(
    (hook) => hook.source === 'sessionFlags' && hook.command === command,
  );
  if (confirmed.length !== expected || confirmed.some((hook) => hook.trustStatus !== 'trusted')) {
    throw new Error('Codex did not trust the launch hooks after the trust record was supplied');
  }
  confirmedLaunches.set(command, trusted);
  return trusted;
};

/** The entries a person can add to their Codex config by hand when launch configuration fails. */
export const manualCodexHookConfig = (command: string): string =>
  Object.entries(toolExecutionHookSettings('codex', command))
    .flatMap(([event, groups]) =>
      groups.flatMap((group) => [
        `[[hooks.${event}]]`,
        `matcher = ${JSON.stringify(group.matcher)}`,
        ...group.hooks.flatMap((hook) => [
          `[[hooks.${event}.hooks]]`,
          `type = "command"`,
          `command = ${JSON.stringify(hook.command)}`,
          `timeout = ${hook.timeout}`,
        ]),
      ]),
    )
    .join('\n');
