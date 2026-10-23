import { describe, expect, it } from 'vitest';
import { claudeModelsFromInitialize } from './claude-models';
import { codexModelToCatalogModel } from './codex-models';
import { opencodeModelsFromProviders } from './opencode-models';

describe('claudeModelsFromInitialize', () => {
  const entry = (value: string, resolvedModel: string, extra: Record<string, unknown> = {}) => ({
    value,
    resolvedModel,
    displayName: value,
    ...extra,
  });

  it('skips the default entry, keys by full model id and drops duplicates', () => {
    expect(
      claudeModelsFromInitialize([
        entry('default', 'claude-opus-5-5', {
          supportedEffortLevels: ['low'],
          supportsFastMode: true,
        }),
        entry('opus', 'claude-opus-5-5', {
          supportedEffortLevels: ['low', 'max'],
          supportsFastMode: true,
        }),
        entry('claude-fable-5-1[1m]', 'claude-fable-5-1', { supportedEffortLevels: ['high'] }),
        entry('opus-again', 'claude-opus-5-5'),
        entry('haiku', 'claude-haiku-5-5'),
      ]),
    ).toEqual({
      models: [
        {
          id: 'claude-opus-5-5',
          label: 'opus',
          efforts: ['low', 'max'],
          serviceTiers: ['priority'],
        },
        { id: 'claude-fable-5-1', label: 'claude-fable-5-1[1m]', efforts: ['high'] },
        { id: 'claude-haiku-5-5', label: 'haiku', efforts: [] },
      ],
      skipped: [
        {
          what: 'Claude model claude-opus-5-5 (entry opus-again)',
          why: 'its id repeats an earlier entry',
        },
      ],
    });
  });

  it('skips an entry with an empty name on its own and keeps the rest', () => {
    const report = claudeModelsFromInitialize([
      { ...entry('broken', 'claude-broken'), displayName: '' },
      entry('opus', 'claude-opus-5-5'),
    ]);
    expect(report.models.map((model) => model.id)).toEqual(['claude-opus-5-5']);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]?.what).toBe('a Claude model entry');
  });
});

describe('codexModelToCatalogModel', () => {
  const model = {
    model: 'gpt-6-sol',
    displayName: 'GPT 6 Sol',
    hidden: false,
    supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'ultra' }],
  };

  it('uses the provider label and effort ids, and reads Fast mode from the priority service tier', () => {
    expect(
      codexModelToCatalogModel({ ...model, serviceTiers: [{ id: 'flex' }, { id: 'priority' }] }),
    ).toEqual({
      id: 'gpt-6-sol',
      label: 'GPT 6 Sol',
      efforts: ['low', 'ultra'],
      serviceTiers: ['priority'],
    });
    expect(
      codexModelToCatalogModel({ ...model, serviceTiers: [{ id: 'flex' }] }),
    ).not.toHaveProperty('serviceTiers');
    expect(codexModelToCatalogModel(model)).not.toHaveProperty('serviceTiers');
  });
});

describe('opencodeModelsFromProviders', () => {
  it('lists every model of every connected provider with its launch reference, plus the Default entry', () => {
    expect(
      opencodeModelsFromProviders({
        providers: [
          {
            id: 'opencode-go',
            models: { 'glm-5.3': { name: 'GLM-5.3', variants: { none: {}, high: {} } } },
          },
          {
            id: 'openai',
            models: { 'glm-5.3': { name: 'Other GLM' }, 'gpt-5': { name: 'GPT-5' } },
          },
        ],
      }),
    ).toEqual({
      models: [
        {
          id: 'opencode-go/glm-5.3',
          label: 'GLM-5.3',
          efforts: ['none', 'high'],
          opencodeModelRef: { providerID: 'opencode-go', modelID: 'glm-5.3' },
        },
        {
          id: 'openai/glm-5.3',
          label: 'Other GLM',
          efforts: [],
          opencodeModelRef: { providerID: 'openai', modelID: 'glm-5.3' },
        },
        {
          id: 'openai/gpt-5',
          label: 'GPT-5',
          efforts: [],
          opencodeModelRef: { providerID: 'openai', modelID: 'gpt-5' },
        },
        { id: 'opencode-default', label: 'Default', efforts: [] },
      ],
      skipped: [],
    });
  });

  it('skips a model with an empty name or a malformed provider on its own', () => {
    const report = opencodeModelsFromProviders({
      providers: [
        { id: 'a', models: { broken: { name: '' }, fine: { name: 'Fine' } } },
        { id: 'b', models: 'not-a-record' },
      ],
    });
    expect(report.models.map((model) => model.id)).toEqual(['a/fine', 'opencode-default']);
    expect(report.skipped.map((entry) => entry.what)).toEqual([
      'OpenCode model a/broken',
      'an OpenCode provider entry',
    ]);
  });

  it('keeps only the Default entry when no provider is connected', () => {
    expect(opencodeModelsFromProviders({ providers: [] }).models).toEqual([
      { id: 'opencode-default', label: 'Default', efforts: [] },
    ]);
  });
});
