import fs from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestKeyPairStore } from '../../credentials/keypair.test-support';
import { RepoMappingStore, toServiceId } from '../../repo';
import { LocalRepositoryBindingErrorCode } from '../../shared/local-agent-api/generated/api';
import type { DirectoryPicker } from '../directory-picker';
import { NOOP_LOGGER } from '../logger';
import { createReposRouter } from './repos';

const ALLOWED_ORIGIN = 'https://allowed.test';
const MACHINE_ID = 'machine-1';

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => server.close(() => resolve()));

describe('createReposRouter', () => {
  const servers: Server[] = [];
  const tempDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
    await Promise.all(
      tempDirectories
        .splice(0)
        .map((directory) => fs.rm(directory, { force: true, recursive: true })),
    );
  });

  const createHarness = async (directoryPicker?: DirectoryPicker) => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-local-repos-'));
    tempDirectories.push(tempDirectory);
    const repoStore = new RepoMappingStore({
      mappingPath: path.join(tempDirectory, 'state', 'repos.json'),
      lockPath: path.join(tempDirectory, 'state', 'repos.lock'),
    });
    const keyPairStore = createTestKeyPairStore({ currentMachineId: MACHINE_ID });
    const app = express();
    app.use(express.json());
    app.use(
      '/api/local/repos',
      createReposRouter({
        allowedOrigins: [ALLOWED_ORIGIN],
        keyPairStore,
        repoStore,
        ...(directoryPicker ? { directoryPicker } : {}),
        logger: NOOP_LOGGER,
      }),
    );
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected router TCP port.');
    return {
      baseUrl: `http://127.0.0.1:${String(address.port)}`,
      keyPairStore,
      repoStore,
      tempDirectory,
    };
  };

  it('lists the authoritative paired-machine identity and current bindings', async () => {
    const harness = await createHarness();
    const repositoryPath = path.join(harness.tempDirectory, 'service-a');
    await fs.mkdir(repositoryPath);
    const binding = await harness.repoStore.setBinding(toServiceId('service-a'), repositoryPath);

    const response = await fetch(`${harness.baseUrl}/api/local/repos`, {
      headers: { origin: ALLOWED_ORIGIN },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    await expect(response.json()).resolves.toEqual({
      machineId: MACHINE_ID,
      bindings: [binding],
    });
  });

  it('persists the exact-Service binding through the canonical store path', async () => {
    const harness = await createHarness();
    const repositoryPath = path.join(harness.tempDirectory, 'service-a');
    await fs.mkdir(repositoryPath);
    const onChange = vi.fn();
    harness.repoStore.onChange(onChange);

    const response = await fetch(`${harness.baseUrl}/api/local/repos/service-a`, {
      method: 'PUT',
      headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ machineId: MACHINE_ID, repositoryPath }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      machineId: MACHINE_ID,
      binding: { serviceId: 'service-a', repositoryPath: await fs.realpath(repositoryPath) },
    });
    await expect(harness.repoStore.getBinding(toServiceId('service-a'))).resolves.toMatchObject({
      serviceId: 'service-a',
      repositoryPath: await fs.realpath(repositoryPath),
    });
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('preserves whitespace in a submitted repository path', async () => {
    const harness = await createHarness();
    const repositoryPath = path.join(harness.tempDirectory, 'service-a ');
    await fs.mkdir(repositoryPath);

    const response = await fetch(`${harness.baseUrl}/api/local/repos/service-a`, {
      method: 'PUT',
      headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ machineId: MACHINE_ID, repositoryPath }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      binding: { repositoryPath: await fs.realpath(repositoryPath) },
    });
  });

  it('selects a directory for the verified CLI machine without mutating bindings', async () => {
    const directoryPicker = vi.fn<DirectoryPicker>().mockResolvedValue({
      status: 'selected',
      repositoryPath: '/selected/service',
    });
    const harness = await createHarness(directoryPicker);

    const response = await fetch(`${harness.baseUrl}/api/local/repos/pick-directory`, {
      method: 'POST',
      headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ machineId: MACHINE_ID }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'selected',
      machineId: MACHINE_ID,
      repositoryPath: '/selected/service',
    });
    expect(directoryPicker).toHaveBeenCalledOnce();
    await expect(harness.repoStore.listBindings()).resolves.toEqual([]);
  });

  it('returns explicit cancellation without mutating bindings', async () => {
    const directoryPicker = vi.fn<DirectoryPicker>().mockResolvedValue({ status: 'cancelled' });
    const harness = await createHarness(directoryPicker);

    const response = await fetch(`${harness.baseUrl}/api/local/repos/pick-directory`, {
      method: 'POST',
      headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ machineId: MACHINE_ID }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'cancelled',
      machineId: MACHINE_ID,
    });
    await expect(harness.repoStore.listBindings()).resolves.toEqual([]);
  });

  it('rejects a picker request for another machine before opening native UI', async () => {
    const directoryPicker = vi.fn<DirectoryPicker>();
    const harness = await createHarness(directoryPicker);

    const response = await fetch(`${harness.baseUrl}/api/local/repos/pick-directory`, {
      method: 'POST',
      headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ machineId: 'another-machine' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: LocalRepositoryBindingErrorCode.MachineMismatch,
      message: 'The requested machine does not match the locally paired CLI machine.',
    });
    expect(directoryPicker).not.toHaveBeenCalled();
  });

  it('rejects a mismatched machine identity without mutating the store', async () => {
    const harness = await createHarness();
    const repositoryPath = path.join(harness.tempDirectory, 'service-a');
    await fs.mkdir(repositoryPath);
    const setBinding = vi.spyOn(harness.repoStore, 'setBinding');

    const response = await fetch(`${harness.baseUrl}/api/local/repos/service-a`, {
      method: 'PUT',
      headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ machineId: 'another-machine', repositoryPath }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: LocalRepositoryBindingErrorCode.MachineMismatch,
      message: 'The requested machine does not match the locally paired CLI machine.',
    });
    expect(setBinding).not.toHaveBeenCalled();
    await expect(harness.repoStore.listBindings()).resolves.toEqual([]);
  });

  it('rejects a missing request machine identity without mutating the store', async () => {
    const harness = await createHarness();
    const repositoryPath = path.join(harness.tempDirectory, 'service-a');
    await fs.mkdir(repositoryPath);
    const setBinding = vi.spyOn(harness.repoStore, 'setBinding');

    const response = await fetch(`${harness.baseUrl}/api/local/repos/service-a`, {
      method: 'PUT',
      headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ repositoryPath }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: LocalRepositoryBindingErrorCode.MachineIdRequired,
      message: 'Request body must include a non-empty "machineId".',
    });
    expect(setBinding).not.toHaveBeenCalled();
    await expect(harness.repoStore.listBindings()).resolves.toEqual([]);
  });

  it('returns a typed failure for an inaccessible directory without writing', async () => {
    const harness = await createHarness();
    const missingPath = path.join(harness.tempDirectory, 'missing');
    const onChange = vi.fn();
    harness.repoStore.onChange(onChange);

    const response = await fetch(`${harness.baseUrl}/api/local/repos/service-a`, {
      method: 'PUT',
      headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ machineId: MACHINE_ID, repositoryPath: missingPath }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      code: LocalRepositoryBindingErrorCode.RepositoryPathNotFound,
      message: `Selected directory does not exist: ${missingPath}`,
    });
    expect(onChange).not.toHaveBeenCalled();
    await expect(harness.repoStore.listBindings()).resolves.toEqual([]);
  });

  it('blocks an unapproved browser origin before identity or store access', async () => {
    const harness = await createHarness();
    const loadMachineId = vi.spyOn(harness.keyPairStore, 'loadCurrentMachineId');
    const listBindings = vi.spyOn(harness.repoStore, 'listBindings');

    const response = await fetch(`${harness.baseUrl}/api/local/repos`, {
      headers: { origin: 'https://blocked.test' },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: LocalRepositoryBindingErrorCode.OriginNotAllowed,
      message: 'This browser origin is not allowed to access local Service directory bindings.',
    });
    expect(loadMachineId).not.toHaveBeenCalled();
    expect(listBindings).not.toHaveBeenCalled();
  });

  it('answers approved CORS preflight without touching the binding owners', async () => {
    const harness = await createHarness();
    const loadMachineId = vi.spyOn(harness.keyPairStore, 'loadCurrentMachineId');

    const response = await fetch(`${harness.baseUrl}/api/local/repos/service-a`, {
      method: 'OPTIONS',
      headers: {
        origin: ALLOWED_ORIGIN,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type',
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(loadMachineId).not.toHaveBeenCalled();
  });
});
