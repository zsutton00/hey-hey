import { tmpdir } from 'node:os';
import { z } from 'zod';
import type { CapabilityCatalogModel } from '@hey-hey/ui-common/capability-catalog';
import { JsonLineProcess } from './provider-process';
import type {
  ProviderModelReader,
  ProviderModelsReport,
  SkippedProviderEntry,
} from './provider-models';

const INITIALIZE_REQUEST_ID = 'hey-hey-model-catalog-initialize';
const INITIALIZE_TIMEOUT_MS = 30_000;
const DEFAULT_ENTRY_VALUE = 'default';

const claudeModelSchema = z
  .object({
    value: z.string().min(1),
    resolvedModel: z.string().min(1),
    displayName: z.string().min(1),
    supportedEffortLevels: z.array(z.string()).optional(),
    supportsFastMode: z.boolean().optional(),
  })
  .passthrough();

const initializeControlResponseSchema = z.object({
  type: z.literal('control_response'),
  response: z.discriminatedUnion('subtype', [
    z
      .object({
        subtype: z.literal('success'),
        request_id: z.string(),
        response: z.object({ models: z.array(z.unknown()) }).passthrough(),
      })
      .passthrough(),
    z
      .object({ subtype: z.literal('error'), request_id: z.string(), error: z.string() })
      .passthrough(),
  ]),
});

/**
 * Maps the `models` of Claude's `initialize` control response (the data behind
 * the Agent SDK's `supportedModels()`) to catalog models: the `default` entry
 * is not a model, entries are keyed by their full model id, and an entry that
 * cannot be used or repeats an earlier id is skipped on its own.
 */
export const claudeModelsFromInitialize = (models: readonly unknown[]): ProviderModelsReport => {
  const byId = new Map<string, CapabilityCatalogModel>();
  const skipped: SkippedProviderEntry[] = [];
  for (const raw of models) {
    const parsed = claudeModelSchema.safeParse(raw);
    if (!parsed.success) {
      skipped.push({ what: 'a Claude model entry', why: parsed.error.message });
      continue;
    }
    const entry = parsed.data;
    if (entry.value === DEFAULT_ENTRY_VALUE) continue;
    if (byId.has(entry.resolvedModel)) {
      skipped.push({
        what: `Claude model ${entry.resolvedModel} (entry ${entry.value})`,
        why: 'its id repeats an earlier entry',
      });
      continue;
    }
    byId.set(entry.resolvedModel, {
      id: entry.resolvedModel,
      label: entry.displayName,
      efforts: entry.supportedEffortLevels ?? [],
      ...(entry.supportsFastMode ? { serviceTiers: ['priority'] as const } : {}),
    });
  }
  return { models: [...byId.values()], skipped };
};

export class ClaudeModelReader implements ProviderModelReader {
  public readonly provider = 'claude';
  public readonly displayName = 'Claude';

  public async readModels(): Promise<ProviderModelsReport> {
    const env = { ...process.env };
    delete env['CLAUDECODE'];
    // Run from a neutral directory so project settings never shape the answer.
    const claude = new JsonLineProcess(
      this.displayName,
      'claude',
      ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'],
      { cwd: tmpdir(), env },
    );
    try {
      const answer = claude.expect(
        'the initialize request',
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'control_response',
        INITIALIZE_TIMEOUT_MS,
      );
      claude.send({
        type: 'control_request',
        request_id: INITIALIZE_REQUEST_ID,
        request: { subtype: 'initialize' },
      });
      const parsed = initializeControlResponseSchema.safeParse(await answer);
      if (!parsed.success) {
        throw new Error(`Claude's initialize response was not recognized: ${parsed.error.message}`);
      }
      const { response } = parsed.data;
      if (response.subtype === 'error') {
        throw new Error(`Claude rejected the initialize request: ${response.error}`);
      }
      return claudeModelsFromInitialize(response.response.models);
    } finally {
      await claude.dispose();
    }
  }
}
