import {
  getCapabilityCatalogLoadState,
  getOpencodeModelRef,
  listEfforts,
  listModels,
  listProviders,
  resetCapabilityCatalogForTests,
  supportsFastMode,
  type CapabilityCatalogModel,
} from '../../../../packages/ui-common/src/components/AgentSession/capabilityCatalog';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StructuredServerLogger, type ServerLogEntry } from './logger';
import type { ProviderModelReader, ProviderModelsReport } from './model-catalog/provider-models';
import { ProviderNotInstalledError } from './model-catalog/provider-process';
import { RuntimeCapabilityCatalogLifecycle } from './runtime-capability-catalog';

const createLogger = (entries: ServerLogEntry[]): StructuredServerLogger =>
  new StructuredServerLogger({
    minLevel: 'debug',
    writeLine: () => undefined,
    sink: { append: (entry) => entries.push(entry) },
  });

const reader = (
  provider: ProviderModelReader['provider'],
  displayName: string,
  readModels: ProviderModelReader['readModels'],
): ProviderModelReader => ({ provider, displayName, readModels });

const reports =
  (
    models: readonly CapabilityCatalogModel[],
    skipped: ProviderModelsReport['skipped'] = [],
  ): ProviderModelReader['readModels'] =>
  () =>
    Promise.resolve({ models, skipped });
const fails =
  (error: Error): ProviderModelReader['readModels'] =>
  () =>
    Promise.reject(error);

const claudeReader = reader(
  'claude',
  'Claude',
  reports([
    { id: 'claude-opus-5-5', label: 'Opus', efforts: ['low', 'max'], serviceTiers: ['priority'] },
  ]),
);
const opencodeReader = reader(
  'opencode',
  'OpenCode',
  reports([
    {
      id: 'opencode-go/glm-5.3',
      label: 'GLM-5.3',
      efforts: ['none', 'high'],
      opencodeModelRef: { providerID: 'opencode-go', modelID: 'glm-5.3' },
    },
    { id: 'opencode-default', label: 'Default', efforts: [] },
  ]),
);

afterEach(() => {
  vi.unstubAllGlobals();
  resetCapabilityCatalogForTests();
});

const load = async (lifecycle: RuntimeCapabilityCatalogLifecycle): Promise<void> => {
  lifecycle.start();
  await lifecycle.settled();
};

describe('RuntimeCapabilityCatalogLifecycle', () => {
  it('installs exactly what the providers report, without requesting any hosted catalog', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const entries: ServerLogEntry[] = [];
    const lifecycle = new RuntimeCapabilityCatalogLifecycle(createLogger(entries), [
      claudeReader,
      opencodeReader,
    ]);

    lifecycle.start();
    lifecycle.start();
    await lifecycle.settled();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(listProviders()).toEqual(['claude', 'opencode']);
    expect(listModels('claude').map((model) => model.id)).toEqual(['claude-opus-5-5']);
    expect(listEfforts('claude', 'claude-opus-5-5')).toEqual(['low', 'max']);
    expect(supportsFastMode('claude', 'claude-opus-5-5')).toBe(true);
    expect(listEfforts('opencode', 'opencode-go/glm-5.3')).toEqual(['none', 'high']);
    expect(getOpencodeModelRef('opencode-go/glm-5.3')).toEqual({
      providerID: 'opencode-go',
      modelID: 'glm-5.3',
    });
    expect(getOpencodeModelRef('opencode-default')).toBeNull();
    expect(entries).toContainEqual(
      expect.objectContaining({
        level: 'info',
        event: 'runtime_capability_catalog.load.settled',
        providerCount: 2,
      }),
    );
  });

  it('does not wait for a slow provider to start, and offers nothing until one has answered', () => {
    const lifecycle = new RuntimeCapabilityCatalogLifecycle(createLogger([]), [
      reader('claude', 'Claude', () => new Promise(() => undefined)),
    ]);
    lifecycle.start();

    expect(getCapabilityCatalogLoadState(null)).toEqual({ status: 'idle' });
    expect(listProviders()).toEqual([]);
    expect(listModels('claude')).toEqual([]);
  });

  it('lists a provider as soon as it answers, without waiting for the others', async () => {
    const lifecycle = new RuntimeCapabilityCatalogLifecycle(createLogger([]), [
      claudeReader,
      reader('codex', 'Codex', () => new Promise(() => undefined)),
    ]);
    lifecycle.start();
    await vi.waitFor(() => expect(listProviders()).toEqual(['claude']));
  });

  it('leaves out a provider that is not installed and still starts', async () => {
    const entries: ServerLogEntry[] = [];
    const lifecycle = new RuntimeCapabilityCatalogLifecycle(createLogger(entries), [
      claudeReader,
      reader('codex', 'Codex', fails(new ProviderNotInstalledError('Codex', 'codex'))),
    ]);

    await load(lifecycle);

    expect(listProviders()).toEqual(['claude']);
    expect(lifecycle.providerState('codex')).toEqual({ status: 'not_installed' });
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: 'runtime_capability_catalog.provider.not_installed',
        provider: 'codex',
      }),
    );
  });

  it('starts with an empty catalog when no provider is installed', async () => {
    const entries: ServerLogEntry[] = [];
    await load(
      new RuntimeCapabilityCatalogLifecycle(createLogger(entries), [
        reader('claude', 'Claude', fails(new ProviderNotInstalledError('Claude', 'claude'))),
      ]),
    );

    expect(getCapabilityCatalogLoadState(null)).toEqual({ status: 'ready', catalog: [] });
    expect(entries).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        event: 'runtime_capability_catalog.no_providers_installed',
      }),
    );
  });

  it('explains an installed provider that reported zero models instead of failing', async () => {
    await load(
      new RuntimeCapabilityCatalogLifecycle(createLogger([]), [
        reader('codex', 'Codex', reports([])),
      ]),
    );

    expect(getCapabilityCatalogLoadState(null)).toEqual({
      status: 'ready',
      catalog: [
        {
          provider: 'codex',
          models: [],
          notice:
            "Codex reported zero models on this machine. If you believe that is wrong, check Codex's own setup on this machine.",
        },
      ],
    });
  });

  it('shows a provider that cannot report with its reason and keeps the others loaded', async () => {
    const entries: ServerLogEntry[] = [];
    const lifecycle = new RuntimeCapabilityCatalogLifecycle(createLogger(entries), [
      claudeReader,
      reader('codex', 'Codex', fails(new Error('app-server exited'))),
      reader('opencode', 'OpenCode', fails(new Error('config/providers returned 500'))),
    ]);

    await load(lifecycle);

    expect(getCapabilityCatalogLoadState(null)).toEqual({
      status: 'ready',
      catalog: [
        expect.objectContaining({ provider: 'claude' }),
        {
          provider: 'codex',
          models: [],
          notice: 'Codex could not report its models: app-server exited',
        },
        {
          provider: 'opencode',
          models: [],
          notice: 'OpenCode could not report its models: config/providers returned 500',
        },
      ],
    });
    expect(listModels('claude')).toHaveLength(1);
    expect(
      entries.filter((entry) => entry.event === 'runtime_capability_catalog.provider.failed'),
    ).toHaveLength(2);
  });

  it('drops only an effort the launch contract cannot carry, and logs it', async () => {
    const entries: ServerLogEntry[] = [];
    await load(
      new RuntimeCapabilityCatalogLifecycle(createLogger(entries), [
        reader(
          'codex',
          'Codex',
          reports([
            { id: 'gpt', label: 'GPT', efforts: ['low', 'turbo', 'high'] },
            { id: 'gpt-2', label: 'GPT 2', efforts: ['low'] },
          ]),
        ),
      ]),
    );

    expect(listEfforts('codex', 'gpt')).toEqual(['low', 'high']);
    expect(listModels('codex')).toHaveLength(2);
    expect(entries).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        event: 'runtime_capability_catalog.effort.dropped',
        provider: 'codex',
        model: 'gpt',
        effort: 'turbo',
      }),
    );
  });

  it('drops a repeated model id and logs the entries the reader skipped', async () => {
    const entries: ServerLogEntry[] = [];
    await load(
      new RuntimeCapabilityCatalogLifecycle(createLogger(entries), [
        reader(
          'claude',
          'Claude',
          reports(
            [
              { id: 'a', label: 'A', efforts: [] },
              { id: 'a', label: 'A again', efforts: [] },
              { id: 'b', label: 'B', efforts: [] },
            ],
            [{ what: 'a Claude model entry', why: 'displayName is empty' }],
          ),
        ),
      ]),
    );

    expect(listModels('claude').map((model) => model.label)).toEqual(['A', 'B']);
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: 'runtime_capability_catalog.model.dropped',
        model: 'a',
      }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: 'runtime_capability_catalog.entry.skipped',
        what: 'a Claude model entry',
        why: 'displayName is empty',
      }),
    );
  });

  it('reads again only the providers that are not ready', async () => {
    let codexAttempts = 0;
    const claudeRead = vi.fn(reports([{ id: 'claude-opus-5-5', label: 'Opus', efforts: [] }]));
    const lifecycle = new RuntimeCapabilityCatalogLifecycle(createLogger([]), [
      reader('claude', 'Claude', claudeRead),
      reader('codex', 'Codex', () => {
        codexAttempts += 1;
        return codexAttempts === 1
          ? Promise.reject(new Error('not logged in'))
          : Promise.resolve({
              models: [{ id: 'gpt-6-sol', label: 'GPT 6 Sol', efforts: [] }],
              skipped: [],
            });
      }),
    ]);
    await load(lifecycle);
    expect(lifecycle.providerState('codex')).toMatchObject({ status: 'failed' });

    await lifecycle.refresh();

    expect(listModels('codex').map((model) => model.id)).toEqual(['gpt-6-sol']);
    expect(claudeRead).toHaveBeenCalledTimes(1);
  });
});
