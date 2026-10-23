import type {
  CapabilityCatalogModel,
  CapabilityCatalogRow,
} from '../../../../../packages/ui-common/src/components/AgentSession/capabilityCatalog';

/** One thing a provider reported that the catalog left out, and why. */
export interface SkippedProviderEntry {
  readonly what: string;
  readonly why: string;
}

/** What one installed provider reported it can launch on this machine. */
export interface ProviderModelsReport {
  readonly models: readonly CapabilityCatalogModel[];
  readonly skipped: readonly SkippedProviderEntry[];
}

export interface ProviderModelReader {
  readonly provider: CapabilityCatalogRow['provider'];
  /** Human name used in errors and notices. */
  readonly displayName: string;
  /**
   * Resolves with the models the provider reported, leaving out (and listing in
   * `skipped`) any single entry it cannot use. Rejects with ProviderNotInstalledError
   * when the provider is absent, and with any other error when the provider as a whole
   * cannot report.
   */
  readModels(): Promise<ProviderModelsReport>;
}
