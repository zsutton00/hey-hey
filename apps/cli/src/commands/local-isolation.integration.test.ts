import { AxiosHeaders } from 'axios';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { continueLocalApplication } from './local';
import { InstallationStore } from '../local-app/installation-store';
import { LocalCliState } from '../local-app/local-cli-state';
import { LocalKeyPairStore } from '../local-app/local-key-pair-store';
import { KeyPairStore } from '../credentials/keypair';
import { KeyringPlatformStore, type KeyringEntryFactory } from '../credentials/platforms/keyring';
import { MachinesApi } from '../shared/api';
import { parseReleaseManifest } from '../release/release-manifest';
const image = { reference: 'example/image@sha256:' + 'a'.repeat(64), platforms: ['linux/amd64'] };
const manifest = {
  schemaVersion: 1,
  cliVersion: '4.4.0',
  images: { api: image, ui: image, graphSearch: image, postgres: image, redis: image },
};

vi.mock('../local-app/open-browser', () => ({ openBrowser: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../local-app/coding-agent-detection', () => ({
  CodingAgentDetector: class {
    detect() {
      return Promise.resolve({});
    }
  },
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each(['absent', 'stale', 'unavailable'] as const)(
  'isolates local enrollment and retains bindings on failure (%s)',
  async (scenario) => {
    const directory = await mkdtemp(join(tmpdir(), 'heyhey-local-isolation-'));
    try {
      const entries = new Map<string, string>();
      const accesses: string[] = [];
      const factory: KeyringEntryFactory = (service, account) => {
        const key = `${service}:${account}`;
        accesses.push(key);
        return {
          setPassword: (value) => {
            entries.set(key, value);
          },
          getPassword: () => entries.get(key) ?? null,
          deletePassword: () => entries.delete(key),
        };
      };
      for (const namespaceOverride of [
        '',
        'staging.heyhey.dev/',
        'localhost:3000/',
        'localhost:3000/test/',
      ]) {
        const store = new KeyPairStore({
          namespaceOverride,
          platformStoreOverride: new KeyringPlatformStore(factory),
        });
        await store.setCurrentMachineId('foreign-machine');
        await store.generateAndStoreKeyPair('foreign-machine');
        await store.storeMachineCredential('foreign-machine', 'foreign-token');
      }
      const foreign = new Map(entries);
      accesses.length = 0;
      vi.stubEnv('HEYHEY_PROFILE', 'test');
      vi.stubEnv('HEYHEY_SESSION_DIR', join(directory, 'foreign'));
      vi.stubEnv('HEYHEY_AUTHORIZATION_DIR', join(directory, 'foreign'));
      const storage = new InstallationStore(directory);
      await storage.prepare(parseReleaseManifest(JSON.stringify(manifest)));
      const secrets = await storage.secrets();
      const state = new LocalCliState(directory, new LocalKeyPairStore(factory));
      if (scenario !== 'absent') {
        await state.keyPairStore.setCurrentMachineId('previous-local-machine');
        await state.keyPairStore.generateAndStoreKeyPair('previous-local-machine');
        await state.keyPairStore.storeMachineCredential('previous-local-machine', 'previous-token');
      }
      const retained = new Map(entries);
      const token = [
        'e30',
        Buffer.from(JSON.stringify({ exp: 4102444800 })).toString('base64url'),
        'signature',
      ].join('.');
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                data: url.endsWith('/cli-credentials')
                  ? { accessToken: token, refreshToken: 'refresh', expiresInSeconds: 86400 }
                  : {
                      handoffToken: 'a'.repeat(43),
                      expiresInSeconds: 120,
                      accountHasPasskey: false,
                    },
              }),
            ),
          ),
        ),
      );
      const enrollment = vi
        .spyOn(MachinesApi.prototype, 'createMachineEnrollment')
        .mockRejectedValue(new Error('simulated enrollment unavailable'));
      const list = vi.spyOn(MachinesApi.prototype, 'listMachines');
      if (scenario === 'unavailable') {
        list.mockRejectedValue(new Error('connect ECONNREFUSED'));
      } else {
        list.mockResolvedValue({
          data: {
            success: true,
            message: 'OK',
            timestamp: '2026-11-13T00:00:00Z',
            statusCode: 200,
            data: { machines: [] },
          },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: new AxiosHeaders() },
        });
      }
      const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const startup = continueLocalApplication(
        storage,
        parseReleaseManifest(JSON.stringify(manifest)),
        {
          url: 'http://localhost:3850',
          reconnectCommand: 'heyhey local',
          stopCommand: 'heyhey local stop',
        },
        3851,
        3850,
        () => undefined,
        undefined,
        state,
      );
      if (scenario === 'unavailable') {
        await expect(startup).rejects.toThrow('machine directory is unavailable');
        expect(enrollment).not.toHaveBeenCalled();
      } else {
        await expect(startup).resolves.toBe(false);
        expect(enrollment).toHaveBeenCalledOnce();
        expect(output.mock.calls.flat().join(' ')).toContain(
          `store=heyhey-local-cli state=${scenario === 'absent' ? 'unpaired' : 'machine-unrecognized'}`,
        );
      }
      if (scenario === 'absent') {
        expect(list).not.toHaveBeenCalled();
      }
      expect(accesses.every((key) => key.startsWith('heyhey-local-cli:'))).toBe(true);
      expect(entries).toEqual(retained);
      for (const [key, value] of foreign) {
        expect(entries.get(key)).toBe(value);
      }
      expect(await state.keyPairStore.loadCurrentMachineId()).toBe(
        scenario === 'absent' ? null : 'previous-local-machine',
      );
      expect(await storage.secrets()).toEqual(secrets);
      expect(
        (await state.credentials.retrieve('heyhey:oauth:local-application'))?.accessToken,
      ).toBe(token);
      vi.stubEnv('HEYHEY_API_URL', 'https://heyhey.dev');
      vi.stubEnv('HEYHEY_PROFILE', 'different');
      const refresh = vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: token,
              refresh_token: 'renewed',
              expires_in: 86400,
              token_type: 'Bearer',
            }),
          ),
        ),
      );
      vi.stubGlobal('fetch', refresh);
      const restarted = new LocalCliState(directory, new LocalKeyPairStore(factory));
      expect((await restarted.oauthClient.getAccessToken({ forceRefresh: true })).success).toBe(
        true,
      );
      expect(refresh).toHaveBeenCalledWith(
        'http://localhost:3000/api/oauth/token',
        expect.anything(),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
