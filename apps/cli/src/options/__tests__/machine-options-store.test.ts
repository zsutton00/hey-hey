import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MachineOptionsStore } from '../machine-options-store';

describe('MachineOptionsStore', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'machine-options-'));
    filePath = path.join(dir, 'nested', 'options.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reads Intent-first as off when nothing is stored', async () => {
    await expect(new MachineOptionsStore({ filePath }).read()).resolves.toEqual({
      intentFirst: false,
      remoteToolCallViewing: true,
      jevEnabled: true,
    });
  });

  it('reads a file saved before remote tool-call viewing existed as enabled', async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ version: 1, intentFirst: true }));

    const store = new MachineOptionsStore({ filePath });
    await expect(store.read()).resolves.toEqual({
      intentFirst: true,
      remoteToolCallViewing: true,
      jevEnabled: true,
    });
    await expect(store.isRemoteToolCallViewingEnabled()).resolves.toBe(true);
  });

  it('update keeps the options it was not asked to change', async () => {
    const store = new MachineOptionsStore({ filePath });
    await store.update({ remoteToolCallViewing: false });
    await store.update({ intentFirst: true });

    await expect(store.read()).resolves.toEqual({
      intentFirst: true,
      remoteToolCallViewing: false,
      jevEnabled: true,
    });
    await expect(store.isRemoteToolCallViewingEnabled()).resolves.toBe(false);
  });

  it('saves the Jev parent feature filter without touching the other options', async () => {
    const store = new MachineOptionsStore({ filePath });
    await store.update({ remoteToolCallViewing: false });
    await store.update({ jevEnabled: false });

    await expect(store.read()).resolves.toEqual({
      intentFirst: false,
      remoteToolCallViewing: false,
      jevEnabled: false,
    });
    await expect(store.isJevEnabled()).resolves.toBe(false);
    await expect(new MachineOptionsStore({ filePath }).isJevEnabled()).resolves.toBe(false);
  });

  it('concurrent updates to different options both persist', async () => {
    const store = new MachineOptionsStore({ filePath });
    await Promise.all([
      store.update({ intentFirst: true }),
      store.update({ remoteToolCallViewing: false }),
    ]);

    await expect(store.read()).resolves.toEqual({
      intentFirst: true,
      remoteToolCallViewing: false,
      jevEnabled: true,
    });
  });

  it('persists the choice across store instances', async () => {
    await new MachineOptionsStore({ filePath }).update({
      intentFirst: true,
      remoteToolCallViewing: false,
    });

    await expect(new MachineOptionsStore({ filePath }).read()).resolves.toEqual({
      intentFirst: true,
      remoteToolCallViewing: false,
      jevEnabled: true,
    });
    expect(JSON.parse(await fs.readFile(filePath, 'utf8'))).toEqual({
      version: 1,
      intentFirst: true,
      remoteToolCallViewing: false,
      jevEnabled: true,
    });
  });

  it('keeps the value saved under the old Jev parent feature filter name', async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify({ version: 1, intentFirst: false, jevParentFeatureFilter: false }),
    );

    const store = new MachineOptionsStore({ filePath });
    await expect(store.isJevEnabled()).resolves.toBe(false);
    await store.update({ intentFirst: true });
    expect(JSON.parse(await fs.readFile(filePath, 'utf8'))).toEqual({
      version: 1,
      intentFirst: true,
      remoteToolCallViewing: true,
      jevEnabled: false,
    });
  });

  it('rejects a malformed options file', async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ version: 1, intentFirst: 'yes' }));

    await expect(new MachineOptionsStore({ filePath }).read()).rejects.toThrow();
  });

  it('rejects an options file with unknown fields', async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ version: 1, intentFirst: true, extra: 1 }));

    await expect(new MachineOptionsStore({ filePath }).read()).rejects.toThrow();
  });

  it('rejects an unknown version', async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ version: 2, intentFirst: true }));

    await expect(new MachineOptionsStore({ filePath }).read()).rejects.toThrow();
  });
});
