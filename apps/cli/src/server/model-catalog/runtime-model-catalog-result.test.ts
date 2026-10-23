import { afterEach, describe, expect, it } from 'vitest';
import {
  installCapabilityCatalog,
  resetCapabilityCatalogForTests,
} from '@hey-hey/ui-common/capability-catalog';
import { StructuredServerLogger } from '../logger';
import { readRuntimeModelCatalogResult } from './runtime-model-catalog-result';

const logger = new StructuredServerLogger({
  minLevel: 'debug',
  writeLine: () => undefined,
  sink: { append: () => undefined },
});

describe('readRuntimeModelCatalogResult', () => {
  afterEach(() => {
    resetCapabilityCatalogForTests();
  });

  it('fails instead of answering when no catalog is installed', () => {
    expect(() => readRuntimeModelCatalogResult(logger)).toThrow('The model catalog is not ready.');
  });

  it('returns the installed catalog, including a zero-model notice, unchanged', () => {
    installCapabilityCatalog([
      {
        provider: 'opencode',
        models: [
          {
            id: 'anthropic/claude',
            label: 'Claude',
            efforts: ['default'],
            opencodeModelRef: { providerID: 'anthropic', modelID: 'claude' },
          },
        ],
      },
      {
        provider: 'codex',
        models: [
          { id: 'gpt-5', label: 'GPT-5', efforts: ['low', 'high'], serviceTiers: ['priority'] },
        ],
      },
      { provider: 'claude', models: [], notice: 'Claude Code reported zero models.' },
    ]);

    expect(readRuntimeModelCatalogResult(logger)).toEqual({
      providers: [
        {
          provider: 'opencode',
          models: [
            {
              id: 'anthropic/claude',
              label: 'Claude',
              efforts: ['default'],
              opencodeModelRef: { providerID: 'anthropic', modelID: 'claude' },
            },
          ],
        },
        {
          provider: 'codex',
          models: [
            { id: 'gpt-5', label: 'GPT-5', efforts: ['low', 'high'], serviceTiers: ['priority'] },
          ],
        },
        { provider: 'claude', models: [], notice: 'Claude Code reported zero models.' },
      ],
    });
  });
});
