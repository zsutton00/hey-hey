import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runServer: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  seedCredential: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  interactive: false,
  runInteractiveServer: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  launchImported: vi.fn(),
}));

vi.mock('./tui/interactive-terminal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tui/interactive-terminal')>()),
  terminalStreamFlags: () => ({
    stdin: mocks.interactive,
    stdout: mocks.interactive,
    stderr: true,
  }),
}));

vi.mock('./tui/launch', () => {
  mocks.launchImported();
  return { runInteractiveServer: mocks.runInteractiveServer };
});

vi.mock('./commands/server', () => ({
  ServerCommand: class {
    public run = mocks.runServer;
  },
}));

vi.mock('./auth/token-injection', () => ({
  seedCredentialFromEnvIfAbsent: mocks.seedCredential,
}));

const originalArgv = [...process.argv];
const originalEnv = { ...process.env };
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

const importCli = async (argv: string[]): Promise<void> => {
  process.argv = argv;
  await import('./index');
  await vi.waitFor(() => expect(mocks.seedCredential).toHaveBeenCalledTimes(1));
};

describe('CLI startup options', () => {
  afterEach(() => {
    process.argv = [...originalArgv];
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    mocks.runServer.mockClear();
    mocks.seedCredential.mockClear();
    mocks.interactive = false;
    mocks.runInteractiveServer.mockClear();
    mocks.launchImported.mockClear();
    vi.resetModules();
  });

  it('preserves the migration stack URL and controller origin with --local', async () => {
    process.env['HEYHEY_API_URL'] = 'http://dev.localhost:43753';
    process.env['HEYHEY_CONTROLLER_ORIGIN'] = 'http://dev.localhost:41891';
    process.env['HEYHEY_CONTROLLER_RP_ID'] = 'dev.localhost';
    await importCli(['node', 'index.tsx', '--local', '--api-port', '43753']);

    expect(process.env['HEYHEY_API_URL']).toBe('http://dev.localhost:43753');
    expect(process.env['HEYHEY_CONTROLLER_ORIGIN']).toBe('http://dev.localhost:41891');
    expect(process.env['HEYHEY_CONTROLLER_RP_ID']).toBe('dev.localhost');
  });

  it('defaults Daily Session monitoring off when no startup flag is present', async () => {
    await importCli(['node', 'index.tsx']);

    expect(mocks.runServer).toHaveBeenCalledWith({ enableDailySession: false });
  });

  it('opts into Daily Session and removes the flag from positional command parsing', async () => {
    await importCli(['node', 'index.tsx', '--daily-session']);

    expect(mocks.runServer).toHaveBeenCalledWith({ enableDailySession: true });
  });

  it('documents the process opt-in in help output', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    process.argv = ['node', 'index.tsx', '--help', '--daily-session'];
    await import('./index');

    expect(log).toHaveBeenCalledWith(expect.stringContaining('--daily-session'));
    expect(mocks.runServer).not.toHaveBeenCalled();
  });

  it('mounts the menu for the default command in an interactive terminal', async () => {
    mocks.interactive = true;
    await importCli(['node', 'index.tsx', '--daily-session']);

    await vi.waitFor(() =>
      expect(mocks.runInteractiveServer).toHaveBeenCalledWith({ enableDailySession: true }),
    );
    expect(mocks.runServer).not.toHaveBeenCalled();
  });

  it('keeps line output and never loads the menu without a terminal', async () => {
    await importCli(['node', 'index.tsx']);

    await vi.waitFor(() => expect(mocks.runServer).toHaveBeenCalled());
    expect(mocks.launchImported).not.toHaveBeenCalled();
    expect(mocks.runInteractiveServer).not.toHaveBeenCalled();
  });
});
