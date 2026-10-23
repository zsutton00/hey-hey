import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LoadedEntityPromptContext } from '../agents/entity-context/types';
import type { MachineReadinessSnapshot } from '../auth/machine-controller-authority';
import { credentialKeyForBaseUrl, OAuthClient } from '../auth/oauth-client';
import {
  ControllerRegistryStore,
  type ControllerRegistryContents,
} from '../credentials/controller-registry';
import { createTestKeyPairStore } from '../credentials/keypair.test-support';
import { CredentialStore, type OAuthCredential } from '../credentials/store';
import { LocalSessionMetadataSource } from '../server/local-session-metadata-source';
import type { LocalSessionSnapshot } from '../server/local-session-read-source';
import { NOOP_LOGGER } from '../server/logger';
import { MachineActions } from './machine-actions';

const BASE_URL = 'https://heyhey.test';
const MACHINE_ID = 'machine-1';
let registryDirectory: string;

const registry: ControllerRegistryContents = {
  schemaVersion: 1,
  controllers: [
    {
      enrollmentId: 'enrollment-1',
      machineId: MACHINE_ID,
      machineName: 'test machine',
      osFamily: 'linux',
      cliVersion: '2.2.2',
      accountId: 'account-1',
      organizationId: 'organization-1',
      controllerLabel: 'test passkey',
      controllerCredentialId: 'controller-1',
      controllerCredentialPublicKey: { kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'B'.repeat(43) },
      controllerCredentialFingerprint: 'controller-fingerprint',
      backupEligible: true,
      backupState: false,
      authorizationProtocolVersion: 2,
      enrolledAt: '2026-10-04T00:00:00.000Z',
    },
  ],
};

const session: LocalSessionSnapshot = {
  runId: 'run-a',
  runInstanceId: 1,
  agentSessionId: 'agent-session-a',
  conversationId: 'conversation-a',
  organizationId: 'org-1',
  projectId: 'project-1',
  provider: 'claude',
  providerSessionId: null,
  providerConversationId: null,
  entity: { entityType: 'TASK', entityId: '00000000-0000-4000-8000-000000000001' },
  effectiveState: null,
  hasActiveWork: false,
  createdAt: '2026-10-04T00:00:00.000Z',
  activeSince: '2026-10-04T00:00:00.000Z',
  loadedEntityContext: {
    kind: 'entity',
    focalEntity: { entityType: 'TASK', entityId: '00000000-0000-4000-8000-000000000001' },
    entity: { id: 'task', title: 'Task title' },
    context: { featureHierarchy: [] },
  } as unknown as LoadedEntityPromptContext,
  entityContextLoadStatus: 'loaded',
};

const memoryCredentialStore = (): CredentialStore => {
  const memory = new Map<string, OAuthCredential>();
  const store = new CredentialStore();
  vi.spyOn(store, 'store').mockImplementation((key, credential) => {
    memory.set(key, credential);
    return Promise.resolve();
  });
  vi.spyOn(store, 'retrieve').mockImplementation((key) => Promise.resolve(memory.get(key) ?? null));
  vi.spyOn(store, 'delete').mockImplementation((key) => {
    memory.delete(key);
    return Promise.resolve();
  });
  return store;
};

beforeEach(async () => {
  registryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-machine-actions-logout-'));
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await fs.rm(registryDirectory, { recursive: true, force: true });
});

describe('MachineActions log-out end to end', () => {
  it('signs the account out, keeps machine authority and sessions, and withdraws account metadata', async () => {
    const credentialStore = memoryCredentialStore();
    const oauthClient = new OAuthClient({ config: { baseUrl: BASE_URL }, credentialStore });
    await credentialStore.store(credentialKeyForBaseUrl(BASE_URL), {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    } as OAuthCredential);
    await expect(oauthClient.isAuthenticated()).resolves.toBe(true);

    const keyPairStore = createTestKeyPairStore({ currentMachineId: MACHINE_ID });
    await keyPairStore.storePrivateKey(MACHINE_ID, 'private-key-pem');
    await keyPairStore.storeMachineCredential(MACHINE_ID, 'machine-credential');
    const controllerRegistryStore = new ControllerRegistryStore({
      keyPairStore,
      filePath: path.join(registryDirectory, 'controller-registry.json'),
    });
    await controllerRegistryStore.write(registry);

    const metadataSource = new LocalSessionMetadataSource({
      readSource: {
        observe: () => ({
          snapshot: { revision: 1, sessions: [session] },
          unsubscribe: () => undefined,
        }),
      },
      readConversationTitle: () => Promise.resolve('Conversation title'),
      logger: NOOP_LOGGER,
      refreshIntervalMs: 60_000,
    });
    // Mirrors RunApplicationRuntime's auth-change wiring.
    oauthClient.onAuthChanged((token) => {
      if (token === null) metadataSource.authorizationLost();
      else metadataSource.authorizationRestored();
    });
    metadataSource.setDisplayInterest(['run-a']);
    await vi.waitFor(() =>
      expect(metadataSource.snapshot().sessions[0]?.title.status).toBe('available'),
    );

    const readiness: MachineReadinessSnapshot = {
      state: 'ready',
      machineId: MACHINE_ID,
      machine: null,
      localControllers: [],
      serverControllers: [],
      serverExecutionReadiness: null,
    };
    const actions = new MachineActions({
      oauthClient,
      platformWebSocketManager: {
        getConnectionState: () => 'connected',
        onConnectionStateChanged: () => () => undefined,
        onMachineRevoked: () => () => undefined,
      },
      machineControllerAuthority: {
        readReadiness: vi.fn().mockResolvedValue(readiness),
        addController: vi.fn(),
      },
      pair: vi.fn(),
      logger: NOOP_LOGGER,
    });
    await vi.waitFor(() => expect(actions.snapshot().account).toBe('signed-in'));

    const start = actions.start('log-out');
    if (!start.started || start.operation.kind !== 'logout') throw new Error('logout not started');
    await expect(start.operation.completion).resolves.toEqual({ outcome: 'signed-out' });

    expect(actions.snapshot().account).toBe('signed-out');
    expect(actions.snapshot().actions.find((action) => action.id === 'log-out')?.availability).toEqual(
      { available: false, reason: 'signed-out' },
    );
    await expect(oauthClient.isAuthenticated()).resolves.toBe(false);

    await expect(keyPairStore.loadCurrentMachineId()).resolves.toBe(MACHINE_ID);
    await expect(keyPairStore.loadPrivateKey(MACHINE_ID)).resolves.toBe('private-key-pem');
    await expect(keyPairStore.loadMachineCredential(MACHINE_ID)).resolves.toBe('machine-credential');
    await expect(controllerRegistryStore.read()).resolves.toEqual(registry);

    const sessions = metadataSource.snapshot().sessions;
    expect(sessions.map((entry) => entry.runId)).toEqual(['run-a']);
    expect(sessions[0]).toMatchObject({
      title: { status: 'unavailable', reason: 'signed_out' },
      focalContext: { status: 'unavailable', reason: 'signed_out' },
    });

    actions.dispose();
    metadataSource.dispose();
  });
});
