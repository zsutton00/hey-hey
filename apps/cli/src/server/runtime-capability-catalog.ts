import {
  installCapabilityCatalog,
  validateCapabilityCatalogRows,
  type CapabilityCatalogModel,
  type CapabilityCatalogRow,
} from '../../../../packages/ui-common/src/components/AgentSession/capabilityCatalog';
import { ClaudeModelReader } from './model-catalog/claude-models';
import { CodexModelReader } from './model-catalog/codex-models';
import { OpenCodeModelReader } from './model-catalog/opencode-models';
import type { ProviderModelReader, ProviderModelsReport } from './model-catalog/provider-models';
import { ProviderNotInstalledError } from './model-catalog/provider-process';
import type { ServerLogger } from './logger';

/** Where one provider stands: ready, empty with a reason, failed with a reason, or absent. */
export type ProviderLoadState =
  | { readonly status: 'ready'; readonly models: readonly CapabilityCatalogModel[] }
  | { readonly status: 'empty'; readonly notice: string }
  | { readonly status: 'failed'; readonly notice: string }
  | { readonly status: 'not_installed' };

const zeroModelsNotice = (displayName: string): string =>
  `${displayName} reported zero models on this machine. If you believe that is wrong, check ${displayName}'s own setup on this machine.`;

const failedNotice = (displayName: string, reason: string): string =>
  `${displayName} could not report its models: ${reason}`;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const defaultReaders = (): readonly ProviderModelReader[] => [
  new ClaudeModelReader(),
  new CodexModelReader(),
  new OpenCodeModelReader(),
];

/** What the rest of the CLI may ask of the catalog: wait for it, or retry providers that are not ready. */
export type CatalogAvailability = Pick<RuntimeCapabilityCatalogLifecycle, 'settled' | 'refresh'>;

/**
 * Owns the process-wide runtime capability catalog: it is built from what each
 * installed provider reports on this machine and nothing else. Each provider
 * loads on its own and ends up ready, empty with a reason, or failed with a
 * reason; one provider, model or effort the catalog cannot use never stops the
 * others or the CLI. A provider that is not installed is not a provider here.
 */
export class RuntimeCapabilityCatalogLifecycle {
  private readonly states = new Map<string, ProviderLoadState>();
  private readonly launchableEfforts = new Map<string, boolean>();
  private loading: Promise<void> = Promise.resolve();
  private started = false;

  public constructor(
    private readonly logger: ServerLogger,
    private readonly readers: readonly ProviderModelReader[] = defaultReaders(),
  ) {}

  /** Begins the first load of every provider without waiting for any of them. */
  public start(): void {
    if (this.started) return;
    this.started = true;
    this.logger.debug('runtime_capability_catalog.load.started', {
      providers: this.readers.map((reader) => reader.provider),
    });
    this.loading = this.load(this.readers);
  }

  /** Resolves once every load started so far has settled; never rejects. */
  public settled(): Promise<void> {
    return this.loading;
  }

  /**
   * Reads again every provider that is not ready, so a provider the user fixed
   * or logged in to since the last read shows up without restarting the CLI.
   */
  public async refresh(): Promise<void> {
    await this.loading;
    const stale = this.readers.filter(
      (reader) => this.states.get(reader.provider)?.status !== 'ready',
    );
    if (stale.length === 0) return;
    this.loading = this.load(stale);
    await this.loading;
  }

  public providerState(provider: string): ProviderLoadState | undefined {
    return this.states.get(provider);
  }

  private async load(readers: readonly ProviderModelReader[]): Promise<void> {
    try {
      await Promise.all(readers.map((reader) => this.loadProvider(reader)));
    } catch (error) {
      this.logger.error('runtime_capability_catalog.install.failed', {
        reason: errorMessage(error),
      });
    }
    const rows = this.rows();
    this.logger.info('runtime_capability_catalog.load.settled', {
      providerCount: rows.length,
      states: Object.fromEntries(
        this.readers.map((reader) => [reader.provider, this.states.get(reader.provider)?.status]),
      ),
      modelCounts: Object.fromEntries(rows.map((row) => [row.provider, row.models.length])),
    });
    if (rows.length === 0) {
      this.logger.warn('runtime_capability_catalog.no_providers_installed');
    }
  }

  private async loadProvider(reader: ProviderModelReader): Promise<void> {
    const state = await this.readProvider(reader);
    this.states.set(reader.provider, state);
    installCapabilityCatalog(this.rows());
  }

  private async readProvider(reader: ProviderModelReader): Promise<ProviderLoadState> {
    let report: ProviderModelsReport;
    try {
      report = await reader.readModels();
    } catch (error) {
      if (error instanceof ProviderNotInstalledError) {
        this.logger.info('runtime_capability_catalog.provider.not_installed', {
          provider: reader.provider,
        });
        return { status: 'not_installed' };
      }
      const reason = errorMessage(error);
      this.logger.error('runtime_capability_catalog.provider.failed', {
        provider: reader.provider,
        reason,
      });
      return { status: 'failed', notice: failedNotice(reader.displayName, reason) };
    }

    for (const entry of report.skipped) {
      this.logger.warn('runtime_capability_catalog.entry.skipped', {
        provider: reader.provider,
        what: entry.what,
        why: entry.why,
      });
    }
    const models = this.usableModels(reader, report.models);
    return models.length === 0
      ? { status: 'empty', notice: zeroModelsNotice(reader.displayName) }
      : { status: 'ready', models };
  }

  /**
   * Keeps each model the catalog can carry. A reasoning effort the launch
   * contract does not know is dropped from its model, and a model that is still
   * unusable or repeats an earlier id is dropped on its own; each is logged.
   */
  private usableModels(
    reader: ProviderModelReader,
    reported: readonly CapabilityCatalogModel[],
  ): CapabilityCatalogModel[] {
    const usable: CapabilityCatalogModel[] = [];
    const seen = new Set<string>();
    for (const model of reported) {
      if (seen.has(model.id)) {
        this.logger.warn('runtime_capability_catalog.model.dropped', {
          provider: reader.provider,
          model: model.id,
          reason: 'its id repeats an earlier model',
        });
        continue;
      }
      const efforts = model.efforts.filter((effort) => {
        if (this.isLaunchableEffort(reader, effort)) return true;
        this.logger.warn('runtime_capability_catalog.effort.dropped', {
          provider: reader.provider,
          model: model.id,
          effort,
          reason: 'it is not a reasoning effort a launch can carry',
        });
        return false;
      });
      const candidate = { ...model, efforts };
      try {
        validateCapabilityCatalogRows([{ provider: reader.provider, models: [candidate] }]);
      } catch (error) {
        this.logger.warn('runtime_capability_catalog.model.dropped', {
          provider: reader.provider,
          model: model.id,
          reason: errorMessage(error),
        });
        continue;
      }
      seen.add(model.id);
      usable.push(candidate);
    }
    return usable;
  }

  private isLaunchableEffort(reader: ProviderModelReader, effort: string): boolean {
    const cached = this.launchableEfforts.get(effort);
    if (cached !== undefined) return cached;
    let launchable = true;
    try {
      validateCapabilityCatalogRows([
        {
          provider: reader.provider,
          models: [{ id: 'effort-probe', label: 'effort-probe', efforts: [effort] }],
        },
      ]);
    } catch {
      launchable = false;
    }
    this.launchableEfforts.set(effort, launchable);
    return launchable;
  }

  private rows(): CapabilityCatalogRow[] {
    return this.readers.flatMap((reader): CapabilityCatalogRow[] => {
      const state = this.states.get(reader.provider);
      if (state === undefined || state.status === 'not_installed') return [];
      if (state.status === 'ready') return [{ provider: reader.provider, models: state.models }];
      return [{ provider: reader.provider, models: [], notice: state.notice }];
    });
  }
}
