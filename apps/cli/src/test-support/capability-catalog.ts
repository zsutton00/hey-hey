import {
  installCapabilityCatalog,
  resetCapabilityCatalogForTests,
  type CapabilityCatalogRow,
} from '@hey-hey/ui-common/capability-catalog';
import { afterEach, beforeEach } from 'vitest';
import type { CatalogAvailability } from '../server/runtime-capability-catalog';

/** A catalog that has already finished loading and has nothing to retry. */
export const SETTLED_CATALOG_AVAILABILITY: CatalogAvailability = {
  settled: () => Promise.resolve(),
  refresh: () => Promise.resolve(),
};

/** A catalog like the ones providers report; the CLI itself holds no model list. */
const TEST_CAPABILITY_CATALOG: readonly CapabilityCatalogRow[] = [
  {
    provider: 'claude',
    models: [
      {
        id: 'claude-opus-5-5',
        label: 'Opus 5.5',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        serviceTiers: ['priority'],
      },
      {
        id: 'claude-sonnet-5-5',
        label: 'Sonnet 5.5',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
      {
        id: 'claude-opus-5',
        label: 'Opus 5',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        serviceTiers: ['priority'],
      },
      {
        id: 'claude-fable-5-1',
        label: 'Fable 5.1',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
      {
        id: 'claude-fable-5',
        label: 'Fable 5',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
      {
        id: 'claude-haiku-5-5',
        label: 'Haiku 5.5',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
    ],
  },
  {
    provider: 'codex',
    models: [
      {
        id: 'gpt-5.6-sol',
        label: 'GPT 5.6 Sol',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        serviceTiers: ['priority'],
      },
      {
        id: 'gpt-5.6-luna',
        label: 'GPT 5.6 Luna',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        serviceTiers: ['priority'],
      },
      {
        id: 'gpt-5.6-terra',
        label: 'GPT 5.6 Terra',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        serviceTiers: ['priority'],
      },
      {
        id: 'gpt-6-astra',
        label: 'GPT 6 Astra',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        serviceTiers: ['priority'],
      },
      {
        id: 'gpt-6-luna',
        label: 'GPT 6 Luna',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        serviceTiers: ['priority'],
      },
      {
        id: 'gpt-6-sol',
        label: 'GPT 6 Sol',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        serviceTiers: ['priority'],
      },
      {
        id: 'gpt-6.1-sol',
        label: 'GPT 6.1 Sol',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        serviceTiers: ['priority'],
      },
    ],
  },
  {
    provider: 'opencode',
    models: [
      {
        id: 'glm-5.3',
        label: 'GLM-5.3',
        efforts: ['low', 'default', 'high', 'max'],
        opencodeModelRef: { providerID: 'opencode-go', modelID: 'glm-5.3' },
      },
      {
        id: 'glm-5.3-flash',
        label: 'GLM-5.3 Flash',
        efforts: ['low', 'default', 'high', 'max'],
        opencodeModelRef: {
          providerID: 'opencode-go',
          modelID: 'glm-5.3-flash',
        },
      },
      {
        id: 'kimi-k3',
        label: 'Kimi K3',
        efforts: ['max'],
        opencodeModelRef: { providerID: 'opencode-go', modelID: 'kimi-k3' },
      },
      {
        id: 'opencode-default',
        label: 'Default',
        efforts: [],
      },
    ],
  },
];

/** Installs the test catalog around every test in the calling suite. */
export const useTestCapabilityCatalog = (): void => {
  beforeEach(() => installCapabilityCatalog(TEST_CAPABILITY_CATALOG));
  afterEach(() => resetCapabilityCatalogForTests());
};
