import { afterEach, expect, it, vi } from 'vitest';
import { runLocalCommand } from './local';
import { localWebOrigin } from '../local-app/compose';
import { DEFAULT_LOCAL_WEB_PORT } from '../local-app/local-port';

const LOCAL_WEB_ORIGIN = localWebOrigin(DEFAULT_LOCAL_WEB_PORT);
import { KeyPairStore } from '../credentials';
import { accountNamespace } from '../credentials/keypair';
import { CredentialStore } from '../credentials/store';

const fakeJwt = [
  'e30',
  Buffer.from(JSON.stringify({ exp: 4_102_444_800 })).toString('base64url'),
  'signature',
].join('.');

const mocks = vi.hoisted(() => ({ server: vi.fn() }));
vi.mock('../local-app/local-application', () => ({
  LocalApplication: class {
    state = {
      kind: 'ready',
      url: LOCAL_WEB_ORIGIN,
      reconnectCommand: 'heyhey local',
      stopCommand: 'heyhey local stop',
    };
    webPort = DEFAULT_LOCAL_WEB_PORT;
    releases = { read: async () => ({ cliVersion: '4.2.1' }) };
    async run() {}
  },
}));
vi.mock('../local-app/installation-store', () => ({
  InstallationStore: class {
    async secrets() {
      return { admin: 'test-secret' };
    }
  },
}));
vi.mock('../local-app/open-browser', () => ({ openBrowser: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../tui/ink', () => ({
  loadInk: async () => ({
    render: () => ({
      unmount() {},
      waitUntilExit: async () => {},
    }),
  }),
}));
vi.mock('./pair', () => ({ runPairCommand: vi.fn().mockResolvedValue(true) }));
vi.mock('./pair-server', () => ({
  PairServerCommand: class {
    runServerAfterPairing = mocks.server;
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const unset = undefined;
it.each([
  { machineId: null, origin: unset, rpId: unset },
  { machineId: 'existing-machine', origin: unset, rpId: unset },
  { machineId: null, origin: 'https://custom.example', rpId: unset },
  { machineId: 'existing-machine', origin: unset, rpId: 'custom.example' },
])(
  'keeps local environment through delayed bridge startup (%j)',
  async ({ machineId, origin, rpId }) => {
    vi.stubEnv('HEYHEY_CONTROLLER_ORIGIN', origin);
    vi.stubEnv('HEYHEY_CONTROLLER_RP_ID', rpId);
    vi.spyOn(KeyPairStore.prototype, 'loadCurrentMachineId').mockResolvedValue(machineId);
    vi.stubEnv('HEYHEY_API_URL', undefined);
    vi.stubEnv('HEYHEY_WEB_ORIGIN', 'https://previous.example');
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(
      Object.assign(Object.create(process.stdin), { isTTY: true }),
    );
    vi.spyOn(process, 'stdout', 'get').mockReturnValue(
      Object.assign(Object.create(process.stdout), { isTTY: true }),
    );
    const envelope = (path: string, data: object) =>
      new Response(
        JSON.stringify({
          success: true,
          message: 'Request processed successfully',
          data,
          timestamp: '2026-11-03T06:25:38.763Z',
          statusCode: 200,
          path,
        }),
      );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/auth/local/cli-credentials')
          ? envelope(url, {
              accessToken: fakeJwt,
              refreshToken: 'local-refresh-token',
              expiresInSeconds: 86_400,
            })
          : envelope(url, { handoffToken: 'a'.repeat(43), expiresInSeconds: 120 }),
      ),
    );
    const storeCredential = vi.spyOn(CredentialStore.prototype, 'store').mockResolvedValue();
    mocks.server.mockImplementation(async () => {
      await Promise.resolve();
      // The bridge must find its token already stored, so it never opens a login page.
      expect(storeCredential).toHaveBeenCalledWith(
        'heyhey:oauth:localhost:3000',
        expect.objectContaining({ accessToken: fakeJwt, refreshToken: 'local-refresh-token' }),
      );
      expect(process.env['HEYHEY_API_URL']).toBe('http://localhost:3000');
      expect(process.env['HEYHEY_WEB_ORIGIN']).toBe(LOCAL_WEB_ORIGIN);
      expect(process.env['HEYHEY_CONTROLLER_ORIGIN']).toBe(origin ?? LOCAL_WEB_ORIGIN);
      expect(process.env['HEYHEY_CONTROLLER_RP_ID']).toBe(rpId ?? 'localhost');
      expect(new KeyPairStore().getAccountNamespace()).toBe(
        accountNamespace('http://localhost:3000'),
      );
      return true;
    });
    expect(await runLocalCommand([])).toBe(true);
    expect(process.env['HEYHEY_API_URL']).toBeUndefined();
    expect(process.env['HEYHEY_WEB_ORIGIN']).toBe('https://previous.example');
    expect(process.env['HEYHEY_CONTROLLER_ORIGIN']).toBe(origin);
    expect(process.env['HEYHEY_CONTROLLER_RP_ID']).toBe(rpId);
  },
);
