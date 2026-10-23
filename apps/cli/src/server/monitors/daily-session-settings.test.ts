import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LocalReasoningEffort,
  LocalRunProvider,
} from '../../shared/agent-bridge-contract/contract';
import { NOOP_LOGGER } from '../logger';
import {
  DEFAULT_DAILY_SESSION_SETTINGS_INPUT,
  DailySessionSettingsStore,
  resolveDailySessionSettings,
} from './daily-session-settings';
import { useTestCapabilityCatalog } from '../../test-support/capability-catalog';

const temporaryDirectories: string[] = [];

const createStore = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'daily-session-settings-'));
  temporaryDirectories.push(directory);
  const info = vi.fn(NOOP_LOGGER.info.bind(NOOP_LOGGER));
  const error = vi.fn(NOOP_LOGGER.error.bind(NOOP_LOGGER));
  const warn = vi.fn(NOOP_LOGGER.warn.bind(NOOP_LOGGER));
  return {
    store: new DailySessionSettingsStore({
      filePath: path.join(directory, 'settings.json'),
      logger: { ...NOOP_LOGGER, info, error, warn },
    }),
    info,
    error,
    warn,
  };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

useTestCapabilityCatalog();

describe('resolveDailySessionSettings', () => {
  it('defaults only an entirely absent launch selection', () => {
    expect(resolveDailySessionSettings(DEFAULT_DAILY_SESSION_SETTINGS_INPUT)).toEqual(
      expect.objectContaining({
        status: 'ready',
        usedDefaultLaunch: true,
        effectiveValueSource: 'persisted',
        persistenceRevision: 0,
        settings: expect.objectContaining({
          provider: LocalRunProvider.Codex,
          model: 'gpt-5.6-luna',
          reasoningEffort: LocalReasoningEffort.Xhigh,
        }),
      }),
    );
  });

  it('keeps an explicit catalog-valid launch selection authoritative', () => {
    expect(
      resolveDailySessionSettings({
        ...DEFAULT_DAILY_SESSION_SETTINGS_INPUT,
        provider: LocalRunProvider.Claude,
        model: 'claude-opus-5-5',
        reasoningEffort: LocalReasoningEffort.Max,
      }),
    ).toEqual(
      expect.objectContaining({
        status: 'ready',
        usedDefaultLaunch: false,
        settings: expect.objectContaining({
          provider: LocalRunProvider.Claude,
          model: 'claude-opus-5-5',
          reasoningEffort: LocalReasoningEffort.Max,
        }),
      }),
    );
  });

  it.each([
    {
      name: 'partial launch selection',
      value: { ...DEFAULT_DAILY_SESSION_SETTINGS_INPUT, provider: LocalRunProvider.Codex },
    },
  ])('rejects a $name', ({ value }) => {
    expect(resolveDailySessionSettings(value).status).toBe('invalid');
  });

  it('leaves a saved model this machine does not list to the provider to judge', () => {
    expect(
      resolveDailySessionSettings({
        ...DEFAULT_DAILY_SESSION_SETTINGS_INPUT,
        provider: LocalRunProvider.Codex,
        model: 'not-a-model',
        reasoningEffort: LocalReasoningEffort.Xhigh,
      }),
    ).toEqual(
      expect.objectContaining({
        status: 'ready',
        settings: expect.objectContaining({ model: 'not-a-model' }),
      }),
    );
  });
});

describe('DailySessionSettingsStore', () => {
  it('loads defaults for a missing project and logs the source', async () => {
    const { store, info } = await createStore();

    await expect(store.load('project-a')).resolves.toEqual(
      expect.objectContaining({ status: 'ready', usedDefaultLaunch: true }),
    );
    expect(info).toHaveBeenCalledWith(
      'daily_session.settings.loaded',
      expect.objectContaining({
        projectId: 'project-a',
        source: 'default',
        persistenceRevision: 0,
      }),
    );
  });

  it('persists settings independently by project', async () => {
    const { store } = await createStore();
    await store.persist('project-a', {
      ...DEFAULT_DAILY_SESSION_SETTINGS_INPUT,
      countThreshold: 3,
    });
    await store.persist('project-b', {
      ...DEFAULT_DAILY_SESSION_SETTINGS_INPUT,
      countThreshold: 7,
    });

    const projectA = await store.load('project-a');
    const projectB = await store.load('project-b');
    expect(projectA.status === 'ready' && projectA.settings.countThreshold).toBe(3);
    expect(projectB.status === 'ready' && projectB.settings.countThreshold).toBe(7);
  });

  it('logs and rejects invalid persisted settings before writing', async () => {
    const { store, error } = await createStore();

    await expect(
      store.persist('project-a', {
        ...DEFAULT_DAILY_SESSION_SETTINGS_INPUT,
        provider: LocalRunProvider.Codex,
      }),
    ).rejects.toThrow('Invalid Daily Session settings');
    expect(error).toHaveBeenCalledWith(
      'daily_session.settings.persistence_rejected',
      expect.objectContaining({ projectId: 'project-a' }),
    );
  });

  it('returns a persisted source and increments the revision for accepted replacement', async () => {
    const { store } = await createStore();
    const first = await store.replace('project-a', 0, {
      ...DEFAULT_DAILY_SESSION_SETTINGS_INPUT,
      countThreshold: 3,
    });
    const loaded = await store.load('project-a');

    expect(first).toEqual(
      expect.objectContaining({ effectiveValueSource: 'persisted', persistenceRevision: 1 }),
    );
    expect(loaded).toEqual(
      expect.objectContaining({ effectiveValueSource: 'persisted', persistenceRevision: 1 }),
    );
  });

  it('rejects a stale replacement without changing the stored snapshot', async () => {
    const { store } = await createStore();
    await store.replace('project-a', 0, DEFAULT_DAILY_SESSION_SETTINGS_INPUT);

    await expect(
      store.replace('project-a', 0, {
        ...DEFAULT_DAILY_SESSION_SETTINGS_INPUT,
        countThreshold: 9,
      }),
    ).rejects.toMatchObject({
      code: 'USER_SETTINGS_REVISION_CONFLICT',
      expectedPersistenceRevision: 0,
      currentPersistenceRevision: 1,
    });
    await expect(store.load('project-a')).resolves.toEqual(
      expect.objectContaining({
        persistenceRevision: 1,
        settings: expect.objectContaining({
          countThreshold: DEFAULT_DAILY_SESSION_SETTINGS_INPUT.countThreshold,
        }),
      }),
    );
  });

  it('migrates a legacy project entry with revision zero', async () => {
    const { store } = await createStore();
    const settingsPath = (store as unknown as { filePath: string }).filePath;
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        version: 1,
        projects: { 'project-a': DEFAULT_DAILY_SESSION_SETTINGS_INPUT },
      }),
      'utf8',
    );

    await expect(store.load('project-a')).resolves.toEqual(
      expect.objectContaining({ effectiveValueSource: 'persisted', persistenceRevision: 0 }),
    );
  });
});
